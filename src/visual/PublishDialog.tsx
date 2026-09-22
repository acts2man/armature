/**
 * Publish: a summary grouped by page, then progress, then "Published. Live in about
 * 2 minutes" with the commit link. A conflict names the fields someone else changed
 * and offers to reload while keeping the rest of the draft.
 */
import { IconCheckCircle, IconExternal, IconImage } from "@/components/icons.tsx";
import { Button, Modal, Notice, SrOnly } from "@/components/ui.tsx";
import { shortSha } from "@/lib/format.ts";
import type { Failure } from "@/lib/functions.ts";
import type { ChangeSummaryPage } from "./draftStore.ts";

export type PublishState =
  | { step: "summary" }
  | { step: "publishing"; stage: string }
  | { step: "done"; commitSha: string; commitUrl: string; count: number }
  | { step: "conflict"; failure: Failure }
  | { step: "failed"; failure: Failure };

export function PublishDialog({
  open,
  state,
  summary,
  siteName,
  onClose,
  onPublish,
  onReloadKeepRest,
  onDiscardAndReload,
}: {
  open: boolean;
  state: PublishState;
  summary: ChangeSummaryPage[];
  siteName: string;
  onClose: () => void;
  onPublish: () => void;
  onReloadKeepRest: () => void;
  onDiscardAndReload: () => void;
}) {
  const total = summary.reduce((sum, page) => sum + page.items.length, 0);
  const title =
    state.step === "done" ? "Published" : state.step === "publishing" ? "Publishing…" : state.step === "conflict" ? "Nothing was published" : state.step === "failed" ? "Nothing was published" : `Publish ${total} ${total === 1 ? "change" : "changes"} to ${siteName}`;

  return (
    <Modal
      open={open}
      onClose={state.step === "publishing" ? () => undefined : onClose}
      title={title}
      footer={
        state.step === "summary" ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Not yet
            </Button>
            <Button onClick={onPublish} data-testid="publish-confirm">
              Publish now
            </Button>
          </>
        ) : state.step === "done" ? (
          <Button onClick={onClose}>Done</Button>
        ) : state.step === "conflict" ? (
          <>
            <Button variant="secondary" onClick={onDiscardAndReload}>
              Discard my changes and reload
            </Button>
            <Button onClick={onReloadKeepRest}>Reload and keep the rest</Button>
          </>
        ) : state.step === "failed" ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : undefined
      }
    >
      {state.step === "summary" && (
        <div className="flex flex-col gap-4" data-testid="publish-summary">
          <p className="text-[14px] leading-relaxed text-muted">Everything below goes live in one publish. Nothing else on the site changes.</p>
          <ul className="flex flex-col gap-3">
            {summary.map((page) => (
              <li key={page.slug} className="rounded-[10px] border border-line">
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <span className="text-[14px] font-semibold text-text">{page.label}</span>
                  <span className="text-[12px] text-muted">
                    {page.items.length} {page.items.length === 1 ? "change" : "changes"}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {page.items.map((item) => (
                    <li key={item.root} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                      <span className="min-w-0">
                        <span className="font-medium text-text">{item.label}</span>
                        <span className="text-muted"> · {item.sectionLabel}</span>
                      </span>
                      {item.images > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-accent">
                          <IconImage size={14} /> {item.images === 1 ? "new picture" : `${item.images} new pictures`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.step === "publishing" && (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" aria-hidden="true" />
            <span className="text-[14px] font-medium text-text">{state.stage}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-muted">Your changes are being checked against the site's rules and committed to its repository. Keep this tab open; it takes a few seconds.</p>
        </div>
      )}
      {state.step === "done" && (
        <div className="flex flex-col gap-3" data-testid="publish-done">
          <div className="flex items-center gap-3 text-green">
            <IconCheckCircle size={22} />
            <p className="text-[15px] font-semibold text-text">
              Published {state.count} {state.count === 1 ? "change" : "changes"}. Live in about 2 minutes.
            </p>
          </div>
          <p className="text-[13px] leading-relaxed text-muted">The site's host is rebuilding it now. The page here keeps showing your published words straight away.</p>
          <a href={state.commitUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1.5 font-mono text-[13px] text-text underline underline-offset-2">
            View the commit ({shortSha(state.commitSha)}) <IconExternal size={13} />
            <SrOnly>(opens in a new tab)</SrOnly>
          </a>
        </div>
      )}
      {state.step === "conflict" && (
        <div className="flex flex-col gap-3" data-testid="publish-conflict">
          <Notice kind="danger" title="Someone else changed some of these fields while you were editing">
            <p>{state.failure.message}</p>
          </Notice>
          {(state.failure.fields ?? []).length > 0 && (
            <ul className="list-inside list-disc text-[14px] text-text">
              {(state.failure.fields ?? []).map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          )}
          <p className="text-[13px] leading-relaxed text-muted">"Reload and keep the rest" drops only the fields above from your draft, loads their published version, and keeps everything else you changed.</p>
        </div>
      )}
      {state.step === "failed" && (
        <Notice kind="danger" title="The publish did not go through">
          {state.failure.message}
        </Notice>
      )}
    </Modal>
  );
}
