/**
 * The connection checklist, ported from the pilot: a tick, a cross or a dash per
 * step, plus the plain-English fix. Used by "Check connection" and "Add a site".
 */
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { ConnectionCheck, ConnectionReport } from "@shared/publishTypes.ts";
import { Button, Card } from "./ui.tsx";

export function CheckRow({ check }: { check: ConnectionCheck }) {
  const icon =
    check.status === "ok" ? (
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
    ) : check.status === "fail" ? (
      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
    ) : (
      <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-muted/60" aria-hidden="true" />
    );

  return (
    <li className="flex gap-3">
      {icon}
      <div className="min-w-0">
        <p className="font-medium text-text">
          {check.label}
          <span className="sr-only">
            {check.status === "ok" ? " — passed" : check.status === "fail" ? " — failed" : " — not checked"}
          </span>
        </p>
        <p className="whitespace-pre-wrap break-words text-sm text-muted">{check.detail}</p>
        {check.fix && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-warning">{check.fix}</p>}
      </div>
    </li>
  );
}

export function CheckList({
  report,
  onHide,
  title,
}: {
  report: ConnectionReport;
  onHide?: () => void;
  title?: string;
}) {
  return (
    <Card as="section" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">
          {title ?? (report.allPassed ? "Connection check: everything passed" : "Connection check: something needs fixing")}
        </h2>
        {onHide && (
          <Button variant="ghost" size="sm" onClick={onHide}>
            Hide
          </Button>
        )}
      </div>
      <ul className="mt-4 space-y-4">
        {report.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">
        Secret values are never shown here — only whether a setting arrived and how many characters long it is.
      </p>
    </Card>
  );
}
