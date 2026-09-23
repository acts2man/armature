/**
 * /sites/:siteId/visual?page=<slug>&element=<id> — the visual editor route. Loads the site
 * and its published content, applies the agency's branding, and hands over to the
 * workspace. The page comes from the URL (Home only when none is given); an unknown page
 * gets a friendly note and the Pages list. Every way this can fail to start is spelled
 * out, and screens under 900px get a friendly note with the form editor instead. The
 * older /visual/:pageSlug form still works.
 */
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { useIsStaffFor, useSiteQuery } from "@/components/SiteLayout.tsx";
import { LinkButton, Notice } from "@/components/ui.tsx";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { isHostingOnly } from "@/lib/services.ts";
import { applyAccent } from "@/lib/theme.ts";
import { EditorSkeleton } from "./EditorSkeleton.tsx";
import { EditorWorkspace } from "./EditorWorkspace.tsx";
import { TooSmall } from "./Sheets.tsx";

const MIN_WIDTH = 900;

function useWideEnough(): boolean {
  const query = `(min-width: ${MIN_WIDTH}px)`;
  const [wide, setWide] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(query).matches));
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return wide;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ground p-6">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );
}

export function VisualEditor() {
  const { siteId = "", pageSlug } = useParams();
  const [search] = useSearchParams();
  // Read once: the workspace keeps the URL in step as the person moves between pages
  // (including pages that exist only in their draft), and that must never re-run this check.
  const [wantedSlug] = useState(() => search.get("page") || pageSlug || undefined);
  const [elementId] = useState(() => search.get("element"));
  const { user, agency } = useAuth();
  const siteQuery = useSiteQuery(siteId);
  const isStaff = useIsStaffFor(siteQuery.data);
  const site = siteQuery.data ?? null;
  const contentQuery = useSiteContent(siteId);
  const wide = useWideEnough();

  useEffect(() => {
    applyAccent(agency?.accent_color);
  }, [agency?.accent_color]);

  const formEditorHref = `/sites/${siteId}/pages`;
  const homeHref = isStaff ? `/sites/${siteId}` : "/";

  if (!wide) return <TooSmall formEditorHref={formEditorHref} homeHref={homeHref} />;

  if (siteQuery.isPending || (site && contentQuery.isPending)) return <EditorSkeleton message="Loading your site…" />;

  if (siteQuery.isError) {
    return (
      <Frame>
        <Notice kind="danger" title="The site could not be loaded" action={<LinkButton to="/" variant="secondary" size="sm">Go home</LinkButton>}>
          {siteQuery.error.message}
        </Notice>
      </Frame>
    );
  }
  if (!site) {
    return (
      <Frame>
        <Notice kind="warning" title="This site is not available to your account" action={<LinkButton to="/" variant="secondary" size="sm">Go home</LinkButton>}>
          Either it does not exist, or your account has not been given access to it. Ask the agency to invite you.
        </Notice>
      </Frame>
    );
  }
  if (isHostingOnly(site)) {
    return (
      <Frame>
        <Notice kind="info" title="Nothing to edit yet" action={<LinkButton to={homeHref} variant="secondary" size="sm">Back</LinkButton>}>
          {site.name} is a hosting-only site: no repository is connected, so there are no pages to edit or publish.
        </Notice>
      </Frame>
    );
  }
  const content = contentQuery.data;
  if (!content || !content.ok) {
    const message = content && !content.ok ? content.message : contentQuery.error instanceof Error ? contentQuery.error.message : "The site's content could not be read.";
    return (
      <Frame>
        <Notice
          kind="warning"
          title="The site's content could not be loaded"
          action={
            <>
              <LinkButton to={formEditorHref} size="sm">
                Open the page editor
              </LinkButton>
              <LinkButton to={homeHref} variant="secondary" size="sm">
                Back
              </LinkButton>
            </>
          }
        >
          <p>{message}</p>
          <p className="mt-2">The page editor's "Check connection" button explains exactly which step is failing.</p>
        </Notice>
      </Frame>
    );
  }

  // The page must exist: a coded page from the schema, or a builder page with a layout.
  if (wantedSlug && !content.schema.pages.some((page) => page.slug === wantedSlug) && !content.layouts?.[wantedSlug]) {
    return (
      <Frame>
        <Notice
          kind="warning"
          title={`There is no page called "${wantedSlug}"`}
          action={
            <>
              <LinkButton to={`/sites/${siteId}/pages`} size="sm">
                See all pages
              </LinkButton>
              <LinkButton to={`/sites/${siteId}/visual`} variant="secondary" size="sm">
                Open the home page
              </LinkButton>
            </>
          }
        >
          <p>This site has no page with that name. It may have been renamed or removed, or the link may be out of date.</p>
        </Notice>
      </Frame>
    );
  }

  return (
    <EditorWorkspace
      key={`${site.id}:${content.commitSha ? "loaded" : "empty"}`}
      site={site}
      isStaff={isStaff}
      agency={agency}
      userId={user?.id ?? "anonymous"}
      userName={(user?.user_metadata?.["full_name"] as string | undefined)?.trim() || user?.email?.split("@")[0] || "You"}
      content={content}
      refetchContent={contentQuery.refetch}
      initialSlug={wantedSlug}
      initialElementId={elementId && /^[a-z0-9]{8}$/.test(elementId) ? elementId : null}
    />
  );
}
