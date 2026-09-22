import { REQUEST_TONES } from "@/lib/requests.ts";
import { CHANGE_REQUEST_STATUS_LABELS, type ChangeRequestStatus } from "@/lib/types.ts";
import { Pill } from "./ui.tsx";

export function RequestStatusPill({ status }: { status: ChangeRequestStatus }) {
  return <Pill tone={REQUEST_TONES[status]}>{CHANGE_REQUEST_STATUS_LABELS[status]}</Pill>;
}
