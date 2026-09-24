import { assertEquals } from "jsr:@std/assert@1";
import { hasNextLink, listRepositoriesForInstallation, PER_PAGE } from "./githubRepositories.ts";

const OK_HEADERS = { "Content-Type": "application/json" };

Deno.test("hasNextLink: recognises GitHub's rel=next", () => {
  assertEquals(hasNextLink(`<https://api.github.com/installation/repositories?page=2>; rel="next", <https://api.github.com/installation/repositories?page=3>; rel="last"`), true);
  assertEquals(hasNextLink(`<https://api.github.com/installation/repositories?page=1>; rel="first", <https://api.github.com/installation/repositories?page=1>; rel="prev"`), false);
  assertEquals(hasNextLink(null), false);
});

Deno.test("listRepositoriesForInstallation: pages through three pages when total_count > per_page", async () => {
  const total = 250;
  const makeRepos = (page: number, size: number) =>
    Array.from({ length: size }, (_, index) => ({
      owner: { login: "acme" },
      name: `repo-${(page - 1) * PER_PAGE + index + 1}`,
      full_name: `acme/repo-${(page - 1) * PER_PAGE + index + 1}`,
      private: false,
      default_branch: "main",
    }));
  const fetchImpl: typeof fetch = (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page") ?? "1");
    if (page === 1 || page === 2) {
      return Promise.resolve(new Response(JSON.stringify({ total_count: total, repositories: makeRepos(page, PER_PAGE) }), {
        status: 200,
        headers: { ...OK_HEADERS, link: `<https://api.github.com/installation/repositories?page=${page + 1}>; rel="next"` },
      }));
    }
    if (page === 3) {
      return Promise.resolve(new Response(JSON.stringify({ total_count: total, repositories: makeRepos(3, 50) }), { status: 200, headers: OK_HEADERS }));
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  };

  const result = await listRepositoriesForInstallation({ token: "t", accountLogin: "acme", accountType: "Organization", installationId: 42, fetchImpl });
  assertEquals(result.repositories.length, total);
  assertEquals(result.pages_fetched, 3);
  assertEquals(result.page_cap_hit, false);
  assertEquals(result.repositories[0]?.full_name, "acme/repo-1");
  assertEquals(result.repositories[total - 1]?.full_name, `acme/repo-${total}`);
  assertEquals(result.repositories[0]?.configure_url, "https://github.com/organizations/acme/settings/installations/42");
});

Deno.test("listRepositoriesForInstallation: stops early when total_count is reached before a rel=next", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(
    new Response(JSON.stringify({ total_count: 3, repositories: [
      { owner: { login: "acme" }, name: "a", full_name: "acme/a", private: false, default_branch: "main" },
      { owner: { login: "acme" }, name: "b", full_name: "acme/b", private: false, default_branch: "main" },
      { owner: { login: "acme" }, name: "c", full_name: "acme/c", private: false, default_branch: "main" },
    ] }), { status: 200, headers: { ...OK_HEADERS, link: `<https://api.github.com/installation/repositories?page=2>; rel="next"` } }),
  );
  const result = await listRepositoriesForInstallation({ token: "t", accountLogin: "acme", accountType: "User", installationId: 1, fetchImpl });
  assertEquals(result.pages_fetched, 1);
  assertEquals(result.repositories.length, 3);
  assertEquals(result.page_cap_hit, false);
});

Deno.test("listRepositoriesForInstallation: flips page_cap_hit when the cap is reached with a next link still present", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(
    new Response(JSON.stringify({ total_count: 10000, repositories: [
      { owner: { login: "acme" }, name: `r`, full_name: `acme/r`, private: false, default_branch: "main" },
    ] }), { status: 200, headers: { ...OK_HEADERS, link: `<x>; rel="next"` } }),
  );
  const result = await listRepositoriesForInstallation({ token: "t", accountLogin: "acme", accountType: "Organization", installationId: 7, pageCap: 3, fetchImpl });
  assertEquals(result.pages_fetched, 3);
  assertEquals(result.page_cap_hit, true);
});

Deno.test("listRepositoriesForInstallation: a non-2xx response ends the loop and returns what was gathered so far", async () => {
  let page = 0;
  const fetchImpl: typeof fetch = () => {
    page += 1;
    if (page === 1) {
      return Promise.resolve(new Response(JSON.stringify({ repositories: [
        { owner: { login: "acme" }, name: "a", full_name: "acme/a", private: false, default_branch: "main" },
      ] }), { status: 200, headers: { ...OK_HEADERS, link: `<x>; rel="next"` } }));
    }
    return Promise.resolve(new Response("nope", { status: 502 }));
  };
  const result = await listRepositoriesForInstallation({ token: "t", accountLogin: "acme", accountType: "User", installationId: 1, fetchImpl });
  assertEquals(result.repositories.length, 1);
  assertEquals(result.page_cap_hit, false);
});
