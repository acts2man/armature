/**
 * Publish: a summary grouped by page (content changes, page layouts, site settings),
 * then progress, then "Published. Live in about 2 minutes" with the commit link. A
 * content conflict names the fields someone else changed and offers to reload while
 * keeping the rest of the draft; a layout conflict names each element both sides
 * changed and lets the person keep theirs or take the other version, element by element.
 */
import { useState } from "react";
import { IconCheckCircle, IconExternal, IconImage, IconLayout, IconPalette } from "@/components/icons.tsx";
import { Button, Modal, Notice, SrOnly } from "@/components/ui.tsx";
import { shortSha } from "@/lib/format.ts";
import type { Failure } from "@/lib/functions.ts";
import type { ChangeSummaryPage } from "./draftStore.ts";

export type PublishState =
  | { step: "summary" }
  | { step: "publishing"; stage: string }
  | { step: "done"; commitSha: string; commitUrl: string; count: number; merged?: boolean }
  | { step: "conflict"; failure: Failure }
  | { step: "failed"; failure: Failure };

export function PublishDialog({
  open,
  state,
  summary,
  siteName,
  onClose,
  onPublish,
  onPublishWithChoices,
  onReloadKeepRest,
  onDiscardAndReload,
  builder,
}: {
  open: boolean;
  state: PublishState;
  summary: ChangeSummaryPage[];
  siteName: string;
  onClose: () => void;
  onPublish: () => void;
  /** Publish again with a choice for every layout conflict. */
  onPublishWithChoices?: (choices: Record<string, "mine" | "theirs">) => void;
  onReloadKeepRest: () => void;
  onDiscardAndReload: () => void;
  /** What the page builder changed: page layouts (new, changed, deleted), site settings, alt text. */
  builder?: { pages: { slug: string; label: string; kind: "changed" | "new" | "deleted" }[]; kit: boolean; media: boolean };
}) {
  const builderCount = (builder?.pages.length ?? 0) + (builder?.kit ? 1 : 0) + (builder?.media ? 1 : 0);
  const total = summary.reduce((sum, page) => sum + page.items.length, 0) + builderCount;
  const [choices, setChoices] = useState<Record<string, "mine" | "theirs">>({});
  const conflicts = state.step === "conflict" ? (state.failure.conflicts ?? []) : [];
  const allChosen = conflicts.length > 0 && conflicts.every((conflict) => choices[conflict.key]);
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
        ) : state.step === "conflict" && conflicts.length > 0 ? (
          <>
            <Button variant="secondary" onClick={onDiscardAndReload}>
              Discard my changes and reload
            </Button>
            <Button onClick={() => onPublishWithChoices?.(choices)} disabled={!allChosen} data-testid="publish-with-choices">
              Publish with these choices
            </Button>
          </>
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
          {builder && builderCount > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line" data-testid="publish-builder">
              {builder.pages.map((page) => (
                <li key={page.slug} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <IconLayout size={15} className="shrink-0 text-muted" />
                    <span className="truncate font-semibold text-text">{page.label}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-muted">{page.kind === "new" ? "New page" : page.kind === "deleted" ? "Page deleted" : "Layout changed"}</span>
                </li>
              ))}
              {builder.kit && (
                <li className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                  <IconPalette size={15} className="text-muted" />
                  <span className="font-semibold text-text">Site settings</span>
                  <span className="text-muted">· colours, fonts and text styles</span>
                </li>
              )}
              {builder.media && (
                <li className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                  <IconImage size={15} className="text-muted" />
                  <span className="font-semibold text-text">Media library</span>
                  <span className="text-muted">· alt text</span>
                </li>
              )}
            </ul>
          )}
          {total === 0 && <p className="text-[13px] text-muted">There are no changes to publish yet.</p>}
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
          {state.merged && <p className="text-[13px] leading-relaxed text-text">Someone else had published in the meantime; your changes were merged with theirs.</p>}
          <p className="text-[13px] leading-relaxed text-muted">The site's host is rebuilding it now. The page here keeps showing your published words straight away.</p>
          <a href={state.commitUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1.5 font-mono text-[13px] text-text underline underline-offset-2">
            View the commit ({shortSha(state.commitSha)}) <IconExternal size={13} />
            <SrOnly>(opens in a new tab)</SrOnly>
          </a>
        </div>
      )}
      {state.step === "conflict" && conflicts.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="publish-conflict">
          <Notice kind="warning" title="Someone else published changes to the same things">
            <p>Everything else in your draft is kept. For each of these, keep your version or take theirs.</p>
          </Notice>
          <ul className="flex flex-col gap-2">
            {conflicts.map((conflict) => (
              <li key={conflict.key} className="rounded-[10px] border border-line px-4 py-3" data-testid="conflict-item">
                <p className="text-[14px] font-medium text-text">{conflict.label}</p>
                <div role="radiogroup" aria-label={conflict.label} className="mt-2 flex gap-4 text-[13px]">
                  {(["mine", "theirs"] as const).map((choice) => (
                    <label key={choice} className="flex min-h-6 items-center gap-2">
                      <input type="radio" name={conflict.key} checked={choices[conflict.key] === choice} onChange={() => setChoices((current) => ({ ...current, [conflict.key]: choice }))} />
                      {choice === "mine" ? "Keep mine" : "Take theirs"}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.step === "conflict" && conflicts.length === 0 && (
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
