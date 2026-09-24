import { describe, expect, it } from "vitest";
import type { GithubRepositorySummary } from "@shared/publishTypes.ts";
import { filterRepositories } from "@/lib/repoFilter.ts";

function repo(full: string): GithubRepositorySummary {
  const [owner, name] = full.split("/");
  return { installation_id: 1, account_login: owner ?? "", owner: owner ?? "", name: name ?? "", full_name: full, private: false, default_branch: "main", configure_url: "https://github.com" };
}

describe("filterRepositories", () => {
  const list = [repo("acts2man/armature"), repo("acts2man/treetestprep"), repo("acme/alder-stone"), repo("client/portal-site")];

  it("returns everything when the needle is empty", () => {
    expect(filterRepositories(list, "")).toEqual(list);
    expect(filterRepositories(list, "   ")).toEqual(list);
  });

  it("matches anywhere in the full_name (owner/name)", () => {
    const stone = filterRepositories(list, "stone");
    expect(stone.map((r) => r.full_name)).toEqual(["acme/alder-stone"]);
  });

  it("matches anywhere in the repository name", () => {
    const test = filterRepositories(list, "test");
    expect(test.map((r) => r.full_name)).toEqual(["acts2man/treetestprep"]);
  });

  it("is case-insensitive", () => {
    const armature = filterRepositories(list, "ARMATURE");
    expect(armature.map((r) => r.full_name)).toEqual(["acts2man/armature"]);
  });
});
