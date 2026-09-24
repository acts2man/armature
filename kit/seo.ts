/**
 * SEO helpers: turn a page's layout (with its seo block), the site kit's siteSeo and
 * the page's absolute URL into the exact head tags Google should see. Also generates
 * sitemap.xml and robots.txt for the publish function.
 *
 * The kit runs the SPA fallback (an `<ArmatureHead>` React component in ./renderer.tsx)
 * that inserts these tags into `document.head` via useEffect. For SSR sites (TanStack
 * Start, Next, Remix) use `computePageHead(layout, siteKit, opts)` inside route.head()
 * and return the array to the framework — see kit/README.md.
 *
 * Pure TypeScript. No dependencies, no DOM.
 */
import type { Element, LayoutDoc, LocalBusinessData, PageStructuredData, SiteKit } from "./types.ts";

export type HeadTag =
  | { tag: "title"; content: string }
  | { tag: "meta"; attrs: Record<string, string> }
  | { tag: "link"; attrs: Record<string, string> }
  | { tag: "script"; type: "application/ld+json"; content: string };

export type PageHeadOpts = {
  /** The page's absolute URL, e.g. https://acmehomes.com/about/. Leaving it out uses the layout's own path unresolved. */
  pageUrl?: string;
  /** A page label to fall back on for the title when seo.title is empty (usually schema.json's label or layout.label). */
  pageLabel?: string;
};

const trim = (value?: string): string => (typeof value === "string" ? value.trim() : "");
const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const escapeXml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const isAbs = (value: string): boolean => /^https?:\/\//i.test(value);

/** Turn a possibly-relative address into an absolute URL against the site URL. */
export function absoluteUrl(siteUrl: string | undefined, address: string): string {
  if (!address) return "";
  if (isAbs(address)) return address;
  const base = trim(siteUrl);
  if (!base) return address;
  const clean = base.replace(/\/$/, "");
  if (address.startsWith("/")) return `${clean}${address}`;
  return `${clean}/${address}`;
}

/** Apply the site's title pattern ("%page% | %site%") to a page title. */
export function applyTitlePattern(pattern: string | undefined, page: string, site: string): string {
  const clean = trim(pattern) || "%page%";
  return clean.replace(/%page%/g, page).replace(/%site%/g, site).replace(/\s+\|\s*$/, "").trim() || page;
}

// --- structured data --------------------------------------------------------------------

/** Turn business data into the LocalBusiness / Organization JSON-LD object. */
function businessLd(kind: "LocalBusiness" | "Organization", data: LocalBusinessData | undefined, siteUrl: string, siteName: string): Record<string, unknown> | null {
  const merged = data ?? {};
  const name = trim(merged.name) || siteName;
  if (!name) return null;
  const ld: Record<string, unknown> = { "@context": "https://schema.org", "@type": trim(merged.type) || kind, name };
  if (siteUrl) ld["url"] = siteUrl;
  if (merged.telephone) ld["telephone"] = merged.telephone;
  if (merged.email) ld["email"] = `mailto:${merged.email.replace(/^mailto:/i, "")}`;
  if (merged.logo) ld["logo"] = absoluteUrl(siteUrl, merged.logo);
  const address: Record<string, string> = { "@type": "PostalAddress" };
  if (merged.streetAddress) address["streetAddress"] = merged.streetAddress;
  if (merged.addressLocality) address["addressLocality"] = merged.addressLocality;
  if (merged.addressRegion) address["addressRegion"] = merged.addressRegion;
  if (merged.postalCode) address["postalCode"] = merged.postalCode;
  if (merged.addressCountry) address["addressCountry"] = merged.addressCountry;
  if (Object.keys(address).length > 1) ld["address"] = address;
  if (typeof merged.latitude === "number" && typeof merged.longitude === "number") ld["geo"] = { "@type": "GeoCoordinates", latitude: merged.latitude, longitude: merged.longitude };
  if (merged.openingHours) ld["openingHours"] = merged.openingHours;
  if (merged.priceRange && kind === "LocalBusiness") ld["priceRange"] = merged.priceRange;
  if (merged.sameAs && merged.sameAs.length) ld["sameAs"] = merged.sameAs;
  return ld;
}

/** Walk the layout to find an accordion by id and return its items as FAQPage entities. */
function findAccordion(root: Element[], id: string): Element | null {
  for (const el of root) {
    if (el.id === id && el.type === "accordion") return el;
    if (el.children) {
      const found = findAccordion(el.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Turn an accordion element's items into an FAQPage JSON-LD object. */
function faqLd(accordion: Element): Record<string, unknown> | null {
  const items = ((accordion.props as { items?: unknown }).items ?? []) as { title?: string; content?: string }[];
  if (!Array.isArray(items) || items.length === 0) return null;
  const clean = items
    .filter((item) => item && typeof item.title === "string" && typeof item.content === "string" && item.title.trim() && item.content.trim())
    .map((item) => ({ "@type": "Question", name: (item.title ?? "").trim(), acceptedAnswer: { "@type": "Answer", text: (item.content ?? "").trim() } }));
  if (clean.length === 0) return null;
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: clean };
}

/** Turn the structured data setting and site data into a JSON-LD object, or null. */
export function structuredDataLd(
  data: PageStructuredData | undefined,
  layout: LayoutDoc,
  siteKit: SiteKit | null | undefined,
  pageUrl: string,
): Record<string, unknown> | null {
  if (!data || data.kind === "none") return null;
  const siteSeo = siteKit?.seo ?? {};
  const siteName = trim(siteSeo.siteName);
  const siteUrl = trim(siteSeo.siteUrl);
  if (data.kind === "LocalBusiness" || data.kind === "Organization") {
    const combined: LocalBusinessData = { ...(siteSeo.business ?? {}), ...(data.override ?? {}) };
    return businessLd(data.kind, combined, siteUrl, siteName);
  }
  if (data.kind === "Article") {
    const a = data.article;
    const ld: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Article" };
    if (a.headline) ld["headline"] = a.headline;
    if (a.description) ld["description"] = a.description;
    if (a.image) ld["image"] = absoluteUrl(siteUrl, a.image);
    if (a.author) ld["author"] = { "@type": "Person", name: a.author };
    if (a.datePublished) ld["datePublished"] = a.datePublished;
    if (a.dateModified) ld["dateModified"] = a.dateModified;
    if (pageUrl) ld["mainEntityOfPage"] = pageUrl;
    return ld;
  }
  if (data.kind === "FAQ") {
    if (!data.fromAccordionId) return null;
    const accordion = findAccordion(layout.root, data.fromAccordionId);
    if (!accordion) return null;
    return faqLd(accordion);
  }
  if (data.kind === "BreadcrumbList") {
    const items = data.items
      .filter((item) => item && item.name && item.url)
      .map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: absoluteUrl(siteUrl, item.url) }));
    if (items.length === 0) return null;
    return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items };
  }
  return null;
}

// --- head tags --------------------------------------------------------------------------

/** Every head tag Google should see for a page, given its layout and the site kit's seo block. */
export function computePageHead(layout: LayoutDoc, siteKit: SiteKit | null | undefined, opts: PageHeadOpts = {}): HeadTag[] {
  const seo = layout.seo ?? {};
  const siteSeo = siteKit?.seo ?? {};
  const siteName = trim(siteSeo.siteName);
  const pageLabel = trim(seo.title) || trim(opts.pageLabel) || trim(layout.label) || layout.pageSlug;
  const title = applyTitlePattern(siteSeo.titlePattern, pageLabel, siteName);
  const description = trim(seo.description) || trim(siteSeo.defaultDescription);
  const pageUrl = trim(opts.pageUrl) || (siteSeo.siteUrl ? absoluteUrl(siteSeo.siteUrl, layout.path || "/") : "");
  const canonical = trim(seo.canonical) || pageUrl;
  const shareImageRaw = trim(seo.ogImage) || trim(siteSeo.defaultShareImage);
  const shareImage = shareImageRaw ? absoluteUrl(siteSeo.siteUrl, shareImageRaw) : "";
  const ogTitle = trim(seo.ogTitle) || title;
  const ogDescription = trim(seo.ogDescription) || description;
  const twitterTitle = trim(seo.twitterTitle) || ogTitle;
  const twitterDescription = trim(seo.twitterDescription) || ogDescription;
  const twitterImageRaw = trim(seo.twitterImage) || shareImageRaw;
  const twitterImage = twitterImageRaw ? absoluteUrl(siteSeo.siteUrl, twitterImageRaw) : "";

  const tags: HeadTag[] = [{ tag: "title", content: title }];
  if (description) tags.push({ tag: "meta", attrs: { name: "description", content: description } });
  const robots: string[] = [];
  if (seo.noindex) robots.push("noindex");
  if (seo.nofollow) robots.push("nofollow");
  if (robots.length) tags.push({ tag: "meta", attrs: { name: "robots", content: robots.join(", ") } });
  if (canonical) tags.push({ tag: "link", attrs: { rel: "canonical", href: canonical } });
  // Open Graph
  tags.push({ tag: "meta", attrs: { property: "og:type", content: "website" } });
  tags.push({ tag: "meta", attrs: { property: "og:title", content: ogTitle } });
  if (ogDescription) tags.push({ tag: "meta", attrs: { property: "og:description", content: ogDescription } });
  if (pageUrl) tags.push({ tag: "meta", attrs: { property: "og:url", content: pageUrl } });
  if (siteName) tags.push({ tag: "meta", attrs: { property: "og:site_name", content: siteName } });
  if (shareImage) tags.push({ tag: "meta", attrs: { property: "og:image", content: shareImage } });
  // Twitter card
  tags.push({ tag: "meta", attrs: { name: "twitter:card", content: shareImage ? "summary_large_image" : "summary" } });
  tags.push({ tag: "meta", attrs: { name: "twitter:title", content: twitterTitle } });
  if (twitterDescription) tags.push({ tag: "meta", attrs: { name: "twitter:description", content: twitterDescription } });
  if (twitterImage) tags.push({ tag: "meta", attrs: { name: "twitter:image", content: twitterImage } });
  // Google Search Console
  if (trim(siteSeo.googleVerification)) tags.push({ tag: "meta", attrs: { name: "google-site-verification", content: siteSeo.googleVerification!.trim() } });
  // Structured data
  const ld = structuredDataLd(seo.structuredData, layout, siteKit, pageUrl);
  if (ld) tags.push({ tag: "script", type: "application/ld+json", content: JSON.stringify(ld) });
  return tags;
}

/** Render the head tags as HTML text (for SSR frameworks that want raw HTML). */
export function renderHeadHtml(tags: HeadTag[]): string {
  return tags
    .map((tag) => {
      if (tag.tag === "title") return `<title>${escapeHtml(tag.content)}</title>`;
      if (tag.tag === "meta") return `<meta ${Object.entries(tag.attrs).map(([key, value]) => `${key}="${escapeHtml(value)}"`).join(" ")} />`;
      if (tag.tag === "link") return `<link ${Object.entries(tag.attrs).map(([key, value]) => `${key}="${escapeHtml(value)}"`).join(" ")} />`;
      // JSON-LD's contents are JSON, so only < and & need escaping inside a <script> tag.
      return `<script type="application/ld+json">${tag.content.replace(/</g, "\\u003c")}</script>`;
    })
    .join("\n");
}

// --- sitemap and robots -----------------------------------------------------------------

export type SitemapEntry = {
  /** The page's path on the site (e.g. /about/). Combined with siteUrl to make the absolute URL. */
  path: string;
  /** Last time the page was published (ISO date). */
  lastmod?: string;
  /** Ignored by many crawlers today but harmless to include. */
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
};

/** The sitemap.xml file body for the pages the site has. */
export function sitemapXml(siteUrl: string, entries: SitemapEntry[]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const entry of entries) {
    const url = absoluteUrl(siteUrl, entry.path || "/");
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(url)}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    if (entry.changefreq) lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    if (typeof entry.priority === "number") lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return lines.join("\n") + "\n";
}

/** The robots.txt file body, always with the standard allow and the sitemap line when a URL is known. */
export function robotsTxt(siteUrl: string, extras?: string): string {
  const lines = ["User-agent: *", "Allow: /"];
  const url = trim(siteUrl);
  if (url) lines.push(`Sitemap: ${absoluteUrl(url, "/sitemap.xml")}`);
  const extra = trim(extras);
  if (extra) {
    lines.push("");
    lines.push(extra);
  }
  return lines.join("\n") + "\n";
}
