/**
 * Publishing the engine's edits: the changed files with their additions and deletions,
 * the unified diff, a commit message, and one Publish button that commits to the site's
 * branch. A conflict lists each file with "Keep mine" / "Keep theirs" and a retry; a
 * success shows the commit link. Netlify deploys the commit as it always does.
 */
import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { IconCheckCircle, IconExternal, IconGithub } from "../../src/components/icons.tsx";
import { Button, Input, Modal, Notice } from "../../src/components/ui.tsx";
import type { ChangedFile, PublishResult } from "../shared/types.ts";
import type { EngineApi } from "./api.ts";

type Changes = { files: ChangedFile[]; diff: string };

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="max-h-72 overflow-auto rounded-control bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-ink-text" data-testid="engine-diff">
      {lines.map((line, index) => {
        const tone = line.startsWith("+++") || line.startsWith("---") ? "text-white/70" : line.startsWith("@@") ? "text-blue-soft" : line.startsWith("+") ? "bg-green/25 text-white" : line.startsWith("-") ? "bg-red/30 text-white" : undefined;
        return (
          <span key={index} className={clsx("block whitespace-pre", tone)}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

export function EnginePublishDialog(props: { open: boolean; onClose: () => void; api: EngineApi; siteId: string; pageLabel: string; onPublished: () => void }) {
  // Mounted only while open, so every opening starts from a fresh read of the changes.
  return props.open ? <PublishBody {...props} /> : null;
}

function PublishBody({ onClose, api, siteId, pageLabel, onPublished }: { onClose: () => void; api: EngineApi; siteId: string; pageLabel: string; onPublished: () => void }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState(() => `Edit ${pageLabel} in Armature`);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, "mine" | "theirs">>({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    api.changes(siteId).then((answer) => {
      if (!active) return;
      if (!answer.ok) {
        setLoadError(answer.message);
        setChanges(null);
      } else {
        setLoadError(null);
        setChanges({ files: answer.files, diff: answer.diff });
      }
    });
    return () => {
      active = false;
    };
  }, [api, siteId, reload]);

  const publish = async () => {
    setBusy(true);
    const answer = await api.publish({ site: siteId, message: message.trim() || `Edit ${pageLabel} in Armature`, resolutions: Object.keys(resolutions).length ? resolutions : undefined });
    setBusy(false);
    // A network failure has no code: show it like any other failed publish.
    setResult(answer.ok || "code" in answer ? answer : { ok: false, code: "github_error", message: answer.message });
    if (answer.ok) onPublished();
    else setReload((count) => count + 1);
  };

  const conflict = result && !result.ok && result.code === "conflict" ? result : null;
  const success = result && result.ok ? result : null;
  const otherError = result && !result.ok && result.code !== "conflict" ? result : null;
  const total = changes ? changes.files.reduce((sum, file) => ({ add: sum.add + file.additions, del: sum.del + file.deletions }), { add: 0, del: 0 }) : { add: 0, del: 0 };

  return (
    <Modal
      open
      onClose={onClose}
      title={success ? "Published" : "Publish your changes"}
      footer={
        success ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void publish()} loading={busy} disabled={!changes || changes.files.length === 0 || (conflict !== null && conflict.conflicts?.some((item) => !resolutions[item.path]))} data-testid="engine-publish-confirm">
              {conflict ? "Retry publish" : "Publish"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4" data-testid="engine-publish-dialog">
        {success && (
          <div className="flex flex-col gap-3">
            <Notice kind="success" title="One commit, on the site's branch">
              <p>
                {success.files.length === 1 ? "1 file" : `${success.files.length} files`} committed as <code className="font-mono text-[12px]">{success.commitSha.slice(0, 7)}</code>.{success.rebased.length > 0 ? ` ${success.rebased.length} file(s) were rebased onto newer changes first.` : ""}
              </p>
              <p className="mt-1">Netlify deploys as usual: the live site updates in a few minutes.</p>
            </Notice>
            <a href={success.commitUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[14px] font-semibold text-accent underline-offset-2 hover:underline" data-testid="engine-commit-link">
              <IconGithub size={16} /> View the commit on GitHub <IconExternal size={14} />
            </a>
          </div>
        )}
        {!success && loadError && <Notice kind="danger" title="The changes could not be read">{loadError}</Notice>}
        {!success && otherError && <Notice kind={otherError.code === "nothing" ? "info" : "danger"} title={otherError.code === "nothing" ? "Nothing to publish" : "The publish failed"}>{otherError.message}</Notice>}
        {!success && conflict && (
          <Notice kind="warning" title="Someone else changed these files first">
            <p>{conflict.message}</p>
            <ul className="mt-2 flex flex-col gap-2" data-testid="engine-conflicts">
              {(conflict.conflicts ?? []).map((item) => (
                <li key={item.path} className="flex flex-col gap-1 rounded-control border border-line bg-panel p-2 text-[13px]">
                  <span className="font-mono text-[12px] text-text">{item.path}</span>
                  <span className="text-muted">{item.message}</span>
                  <span className="flex gap-1.5 pt-1">
                    {(["mine", "theirs"] as const).map((choice) => (
                      <button key={choice} type="button" onClick={() => setResolutions((current) => ({ ...current, [item.path]: choice }))} aria-pressed={resolutions[item.path] === choice} className={clsx("h-7 rounded-sm border px-2.5 text-[12px] font-semibold", resolutions[item.path] === choice ? "border-accent bg-blue-soft text-accent" : "border-line text-text hover:bg-ground")} data-testid={`engine-keep-${choice}`}>
                        {choice === "mine" ? "Keep mine" : "Keep theirs"}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {!success && changes && (
          <>
            <div>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                {changes.files.length === 0 ? "No changed files" : changes.files.length === 1 ? "1 changed file" : `${changes.files.length} changed files`}
                {changes.files.length > 0 && (
                  <span className="ml-2 font-mono normal-case tracking-normal">
                    <span className="text-green">+{total.add}</span> <span className="text-red">-{total.del}</span>
                  </span>
                )}
              </h3>
              <ul className="flex flex-col divide-y divide-line rounded-control border border-line" data-testid="engine-changed-files">
                {changes.files.map((file) => (
                  <li key={file.path} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={clsx("h-2 w-2 shrink-0 rounded-full", file.status === "added" ? "bg-green" : file.status === "deleted" ? "bg-red" : "bg-amber")} aria-label={file.status} />
                      <span className="truncate font-mono text-[12px] text-text">{file.path}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">
                      {file.binary ? "binary" : (
                        <>
                          <span className="text-green">+{file.additions}</span> <span className="text-red">-{file.deletions}</span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
                {changes.files.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">Everything you see is already on the branch.</li>}
              </ul>
            </div>
            {changes.diff.trim().length > 0 && <DiffView diff={changes.diff} />}
            <label className="flex flex-col gap-1.5 text-[13px] font-medium text-text">
              Commit message
              <Input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={200} data-testid="engine-commit-message" />
            </label>
            <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
              <IconCheckCircle size={14} className="mt-0.5 shrink-0" /> Publishing commits these files to the site's branch on GitHub. Netlify deploys as usual.
            </p>
          </>
        )}
        {!success && !changes && !loadError && <p className="text-[13px] text-muted">Reading the changes…</p>}
      </div>
    </Modal>
  );
}
