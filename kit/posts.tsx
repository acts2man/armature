/**
 * Blog rendering for the kit. `<ArmaturePost slug />` renders one post's layout in the
 * site's chrome; `<ArmaturePostList />` renders the list of published posts (from
 * content/posts/index.json) with optional filters. `useBuilderPosts()` returns the
 * published posts, so the site's router can plug them into a route ("/blog/<slug>").
 *
 * Filtering respects `publishedAt`: a post with no publishedAt is a draft; one whose
 * publishedAt is in the future is scheduled and not shown yet. The site is a static
 * React site — the scheduler cron function commits the post at the scheduled time.
 */
import { useMemo, useSyncExternalStore, type ReactElement } from "react";
import { ArmaturePage, useKitSnapshot } from "./renderer.tsx";
import type { PostDoc, PostIndexEntry } from "./types.ts";

/**
 * Rerender once a minute so a scheduled post's move to "published" doesn't need a page
 * reload. `subscribeMinute` implements a tiny store; `useSyncExternalStore` gives React a
 * pure `getSnapshot` (no Date.now() in render).
 */
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | null = null;
function subscribeMinute(listener: () => void): () => void {
  minuteListeners.add(listener);
  if (!minuteTimer && typeof setInterval !== "undefined") {
    minuteTimer = setInterval(() => {
      for (const l of minuteListeners) l();
    }, 60_000);
  }
  return () => {
    minuteListeners.delete(listener);
    if (minuteListeners.size === 0 && minuteTimer) {
      clearInterval(minuteTimer);
      minuteTimer = null;
    }
  };
}
let cachedMinute = -1;
const getMinute = (): number => {
  const now = Date.now();
  const bucket = Math.floor(now / 60_000);
  if (bucket !== cachedMinute) cachedMinute = bucket;
  return cachedMinute;
};
const getServerMinute = () => 0;
function useNowMinute(): number {
  return useSyncExternalStore(subscribeMinute, getMinute, getServerMinute) * 60_000;
}

export type PostListOpts = {
  /** Cap the number of posts shown. */
  limit?: number;
  /** Only posts in this category slug. */
  category?: string;
  /** Only posts in this tag slug. */
  tag?: string;
};

/** Every published post (draft/scheduled posts filtered out), newest first. */
export function useBuilderPosts(opts: PostListOpts = {}): PostIndexEntry[] {
  const snapshot = useKitSnapshot();
  const nowMs = useNowMinute();
  return useMemo(() => filterPosts(snapshot.postIndex.posts, opts, () => nowMs), [snapshot.postIndex, opts, nowMs]);
}

export function filterPosts(all: PostIndexEntry[], opts: PostListOpts, now: () => number): PostIndexEntry[] {
  const stamp = now();
  const shown = all.filter((entry) => {
    if (!entry.publishedAt) return false;
    const at = Date.parse(entry.publishedAt);
    if (!Number.isFinite(at) || at > stamp) return false;
    if (opts.category && !entry.categories.includes(opts.category)) return false;
    if (opts.tag && !entry.tags.includes(opts.tag)) return false;
    return true;
  });
  if (opts.limit && opts.limit > 0) return shown.slice(0, opts.limit);
  return shown;
}

/** The list of posts, as an unordered list of cards. Style with `.ae-post-card` and children. */
export function ArmaturePostList(props: PostListOpts & { className?: string }): ReactElement {
  const entries = useBuilderPosts(props);
  if (entries.length === 0) return <p className={props.className}>No posts yet.</p>;
  return (
    <ul className={props.className ?? "ae-post-list"}>
      {entries.map((post) => (
        <li key={post.slug} className="ae-post-card">
          {post.coverImage && <a href={post.path} className="ae-post-card-image"><img src={post.coverImage} alt="" /></a>}
          <div className="ae-post-card-body">
            <h3 className="ae-post-card-title"><a href={post.path}>{post.title}</a></h3>
            <p className="ae-post-card-meta">
              {post.authorName && <span>{post.authorName}</span>}
              {post.publishedAt && <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>}
            </p>
            {post.excerpt && <p className="ae-post-card-excerpt">{post.excerpt}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One post's layout, from its slug. Renders nothing while the post is a draft or scheduled. */
export function ArmaturePost({ slug }: { slug: string }): ReactElement | null {
  const snapshot = useKitSnapshot();
  const post: PostDoc | undefined = snapshot.posts[slug];
  const nowMs = useNowMinute();
  if (!post) return null;
  if (!post.settings.publishedAt || Date.parse(post.settings.publishedAt) > nowMs) return null;
  const layoutLike = { version: 1 as const, pageSlug: post.slug, path: post.path, label: post.settings.title, seo: post.settings.seo, root: post.root };
  return <ArmaturePage slug={post.slug} layout={layoutLike} />;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
