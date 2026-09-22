/**
 * One change request, laid out like the fleet screen's request panel: what the
 * client asked for, the screenshots they attached, the progress so far, and the
 * agency's status and note. Agency staff edit the status and note; clients read.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { IconArrowLeft, IconClock, IconImage } from "@/components/icons.tsx";
import { RequestStatusPill } from "@/components/RequestStatus.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Field, Monogram, Notice, PageHeader, Panel, QuoteBlock, Select, Skeleton, SrOnly, Textarea, Timeline, useToast } from "@/components/ui.tsx";
import { formatDateTime, relativeTime } from "@/lib/format.ts";
import { requestSteps } from "@/lib/requests.ts";
import { supabase } from "@/lib/supabase.ts";
import {
  ATTACHMENTS_BUCKET,
  CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_STATUS_LABELS,
  type ChangeRequest,
  type ChangeRequestAttachment,
  type ChangeRequestStatus,
} from "@/lib/types.ts";

const NOTE_MAX = 10000;

type Creator = { email: string | null; full_name: string | null };
type RequestData = { request: ChangeRequest | null; attachments: ChangeRequestAttachment[]; creator: Creator | null };

async function loadRequest(requestId: string, siteId: string): Promise<RequestData> {
  // Scoped to the site in the URL, so /sites/A/requests/{id from site B} is treated as unavailable.
  const { data, error } = await supabase.from("change_requests").select("*").eq("id", requestId).eq("site_id", siteId).maybeSingle();
  if (error) throw new Error(error.message);
  const request = (data as ChangeRequest | null) ?? null;
  if (!request) return { request: null, attachments: [], creator: null };

  const [attachmentsResult, creatorResult] = await Promise.all([
    supabase.from("change_request_attachments").select("*").eq("request_id", requestId).order("created_at", { ascending: true }),
    request.created_by ? supabase.from("profiles").select("email, full_name").eq("id", request.created_by).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (attachmentsResult.error) throw new Error(`Could not load attachments: ${attachmentsResult.error.message}`);
  if (creatorResult.error) throw new Error(`Could not load who opened this: ${creatorResult.error.message}`);

  return { request, attachments: (attachmentsResult.data ?? []) as ChangeRequestAttachment[], creator: (creatorResult.data as Creator | null) ?? null };
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

const creatorName = (creator: Creator | null): string => creator?.full_name?.trim() || creator?.email?.trim() || "The client";

function Attachments({ attachments }: { attachments: ChangeRequestAttachment[] }) {
  const paths = attachments.map((attachment) => attachment.storage_path);
  const query = useQuery({ queryKey: ["change-request-attachment-urls", paths], queryFn: () => signAttachments(paths), enabled: paths.length > 0, retry: false, staleTime: 30 * 60 * 1000 });

  if (attachments.length === 0) return null;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="status" aria-label="Loading screenshots">
        {attachments.map((attachment) => (
          <Skeleton key={attachment.id} className="aspect-square rounded-control" />
        ))}
      </div>
    );
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
                <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-control border border-line">
                  <img src={url} alt={label} className="aspect-square w-full object-cover" />
                  <SrOnly>(opens in a new tab)</SrOnly>
                </a>
              ) : (
                <p className="flex aspect-square items-center justify-center rounded-control border border-dashed border-line p-2 text-center text-[12px] text-muted">{label} could not be linked</p>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Panel title="Screenshots" aside={<span className="inline-flex items-center gap-1 text-[12px] text-muted"><IconImage size={14} /> {attachments.length}</span>}>
      <div className="p-4 sm:p-5">{body}</div>
    </Panel>
  );
}

function StaffForm({ request, siteId }: { request: ChangeRequest; siteId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Local state holds the saved values after Save, so the form is keyed on the request id only.
  const [status, setStatus] = useState<ChangeRequestStatus>(request.status);
  const [note, setNote] = useState(request.agency_note);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("change_requests").update({ status, agency_note: note.trim() }).eq("id", request.id).select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error("Nothing was saved. Only staff of the agency that looks after this site can update a request.");
    },
    onSuccess: async () => {
      toast.show("Request updated");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["change-request", request.id] }),
        queryClient.invalidateQueries({ queryKey: ["change-requests", siteId] }),
        queryClient.invalidateQueries({ queryKey: ["agency-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["open-request-count"] }),
      ]);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Status" htmlFor="request-status">
        <Select id="request-status" value={status} onChange={(event) => setStatus(event.target.value as ChangeRequestStatus)} disabled={mutation.isPending}>
          {CHANGE_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {CHANGE_REQUEST_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note to the client" htmlFor="request-note" hint="The client sees this on the request.">
        <Textarea id="request-note" maxLength={NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} disabled={mutation.isPending} />
      </Field>
      {mutation.isError && (
        <Notice kind="danger" title="The request could not be saved">
          {mutation.error.message}
        </Notice>
      )}
      <div>
        <Button type="submit" loading={mutation.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function ChangeRequestDetail() {
  const { site, isStaff } = useSite();
  const { requestId = "" } = useParams();

  // The request id comes first so StaffForm's `["change-request", id]` invalidation still matches.
  const query = useQuery({ queryKey: ["change-request", requestId, site.id], queryFn: () => loadRequest(requestId, site.id), enabled: requestId.length > 0 });

  const backLink = (
    <Link to={`/sites/${site.id}/requests`} className="inline-flex h-11 items-center gap-2 text-[13px] font-medium text-muted hover:text-text">
      <IconArrowLeft size={16} />
      All change requests
    </Link>
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Loading request">
        {backLink}
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
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
      <div className="flex flex-col gap-4">
        {backLink}
        <Notice kind="warning" title="This request is not available to your account">
          Either it does not exist, or it belongs to a site your account cannot see.
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {backLink}
      <PageHeader
        title={request.title}
        meta={
          <>
            <RequestStatusPill status={request.status} />
            <span>
              Opened by {creatorName(creator)} {relativeTime(request.created_at)}
              {request.updated_at !== request.created_at && <>, updated {relativeTime(request.updated_at)}</>}
            </span>
          </>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_392px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="What should change">
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <Monogram name={creatorName(creator)} size="lg" round />
                <div className="min-w-0">
                  <div className="font-semibold text-text">{creatorName(creator)}</div>
                  <div className="text-[13px] text-muted">asked on {formatDateTime(request.created_at)}</div>
                </div>
              </div>
              <QuoteBlock title={request.title}>{request.details.trim() ? request.details : "No details were given."}</QuoteBlock>
            </div>
          </Panel>
          <Attachments attachments={attachments} />
          <Panel title="From the agency" aside={<RequestStatusPill status={request.status} />}>
            <div className="p-4 sm:p-5">
              {isStaff ? (
                <StaffForm key={request.id} request={request} siteId={site.id} />
              ) : request.agency_note.trim() ? (
                <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text">{request.agency_note}</p>
              ) : (
                <p className="text-[13px] text-muted">No note yet. The agency updates this as work progresses.</p>
              )}
            </div>
          </Panel>
        </div>
        <Panel as="aside" title="Progress" className="xl:sticky xl:top-4">
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-muted">
              <IconClock size={14} />
              <span>Last activity {relativeTime(request.updated_at)}</span>
            </div>
            <Timeline steps={requestSteps(request)} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
