/**
 * /sites/:siteId/visual/:pageSlug? — the visual editor route. Loads the site and its
 * published content, applies the agency's branding, and hands over to the workspace.
 * Every way this can fail to start is spelled out, and screens under 900px get a
 * friendly note with the form editor instead.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { useIsStaffFor, useSiteQuery } from "@/components/SiteLayout.tsx";
import { LinkButton, Notice, Skeleton } from "@/components/ui.tsx";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { isHostingOnly } from "@/lib/services.ts";
import { applyAccent } from "@/lib/theme.ts";
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

  if (siteQuery.isPending || (site && contentQuery.isPending)) {
    return (
      <div className="flex h-dvh flex-col bg-ground" role="status" aria-label="Loading the editor">
        <div className="flex h-[60px] items-center gap-4 border-b border-line bg-panel px-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-24" />
        </div>
        <div className="flex flex-1">
          <div className="w-14 bg-ink" />
          <div className="w-[264px] space-y-3 border-r border-line bg-panel p-4">
            <Skeleton className="w-3/4" />
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/2" />
          </div>
          <div className="flex flex-1 justify-center pt-5">
            <div className="skeleton h-full w-[760px] rounded-t-[10px]" />
          </div>
          <div className="w-80 border-l border-line bg-panel p-5">
            <Skeleton className="w-1/2" />
          </div>
        </div>
        <span className="sr-only">Loading your site…</span>
      </div>
    );
  }

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
      initialSlug={pageSlug}
    />
  );
}
