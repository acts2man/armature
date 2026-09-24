/**
 * RSS feed generation. Every post publish rewrites public/rss.xml alongside the post
 * file and the regenerated posts index, so /rss.xml stays in step with what the site
 * shows.
 */
import { absoluteUrl } from "./seo.ts";
import type { PostIndexEntry, SiteKit } from "./types.ts";

const escapeXml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const rfc822 = (iso: string): string => {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toUTCString() : new Date().toUTCString();
};

export type RssOptions = {
  /** Path on the site to serve the feed from (default /rss.xml). */
  feedPath?: string;
  /** Optional custom description; falls back to the site kit's default description. */
  description?: string;
};

/** The RSS 2.0 xml body for the site's published posts. */
export function rssXml(siteKit: SiteKit | null | undefined, posts: PostIndexEntry[], opts: RssOptions = {}): string {
  const seo = siteKit?.seo ?? {};
  const siteUrl = seo.siteUrl ?? "";
  const siteName = seo.siteName ?? "Website";
  const description = opts.description ?? seo.defaultDescription ?? `Posts from ${siteName}`;
  const feedUrl = absoluteUrl(siteUrl, opts.feedPath ?? "/rss.xml");
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', "  <channel>"];
  lines.push(`    <title>${escapeXml(siteName)}</title>`);
  if (siteUrl) lines.push(`    <link>${escapeXml(siteUrl)}</link>`);
  lines.push(`    <description>${escapeXml(description)}</description>`);
  if (feedUrl) lines.push(`    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`);
  lines.push(`    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`);
  const published = posts.filter((post) => post.publishedAt && Date.parse(post.publishedAt) <= Date.now()).slice(0, 50);
  for (const post of published) {
    const postUrl = absoluteUrl(siteUrl, post.path);
    lines.push("    <item>");
    lines.push(`      <title>${escapeXml(post.title)}</title>`);
    lines.push(`      <link>${escapeXml(postUrl)}</link>`);
    lines.push(`      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>`);
    if (post.publishedAt) lines.push(`      <pubDate>${rfc822(post.publishedAt)}</pubDate>`);
    if (post.authorName) lines.push(`      <dc:creator>${escapeXml(post.authorName)}</dc:creator>`);
    if (post.excerpt) lines.push(`      <description>${escapeXml(post.excerpt)}</description>`);
    for (const category of post.categories ?? []) lines.push(`      <category>${escapeXml(category)}</category>`);
    lines.push("    </item>");
  }
  lines.push("  </channel>", "</rss>");
  return lines.join("\n") + "\n";
}
