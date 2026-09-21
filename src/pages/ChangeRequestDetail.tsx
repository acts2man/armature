/**
 * One change request: what the client asked for, the screenshots they attached,
 * and the agency's status and note. Agency staff edit the status and note here;
 * clients read them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Card, Field, Notice, PageHeader, Pill, Select, Spinner, SrOnly, Textarea } from "@/components/ui.tsx";
import { relativeTime } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import {
  ATTACHMENTS_BUCKET,
  CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_STATUS_LABELS,
  type ChangeRequest,
  type ChangeRequestAttachment,
  type ChangeRequestStatus,
} from "@/lib/types.ts";

const STATUS_TONES: Record<ChangeRequestStatus, "accent" | "warning" | "success" | "neutral"> = {
  new: "accent",
  in_progress: "warning",
  ready_for_review: "accent",
  done: "success",
  declined: "neutral",
};

function RequestStatusPill({ status }: { status: ChangeRequestStatus }) {
  return <Pill tone={STATUS_TONES[status]}>{CHANGE_REQUEST_STATUS_LABELS[status]}</Pill>;
}

const NOTE_MAX = 10000;

type Creator = { email: string | null; full_name: string | null };

type RequestData = {
  request: ChangeRequest | null;
  attachments: ChangeRequestAttachment[];
  creator: Creator | null;
};

async function loadRequest(requestId: string, siteId: string): Promise<RequestData> {
  // Scoped to the site in the URL, so /sites/A/requests/{id from site B} is treated as unavailable
  // rather than rendered under site A's navigation.
  const { data, error } = await supabase
    .from("change_requests")
    .select("*")
    .eq("id", requestId)
    .eq("site_id", siteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const request = (data as ChangeRequest | null) ?? null;
  if (!request) return { request: null, attachments: [], creator: null };

  const [attachmentsResult, creatorResult] = await Promise.all([
    supabase
      .from("change_request_attachments")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true }),
    request.created_by
      ? supabase.from("profiles").select("email, full_name").eq("id", request.created_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (attachmentsResult.error) throw new Error(`Could not load attachments: ${attachmentsResult.error.message}`);
  if (creatorResult.error) throw new Error(`Could not load who opened this: ${creatorResult.error.message}`);

  return {
    request,
    attachments: (attachmentsResult.data ?? []) as ChangeRequestAttachment[],
    creator: (creatorResult.data as Creator | null) ?? null,
  };
}

async function signAttachments(paths: string[]): Promise<Record<string, string>> {
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error(error.message);
  const urls: Record<string, string> = {};
  const problems: string[] = [];
  for (const item of data) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
    else problems.push(`${item.path ?? "unknown file"}: ${item.error ?? "no link returned"}`);
  }
  if (problems.length > 0 && Object.keys(urls).length === 0) throw new Error(problems.join("\n"));
  return urls;
}

function creatorName(creator: Creator | null): string {
  if (!creator) return "—";
  return creator.full_name?.trim() || creator.email?.trim() || "—";
}

function Attachments({ attachments }: { attachments: ChangeRequestAttachment[] }) {
  const paths = attachments.map((attachment) => attachment.storage_path);
  const query = useQuery({
    queryKey: ["change-request-attachment-urls", paths],
    queryFn: () => signAttachments(paths),
    enabled: paths.length > 0,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  if (attachments.length === 0) return null;

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Loading screenshots" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="Screenshots could not be loaded">
        {query.error.message}
      </Notice>
    );
  } else {
    body = (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {attachments.map((attachment, index) => {
          const url = query.data[attachment.storage_path];
          const label = `Screenshot ${index + 1}`;
          return (
            <li key={attachment.id}>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-line"
                >
                  <img src={url} alt={label} className="aspect-square w-full object-cover" />
                  <SrOnly>(opens in a new tab)</SrOnly>
                </a>
              ) : (
                <p className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line p-2 text-center text-xs text-muted">
                  {label} could not be linked
                </p>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Screenshots</h2>
      {body}
    </section>
  );
}

function StaffForm({ request, siteId }: { request: ChangeRequest; siteId: string }) {
  const queryClient = useQueryClient();
  // Local state holds the saved values after Save, so the form is keyed on the request id only:
  // remounting on every updated_at change would discard the mutation's success state (and any
  // in-flight edits) as soon as the refetch landed.
  const [status, setStatus] = useState<ChangeRequestStatus>(request.status);
  const [note, setNote] = useState(request.agency_note);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("change_requests")
        .update({ status, agency_note: note.trim() })
        .eq("id", request.id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error("Nothing was saved. Only staff of the agency that looks after this site can update a request.");
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["change-request", request.id] }),
        queryClient.invalidateQueries({ queryKey: ["change-requests", siteId] }),
        queryClient.invalidateQueries({ queryKey: ["agency-requests"] }),
      ]);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Status" htmlFor="request-status">
        <Select
          id="request-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as ChangeRequestStatus)}
          disabled={mutation.isPending}
        >
          {CHANGE_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {CHANGE_REQUEST_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note to the client" htmlFor="request-note" hint="The client sees this on the request.">
        <Textarea
          id="request-note"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={mutation.isPending}
        />
      </Field>
      {mutation.isError && (
        <Notice kind="danger" title="The request could not be saved">
          {mutation.error.message}
        </Notice>
      )}
      {mutation.isSuccess && <Notice kind="success">Saved</Notice>}
      <Button type="submit" loading={mutation.isPending}>
        Save
      </Button>
    </form>
  );
}

export function ChangeRequestDetail() {
  const { site, isStaff } = useSite();
  const { requestId = "" } = useParams();

  // The request id comes first so StaffForm's `["change-request", id]` invalidation still matches.
  const query = useQuery({
    queryKey: ["change-request", requestId, site.id],
    queryFn: () => loadRequest(requestId, site.id),
    enabled: requestId.length > 0,
  });

  const backLink = (
    <Link
      to={`/sites/${site.id}/requests`}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-muted underline-offset-2 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to change requests
    </Link>
  );

  if (query.isPending) {
    return (
      <div className="space-y-4">
        {backLink}
        <Spinner label="Loading request" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        {backLink}
        <Notice kind="danger" title="The request could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  }
  const { request, attachments, creator } = query.data;
  if (!request) {
    return (
      <div className="space-y-4">
        {backLink}
        <Notice kind="warning" title="This request is not available to your account">
          Either it does not exist, or it belongs to a site your account cannot see.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backLink}
      <PageHeader
        title={request.title}
        eyebrow={<RequestStatusPill status={request.status} />}
        description={
          <>
            Opened by {creatorName(creator)} {relativeTime(request.created_at)}
            {request.updated_at !== request.created_at && <> · Updated {relativeTime(request.updated_at)}</>}
          </>
        }
      />

      <Card as="section">
        <h2 className="text-lg font-semibold text-ink">What should change</h2>
        {request.details.trim() ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] text-text">{request.details}</p>
        ) : (
          <p className="mt-2 text-sm text-muted">No details were given.</p>
        )}
      </Card>

      <Attachments attachments={attachments} />

      <Card as="section">
        <h2 className="text-lg font-semibold text-ink">From the agency</h2>
        {isStaff ? (
          <div className="mt-4">
            <StaffForm key={request.id} request={request} siteId={site.id} />
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Status</span>
              <RequestStatusPill status={request.status} />
            </div>
            {request.agency_note.trim() ? (
              <p className="whitespace-pre-wrap break-words text-[15px] text-text">{request.agency_note}</p>
            ) : (
              <p className="text-sm text-muted">No note yet</p>
            )}
            <p className="text-sm text-muted">The agency updates this as work progresses.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
