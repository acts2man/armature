/**
 * Shared presentation rules for change requests: which pill colour each status
 * gets, and the progress steps a request has been through. Pure module.
 */
import type { PillTone } from "@/components/ui.tsx";
import { CHANGE_REQUEST_STATUS_LABELS, type ChangeRequest, type ChangeRequestStatus } from "./types.ts";

export const REQUEST_TONES: Record<ChangeRequestStatus, PillTone> = {
  new: "blue",
  in_progress: "amber",
  ready_for_review: "blue",
  done: "green",
  declined: "grey",
};

export type RequestStep = { title: string; detail?: string; state: "done" | "current" | "todo" };

const ORDER: ChangeRequestStatus[] = ["new", "in_progress", "ready_for_review", "done"];

/** The four-step progress list for a request, from its status alone. */
export function requestSteps(request: Pick<ChangeRequest, "status">): RequestStep[] {
  if (request.status === "declined") {
    return [
      { title: "Request sent", state: "done" },
      { title: "Declined", detail: "The agency will not make this change. Their note explains why.", state: "current" },
    ];
  }
  const index = ORDER.indexOf(request.status);
  const detail: Record<ChangeRequestStatus, string> = {
    new: "Waiting for the agency to pick it up",
    in_progress: "The agency is working on it",
    ready_for_review: "Take a look and reply if anything is off",
    done: "The change is live",
    declined: "",
  };
  return ORDER.map((status, position) => ({
    title: status === "new" ? "Request sent" : CHANGE_REQUEST_STATUS_LABELS[status],
    detail: position === index ? detail[status] : undefined,
    state: position < index || (status === "done" && index === ORDER.length - 1) ? "done" : position === index ? "current" : "todo",
  }));
}
