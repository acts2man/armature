/**
 * What the editor looks like before it knows what it is: a skeleton of the builder layout
 * (top bar, left panel, canvas sheet) with one line of status. Shown by the route while
 * the site and its content load, and by the workspace while the handshake decides
 * whether the site is a builder site or a Stage 1 site, so neither editor ever flashes.
 */
import { Skeleton } from "@/components/ui.tsx";

export function SkeletonTopBar() {
  return (
    <div className="flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-panel pr-4" aria-hidden="true" data-testid="skeleton-topbar">
      <div className="h-[60px] w-14 shrink-0 bg-ink" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-6 w-24" />
      <div className="flex-1" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-8 w-24" />
    </div>
  );
}

export function SkeletonPanel() {
  return (
    <div className="w-[264px] shrink-0 space-y-3 border-r border-line bg-panel p-4" aria-hidden="true" data-testid="skeleton-panel">
      <Skeleton className="w-3/4" />
      <Skeleton className="w-2/3" />
      <Skeleton className="w-1/2" />
      <div className="pt-4" />
      <Skeleton className="w-full" />
      <Skeleton className="w-5/6" />
      <Skeleton className="w-2/3" />
    </div>
  );
}

/** The whole editor as a skeleton, with the status line in the sheet. */
export function EditorSkeleton({ message }: { message: string }) {
  return (
    <div className="flex h-dvh flex-col bg-ground" role="status" aria-live="polite" aria-label={message} data-testid="editor-skeleton">
      <SkeletonTopBar />
      <div className="flex min-h-0 flex-1">
        <SkeletonPanel />
        <div className="relative flex flex-1 justify-center pt-5">
          <div className="skeleton h-full w-[760px] max-w-[calc(100%-40px)] rounded-t-[10px]" aria-hidden="true" />
          <p className="absolute inset-x-0 bottom-8 text-center text-[13px] font-medium text-muted">{message}</p>
        </div>
      </div>
    </div>
  );
}
