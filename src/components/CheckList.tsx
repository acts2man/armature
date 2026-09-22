/**
 * The connection checklist: a tick, a cross or a dashed circle per step, plus the
 * plain-English fix. Used by "Check connection" and "Add a site".
 */
import type { ConnectionCheck, ConnectionReport } from "@shared/publishTypes.ts";
import { IconCheck, IconDashedCircle, IconX } from "./icons.tsx";
import { Button, Panel, Pill } from "./ui.tsx";

export function CheckRow({ check }: { check: ConnectionCheck }) {
  const icon =
    check.status === "ok" ? (
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-soft text-green">
        <IconCheck size={14} />
      </span>
    ) : check.status === "fail" ? (
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-soft text-red">
        <IconX size={14} />
      </span>
    ) : (
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted/70">
        <IconDashedCircle size={20} />
      </span>
    );

  return (
    <li className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
      {icon}
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-6 text-text">
          {check.label}
          <span className="sr-only">{check.status === "ok" ? " — passed" : check.status === "fail" ? " — failed" : " — not checked"}</span>
        </p>
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted">{check.detail}</p>
        {check.fix && <p className="mt-1.5 whitespace-pre-wrap break-words rounded-sm bg-amber-soft px-2.5 py-1.5 text-[13px] leading-relaxed text-amber">{check.fix}</p>}
      </div>
    </li>
  );
}

export function CheckList({ report, onHide, title }: { report: ConnectionReport; onHide?: () => void; title?: string }) {
  const passed = report.checks.filter((check) => check.status === "ok").length;
  return (
    <Panel
      title={title ?? (report.allPassed ? "Connection check" : "Connection check")}
      aside={
        <>
          <Pill tone={report.allPassed ? "green" : "amber"}>
            {report.allPassed ? "Everything passed" : `${passed} of ${report.checks.length} passed`}
          </Pill>
          {onHide && (
            <Button variant="ghost" size="sm" onClick={onHide}>
              Hide
            </Button>
          )}
        </>
      }
    >
      <ul aria-live="polite">
        {report.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
      <p className="border-t border-line px-4 py-3 text-[12px] text-muted sm:px-5">
        Secret values are never shown here, only whether a setting arrived and how many characters long it is.
      </p>
    </Panel>
  );
}
