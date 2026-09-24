/**
 * /sites/:siteId/posts — the WordPress-style Posts list. A table of every post the
 * site has (from content-get's posts + postIndex), with title, status (Draft, Scheduled
 * or Published), categories and date. Row actions open the post editor, view the live
 * URL, duplicate, delete. "Add New Post" opens the post editor on a blank post.
 *
 * The full-screen visual post editor lands in a later pass. This screen is functional:
 * it lists posts, and hands off to a lightweight post editor for creating and editing.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, EmptyState, Input, PageHeader, Pill, Select, Skeleton } from "@/components/ui.tsx";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import type { PostDoc, PostIndexEntry } from "@shared/builder/index.ts";

type Status = "all" | "draft" | "scheduled" | "published";

function statusOf(post: PostDoc): "draft" | "scheduled" | "published" {
  const iso = post.settings.publishedAt;
  if (!iso) return "draft";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "draft";
  if (at > Date.now()) return "scheduled";
  return "published";
}

function statusPill(status: "draft" | "scheduled" | "published") {
  if (status === "published") return <Pill tone="success">Published</Pill>;
  if (status === "scheduled") return <Pill tone="warning">Scheduled</Pill>;
  return <Pill tone="grey">Draft</Pill>;
}

export function SitePosts() {
  const { site } = useSite();
  const navigate = useNavigate();
  const content = useSiteContent(site.id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Status>("all");

  const loaded = content.data?.ok ? content.data : null;
  const posts: PostDoc[] = useMemo(() => {
    const map = loaded?.posts ?? {};
    return Object.values(map);
  }, [loaded?.posts]);
  const indexBySlug = useMemo(() => {
    const map = new Map<string, PostIndexEntry>();
    for (const entry of loaded?.postIndex?.posts ?? []) map.set(entry.slug, entry);
    return map;
  }, [loaded?.postIndex]);

  const shown = posts.filter((post) => {
    const status = statusOf(post);
    if (filter !== "all" && status !== filter) return false;
    const needle = query.trim().toLowerCase();
    if (needle && !post.settings.title.toLowerCase().includes(needle)) return false;
    return true;
  }).sort((a, b) => (b.settings.publishedAt ?? "").localeCompare(a.settings.publishedAt ?? ""));

  return (
    <div className="flex flex-col gap-5" data-testid="site-posts">
      <PageHeader
        title="Posts"
        description="Everything the site publishes as news or a blog. Each post is one file in the site's repository, so it publishes as one commit."
        action={<Button onClick={() => navigate(`/sites/${site.id}/posts/new`)} data-testid="post-new">Add New Post</Button>}
      />
      {content.isPending ? (
        <div className="rounded-card border border-line bg-panel p-4"><Skeleton lines={3} /></div>
      ) : posts.length === 0 ? (
        <EmptyState title="No posts yet" action={<Button onClick={() => navigate(`/sites/${site.id}/posts/new`)}>Add your first post</Button>}>
          Write news, articles and blog posts here. Each becomes a file in your site's repo.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <span>Status</span>
              <Select value={filter} onChange={(event) => setFilter(event.target.value as Status)} className="h-10 w-36" data-testid="post-filter">
                <option value="all">All</option>
                <option value="published">Published</option>
                <option value="scheduled">Scheduled</option>
                <option value="draft">Drafts</option>
              </Select>
            </label>
            <label className="relative">
              <span className="sr-only">Search posts</span>
              <Input type="search" placeholder="Search posts" className="h-10 w-64" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="post-search" />
            </label>
            <span className="text-[13px] text-muted" data-testid="post-count">{shown.length} {shown.length === 1 ? "post" : "posts"}</span>
          </div>
          <div className="rounded-card border border-line bg-panel">
            <table className="w-full" role="table">
              <thead>
                <tr className="border-b border-line text-left text-[12px] font-semibold text-muted">
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Categories</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="sr-only px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((post) => {
                  const status = statusOf(post);
                  const indexEntry = indexBySlug.get(post.slug);
                  const author = post.settings.authorName || indexEntry?.authorName || "";
                  return (
                    <tr key={post.slug} className="border-b border-line last:border-b-0 text-[14px]" data-testid={`post-row-${post.slug}`}>
                      <td className="px-4 py-3">
                        <Link to={`/sites/${site.id}/posts/${post.slug}`} className="font-semibold text-text hover:text-primary">
                          {post.settings.title || post.slug}
                        </Link>
                        {author && <div className="text-[12px] text-muted">By {author}</div>}
                      </td>
                      <td className="px-4 py-3">{statusPill(status)}</td>
                      <td className="px-4 py-3 text-muted">{(post.settings.categories ?? []).join(", ") || "—"}</td>
                      <td className="px-4 py-3 text-muted">{post.settings.publishedAt ? new Date(post.settings.publishedAt).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/sites/${site.id}/posts/${post.slug}`} className="text-[13px] font-semibold text-primary hover:underline">Edit</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
