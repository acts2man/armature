/**
 * SEO helpers: computePageHead turns a layout and the site kit into the head tags Google
 * should see; sitemapXml and robotsTxt produce the two files a static site serves so a
 * search engine can find its pages.
 */
import { describe, expect, it } from "vitest";
import { defaultSiteKit } from "../../kit/defaults.ts";
import { absoluteUrl, applyTitlePattern, computePageHead, renderHeadHtml, robotsTxt, sitemapXml } from "../../kit/seo.ts";
import type { LayoutDoc, SiteKit } from "../../kit/types.ts";

const baseLayout = (over: Partial<LayoutDoc> = {}): LayoutDoc => ({
  version: 1,
  pageSlug: "about",
  path: "/about/",
  label: "About us",
  root: [],
  ...over,
});

const kitWithSeo = (over: Partial<NonNullable<SiteKit["seo"]>> = {}): SiteKit => ({
  ...defaultSiteKit(),
  seo: { siteName: "Acme Homes", siteUrl: "https://acmehomes.com", titlePattern: "%page% | %site%", defaultDescription: "Custom homes.", ...over },
});

describe("computePageHead", () => {
  it("makes the title from the page label, the site pattern and the site name", () => {
    const tags = computePageHead(baseLayout(), kitWithSeo());
    const title = tags.find((tag) => tag.tag === "title");
    expect(title && title.tag === "title" && title.content).toBe("About us | Acme Homes");
  });

  it("uses seo.title when set, over the page label", () => {
    const tags = computePageHead(baseLayout({ seo: { title: "Meet the builders" } }), kitWithSeo());
    const title = tags.find((tag) => tag.tag === "title");
    expect(title && title.tag === "title" && title.content).toBe("Meet the builders | Acme Homes");
  });

  it("makes an absolute canonical URL from the site URL and the page path", () => {
    const tags = computePageHead(baseLayout(), kitWithSeo());
    const canonical = tags.find((tag) => tag.tag === "link" && (tag.attrs as Record<string, string>).rel === "canonical");
    expect(canonical && canonical.tag === "link" && (canonical.attrs as Record<string, string>).href).toBe("https://acmehomes.com/about/");
  });

  it("honours a page's explicit canonical over the site URL + path", () => {
    const tags = computePageHead(baseLayout({ seo: { canonical: "https://old-site.example.com/about/" } }), kitWithSeo());
    const canonical = tags.find((tag) => tag.tag === "link" && (tag.attrs as Record<string, string>).rel === "canonical");
    expect(canonical && canonical.tag === "link" && (canonical.attrs as Record<string, string>).href).toBe("https://old-site.example.com/about/");
  });

  it("falls back to the site's default description and share picture", () => {
    const tags = computePageHead(baseLayout(), kitWithSeo({ defaultShareImage: "/assets/default.png" }));
    const desc = tags.find((tag) => tag.tag === "meta" && (tag.attrs as Record<string, string>).name === "description");
    expect(desc && desc.tag === "meta" && (desc.attrs as Record<string, string>).content).toBe("Custom homes.");
    const og = tags.find((tag) => tag.tag === "meta" && (tag.attrs as Record<string, string>).property === "og:image");
    expect(og && og.tag === "meta" && (og.attrs as Record<string, string>).content).toBe("https://acmehomes.com/assets/default.png");
  });

  it("writes robots noindex/nofollow together when both are on", () => {
    const tags = computePageHead(baseLayout({ seo: { noindex: true, nofollow: true } }), kitWithSeo());
    const robots = tags.find((tag) => tag.tag === "meta" && (tag.attrs as Record<string, string>).name === "robots");
    expect(robots && robots.tag === "meta" && (robots.attrs as Record<string, string>).content).toBe("noindex, nofollow");
  });

  it("writes Open Graph, Twitter and Google verification tags", () => {
    const tags = computePageHead(baseLayout({ seo: { title: "About us", description: "Who we are.", ogImage: "/assets/hero.png", twitterTitle: "About Acme" } }), kitWithSeo({ googleVerification: "ABCDEFGHIJKLMNOPQRST" }));
    const findMeta = (attr: string, value: string) => tags.find((tag) => tag.tag === "meta" && (tag.attrs as Record<string, string>)[attr] === value);
    expect(findMeta("property", "og:title")).toBeDefined();
    expect(findMeta("property", "og:image")).toBeDefined();
    expect(findMeta("name", "twitter:card")).toBeDefined();
    const twitterTitle = findMeta("name", "twitter:title");
    expect(twitterTitle && twitterTitle.tag === "meta" && (twitterTitle.attrs as Record<string, string>).content).toBe("About Acme");
    expect(findMeta("name", "google-site-verification")).toBeDefined();
  });

  it("emits a LocalBusiness JSON-LD block from the site kit's business details", () => {
    const tags = computePageHead(baseLayout({ seo: { structuredData: { kind: "LocalBusiness" } } }), kitWithSeo({ business: { name: "Acme Homes", telephone: "+1-555-0100", streetAddress: "1 Main St", addressLocality: "Portland" } }));
    const ld = tags.find((tag) => tag.tag === "script");
    expect(ld && ld.tag === "script").toBe(true);
    const parsed = ld && ld.tag === "script" ? JSON.parse(ld.content) : null;
    expect(parsed).toMatchObject({ "@type": "LocalBusiness", name: "Acme Homes", telephone: "+1-555-0100" });
    expect(parsed?.address).toMatchObject({ "@type": "PostalAddress", streetAddress: "1 Main St", addressLocality: "Portland" });
  });

  it("emits an Article JSON-LD block from the page fields", () => {
    const tags = computePageHead(
      baseLayout({ seo: { structuredData: { kind: "Article", article: { headline: "Our new studio", author: "Jane", datePublished: "2026-01-01" } } } }),
      kitWithSeo(),
    );
    const ld = tags.find((tag) => tag.tag === "script");
    const parsed = ld && ld.tag === "script" ? JSON.parse(ld.content) : null;
    expect(parsed).toMatchObject({ "@type": "Article", headline: "Our new studio", datePublished: "2026-01-01" });
    expect(parsed?.author).toMatchObject({ "@type": "Person", name: "Jane" });
  });

  it("emits an FAQPage JSON-LD block from an accordion on the page", () => {
    const layout = baseLayout({
      seo: { structuredData: { kind: "FAQ", fromAccordionId: "aaaaaaaa" } },
      root: [
        {
          id: "aaaaaaaa",
          type: "accordion",
          props: { items: [{ title: "How long?", content: "About six months." }, { title: "Cost?", content: "It depends." }] },
          style: {},
          advanced: {},
          meta: { createdBy: "test", updatedAt: "" },
        },
      ],
    });
    const tags = computePageHead(layout, kitWithSeo());
    const ld = tags.find((tag) => tag.tag === "script");
    const parsed = ld && ld.tag === "script" ? JSON.parse(ld.content) : null;
    expect(parsed?.["@type"]).toBe("FAQPage");
    expect(parsed?.mainEntity).toHaveLength(2);
    expect(parsed?.mainEntity[0]).toMatchObject({ "@type": "Question", name: "How long?" });
  });

  it("emits BreadcrumbList JSON-LD with absolute URLs", () => {
    const tags = computePageHead(baseLayout({ seo: { structuredData: { kind: "BreadcrumbList", items: [{ name: "Home", url: "/" }, { name: "About", url: "/about/" }] } } }), kitWithSeo());
    const ld = tags.find((tag) => tag.tag === "script");
    const parsed = ld && ld.tag === "script" ? JSON.parse(ld.content) : null;
    expect(parsed?.itemListElement?.[0]).toMatchObject({ position: 1, name: "Home", item: "https://acmehomes.com/" });
  });
});

describe("renderHeadHtml", () => {
  it("turns the tags into safe HTML", () => {
    const html = renderHeadHtml(computePageHead(baseLayout({ seo: { title: "A & B", description: 'Says "hi".' } }), kitWithSeo()));
    expect(html).toContain("<title>A &amp; B | Acme Homes</title>");
    expect(html).toContain('<meta name="description" content="Says &quot;hi&quot;." />');
    expect(html).toContain('<link rel="canonical" href="https://acmehomes.com/about/" />');
  });

  it("escapes </script> inside JSON-LD to keep it inside the script tag", () => {
    const html = renderHeadHtml(computePageHead(baseLayout({ seo: { structuredData: { kind: "Article", article: { headline: "</script><h1>x" } } } }), kitWithSeo()));
    expect(html).not.toContain("</script><h1>x");
    expect(html).toContain("\\u003c/script");
  });
});

describe("sitemapXml", () => {
  it("makes an entry per page with absolute URLs", () => {
    const xml = sitemapXml("https://acmehomes.com", [
      { path: "/", lastmod: "2026-01-01T00:00:00.000Z" },
      { path: "/about/", lastmod: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<loc>https://acmehomes.com/</loc>");
    expect(xml).toContain("<loc>https://acmehomes.com/about/</loc>");
    expect(xml).toContain("<lastmod>2026-01-01T00:00:00.000Z</lastmod>");
  });

  it("escapes ampersands and other XML characters in URLs", () => {
    const xml = sitemapXml("https://acmehomes.com", [{ path: "/a?b=1&c=2" }]);
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain("=1&c=2");
  });
});

describe("robotsTxt", () => {
  it("writes the standard allow, the sitemap and extras", () => {
    const text = robotsTxt("https://acmehomes.com", "Disallow: /private/");
    expect(text).toContain("User-agent: *");
    expect(text).toContain("Allow: /");
    expect(text).toContain("Sitemap: https://acmehomes.com/sitemap.xml");
    expect(text).toContain("Disallow: /private/");
  });

  it("skips the Sitemap line when the site URL is empty", () => {
    const text = robotsTxt("", "");
    expect(text).not.toContain("Sitemap:");
    expect(text).toContain("User-agent: *");
  });
});

describe("absoluteUrl and applyTitlePattern", () => {
  it("keeps an already-absolute URL", () => {
    expect(absoluteUrl("https://a.com", "https://b.com/x")).toBe("https://b.com/x");
  });
  it("makes a site-relative address absolute against the site URL", () => {
    expect(absoluteUrl("https://a.com/", "/about")).toBe("https://a.com/about");
  });
  it('joins "%page%" and "%site%" from the pattern', () => {
    expect(applyTitlePattern("%page% | %site%", "About", "Acme")).toBe("About | Acme");
  });
  it("uses the page alone when the pattern is empty or missing", () => {
    expect(applyTitlePattern("", "About", "Acme")).toBe("About");
    expect(applyTitlePattern(undefined, "About", "Acme")).toBe("About");
  });
  it("cleans a trailing bar when the site name is empty", () => {
    expect(applyTitlePattern("%page% | %site%", "About", "")).toBe("About");
  });
});
