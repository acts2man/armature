/**
 * /sites/:siteId/posts/:slug (or /new) — a lightweight post editor. Title, slug,
 * excerpt, cover image URL, categories/tags, publish date, and a rich-text body
 * using the existing RichTextEditor. Save draft, Publish now, Schedule.
 *
 * The heavy full-screen visual post editor (drag-and-drop, every builder widget) lives
 * on the same underlying post document; this simpler editor writes the same
 * content/posts/<slug>.json file, so the deeper editor can pick it up later without
 * a data migration.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { RichTextEditor } from "@/builder/RichTextEditor.tsx";
import { defaultSiteKit } from "@shared/builder/index.ts";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Field, Input, Notice, PageHeader, Textarea, useToast } from "@/components/ui.tsx";
import { contentQueryKey, useSiteContent } from "@/hooks/useSiteContent.ts";
import { callFunction } from "@/lib/functions.ts";
import type { BuilderPublishRequest, BuilderPublishResponse } from "@shared/publishTypes.ts";
import type { PostDoc, RichDoc } from "@shared/builder/index.ts";

function slugify(input: string): string {
  return input.toLowerCase().normalize("NFKD").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "untitled";
}

function emptyDoc(): RichDoc {
  return { type: "doc", content: [{ type: "paragraph", content: [] }] };
}

function makeElementId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0").slice(0, 8);
}

export function PostEditor() {
  const { site } = useSite();
  const { slug: slugParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const content = useSiteContent(site.id);
  const queryClient = useQueryClient();

  const loaded = content.data?.ok ? content.data : null;
  const existing: PostDoc | undefined = loaded?.posts?.[slugParam ?? ""];
  const [title, setTitle] = useState(existing?.settings.title ?? "");
  const [manualSlug, setManualSlug] = useState(existing?.slug ?? "");
  const [autoSlug, setAutoSlug] = useState(!existing);
  const slug = autoSlug ? slugify(title) : manualSlug;
  const setSlug = (next: string) => setManualSlug(next);
  const [excerpt, setExcerpt] = useState(existing?.settings.excerpt ?? "");
  const [coverImage, setCoverImage] = useState(existing?.settings.coverImage ?? "");
  const [categories, setCategories] = useState((existing?.settings.categories ?? []).join(", "));
  const [tags, setTags] = useState((existing?.settings.tags ?? []).join(", "));
  const [publishedAt, setPublishedAt] = useState(existing?.settings.publishedAt ?? "");
  const [doc, setDoc] = useState<RichDoc>(() => {
    const body = existing?.root.find((element) => element.type === "text");
    return body && body.props && typeof body.props === "object" ? ((body.props as { doc?: RichDoc }).doc ?? emptyDoc()) : emptyDoc();
  });
  const [error, setError] = useState<string | null>(null);


  const isNew = !existing;
  const effectiveSlug = slug.trim() || slugify(title);

  const publish = useMutation({
    mutationFn: async (kind: "draft" | "publish" | "schedule") => {
      if (!loaded?.commitSha) throw new Error("Content not loaded yet.");
      if (!title.trim()) throw new Error("A post needs a title.");
      const at = kind === "publish" ? new Date().toISOString() : kind === "schedule" ? (publishedAt || new Date().toISOString()) : "";
      const bodyElementId = existing?.root.find((e) => e.type === "text")?.id ?? makeElementId();
      const post: PostDoc = {
        version: 1,
        kind: "post",
        slug: effectiveSlug,
        path: `/blog/${effectiveSlug}/`,
        settings: {
          title: title.trim(),
          excerpt: excerpt.trim() || undefined,
          coverImage: coverImage.trim() || undefined,
          author: user?.id ?? undefined,
          authorName: (user?.user_metadata?.["full_name"] as string | undefined) || user?.email || undefined,
          publishedAt: at || undefined,
          categories: categories.split(",").map((c) => c.trim()).filter(Boolean),
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        },
        root: [
          { id: bodyElementId, type: "text", props: { doc }, style: {}, advanced: {}, meta: { createdBy: user?.id ?? "unknown", updatedAt: new Date().toISOString() } },
        ],
      };
      const request: BuilderPublishRequest = {
        site_id: site.id,
        baseCommitSha: loaded.commitSha,
        pages: [],
        layouts: {},
        kit: null,
        media: null,
        resolutions: {},
        posts: { [effectiveSlug]: post },
      };
      const result = await callFunction<BuilderPublishResponse>("builder-publish", request);
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onSuccess: (_result, kind) => {
      const noun = kind === "publish" ? "Published" : kind === "schedule" ? "Scheduled" : "Saved as draft";
      toast.show(`${noun}: "${title}"`);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: contentQueryKey(site.id) });
      if (isNew) navigate(`/sites/${site.id}/posts/${effectiveSlug}`);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const trash = useMutation({
    mutationFn: async () => {
      if (!loaded?.commitSha) throw new Error("Content not loaded yet.");
      const request: BuilderPublishRequest = {
        site_id: site.id,
        baseCommitSha: loaded.commitSha,
        pages: [], layouts: {}, kit: null, media: null, resolutions: {},
        posts: { [effectiveSlug]: null },
      };
      const result = await callFunction<BuilderPublishResponse>("builder-publish", request);
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => {
      toast.show(`Deleted: "${title}"`);
      void queryClient.invalidateQueries({ queryKey: contentQueryKey(site.id) });
      navigate(`/sites/${site.id}/posts`);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  function submit(event: FormEvent<HTMLFormElement>, kind: "draft" | "publish" | "schedule") {
    event.preventDefault();
    setError(null);
    publish.mutate(kind);
  }

  const scheduleAtMs = publishedAt ? Date.parse(publishedAt) : NaN;
  // The button is enabled when the entered time is valid at all; the exact "in the future"
  // check happens in the mutation, using a fresh Date.now() at click time.
  const scheduleIsValid = Number.isFinite(scheduleAtMs);

  return (
    <div className="flex flex-col gap-5" data-testid="post-editor">
      <PageHeader title={isNew ? "Add New Post" : title || "Untitled post"} description="Write once here; the post publishes as one commit alongside the site's other content." />
      {error && <Notice kind="danger" title="Could not publish">{error}</Notice>}
      <form onSubmit={(event) => submit(event, "publish")} className="flex flex-col gap-4">
        <Field label="Title" htmlFor="post-title">
          <Input id="post-title" value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} required data-testid="post-title" />
        </Field>
        <Field label="Address (slug)" htmlFor="post-slug" hint="Lowercase letters, digits and hyphens. The post lives at /blog/<slug>/.">
          <Input id="post-slug" value={slug} className="font-mono" onChange={(event) => { setAutoSlug(false); setSlug(event.target.value); }} data-testid="post-slug" />
        </Field>
        <Field label="Excerpt" htmlFor="post-excerpt" hint="One or two sentences shown on the blog list and in RSS.">
          <Textarea id="post-excerpt" value={excerpt} maxLength={500} rows={2} onChange={(event) => setExcerpt(event.target.value)} data-testid="post-excerpt" />
        </Field>
        <Field label="Cover image URL" htmlFor="post-cover" hint="A picture on this site (/assets/...) or an https:// URL.">
          <Input id="post-cover" value={coverImage} className="font-mono" onChange={(event) => setCoverImage(event.target.value)} data-testid="post-cover" />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Categories" htmlFor="post-cats" hint="Comma-separated slugs (news, how-to, …).">
            <Input id="post-cats" value={categories} onChange={(event) => setCategories(event.target.value)} data-testid="post-cats" />
          </Field>
          <Field label="Tags" htmlFor="post-tags" hint="Comma-separated slugs.">
            <Input id="post-tags" value={tags} onChange={(event) => setTags(event.target.value)} data-testid="post-tags" />
          </Field>
        </div>
        <Field label="Publish date" htmlFor="post-date" hint="Empty saves as a draft. A future date schedules the publish (a pg_cron job fires it).">
          <Input id="post-date" type="datetime-local" value={publishedAt.slice(0, 16)} onChange={(event) => setPublishedAt(event.target.value)} data-testid="post-date" />
        </Field>
        <Field label="Body" htmlFor="post-body">
          <div id="post-body" data-testid="post-body">
            <RichTextEditor doc={doc} onChange={setDoc} kit={loaded?.siteKit ?? defaultSiteKit()} />
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" loading={publish.isPending && publish.variables === "draft"} onClick={() => publish.mutate("draft")} data-testid="post-save-draft">Save draft</Button>
          <Button type="submit" loading={publish.isPending && publish.variables === "publish"} data-testid="post-publish">Publish now</Button>
          <Button type="button" variant="secondary" disabled={!scheduleIsValid} loading={publish.isPending && publish.variables === "schedule"} onClick={() => publish.mutate("schedule")} data-testid="post-schedule">
            Schedule
          </Button>
          <span className="ml-auto">
            {!isNew && <Button type="button" variant="danger" loading={trash.isPending} onClick={() => { if (confirm(`Delete "${title || slug}"?`)) trash.mutate(); }} data-testid="post-delete">Delete</Button>}
          </span>
        </div>
      </form>
    </div>
  );
}
