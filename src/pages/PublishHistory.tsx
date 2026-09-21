/**
 * Publish history — every publish attempt for one site, newest first, with who
 * made it, which fields changed, and the commit it produced. Failures keep their
 * error text on screen behind a "Why it failed" disclosure.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useSite } from "@/components/SiteLayout.tsx";
import { Card, EmptyState, Notice, PageHeader, Pill, Spinner, SrOnly } from "@/components/ui.tsx";
import { formatDateTime, plural, shortSha } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import { PUBLISH_STATUS_LABELS, type Profile, type Publish, type PublishStatus } from "@/lib/types.ts";

type Tone = NonNullable<ComponentProps<typeof Pill>["tone"]>;

const PUBLISH_TONES: Record<PublishStatus, Tone> = { committed: "success", conflict: "warning", failed: "danger" };

type Person = Pick<Profile, "id" | "email" | "full_name">;

type HistoryData = {
  publishes: Publish[];
  /** Profiles by user id. RLS may hide some, in which case the row shows "—". */
  people: Record<string, Person>;
  /** A problem reading profiles; the history still renders without names. */
  peopleError: string | null;
};

async function loadHistory(siteId: string): Promise<HistoryData> {
  const { data, error } = await supabase
    .from("publishes")
    .select("*")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const publishes = (data ?? []) as Publish[];

  const ids = [...new Set(publishes.map((publish) => publish.user_id).filter((id): id is string => typeof id === "string" && id.length > 0))];
  const people: Record<string, Person> = {};
  let peopleError: string | null = null;
  if (ids.length > 0) {
    const profiles = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
    if (profiles.error) {
      peopleError = profiles.error.message;
    } else {
      for (const row of (profiles.data ?? []) as Person[]) people[row.id] = row;
    }
  }
  return { publishes, people, peopleError };
}

const personName = (person: Person | undefined): string => person?.full_name?.trim() || person?.email?.trim() || "—";

function whoFor(publish: Publish, people: Record<string, Person>): string {
  return personName(publish.user_id ? people[publish.user_id] : undefined);
}

function StatusPill({ status }: { status: PublishStatus }) {
  return <Pill tone={PUBLISH_TONES[status]}>{PUBLISH_STATUS_LABELS[status]}</Pill>;
}

function FieldsCell({ publish }: { publish: Publish }) {
  const keys = publish.fields_changed;
  return (
    <div className="min-w-0">
      <p className="text-text">{plural(keys.length, "field")}</p>
      {keys.length > 0 && <p className="break-words font-mono text-xs text-muted">{keys.join(", ")}</p>}
    </div>
  );
}

function CommitCell({ publish }: { publish: Publish }) {
  if (!publish.commit_url) return <span className="text-muted">—</span>;
  return (
    <a
      href={publish.commit_url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-1 font-mono text-sm text-accent underline-offset-2 hover:underline"
    >
      {shortSha(publish.commit_sha) || "commit"}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <SrOnly>(opens the commit in a new tab)</SrOnly>
    </a>
  );
}

/** Rendered only for conflict and failed rows: the error text, kept on screen behind a disclosure. */
function FailureDetails({ publish }: { publish: Publish }) {
  return (
    <details className="rounded-lg bg-danger-soft px-3 text-sm">
      <summary className="cursor-pointer py-3 font-medium text-danger">Why it failed</summary>
      <p className="whitespace-pre-wrap break-words pb-3 text-text">
        {publish.error?.trim() || "No details were recorded for this attempt."}
      </p>
    </details>
  );
}

function HistoryTable({ publishes, people }: { publishes: Publish[]; people: Record<string, Person> }) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line bg-panel sm:block">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="px-4 py-3 font-medium">
              When
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Who
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Page
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Fields
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Commit
            </th>
          </tr>
        </thead>
        {publishes.map((publish) => (
          <tbody key={publish.id} className="border-b border-line last:border-b-0">
            <tr className="align-top">
              <td className="whitespace-nowrap px-4 py-3 text-text">{formatDateTime(publish.created_at)}</td>
              <td className="px-4 py-3 text-text">{whoFor(publish, people)}</td>
              <td className="px-4 py-3 font-medium text-text">{publish.page_slug}</td>
              <td className="px-4 py-3">
                <FieldsCell publish={publish} />
              </td>
              <td className="px-4 py-3">
                <StatusPill status={publish.status} />
              </td>
              <td className="px-4 py-3">
                <CommitCell publish={publish} />
              </td>
            </tr>
            {publish.status !== "committed" && (
              <tr>
                <td colSpan={6} className="px-4 pb-3">
                  <FailureDetails publish={publish} />
                </td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function HistoryCards({ publishes, people }: { publishes: Publish[]; people: Record<string, Person> }) {
  return (
    <ul className="space-y-3 sm:hidden">
      {publishes.map((publish) => (
        <li key={publish.id}>
          <Card as="article">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-text">{publish.page_slug}</p>
              <StatusPill status={publish.status} />
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">When</dt>
              <dd className="text-text">{formatDateTime(publish.created_at)}</dd>
              <dt className="text-muted">Who</dt>
              <dd className="text-text">{whoFor(publish, people)}</dd>
              <dt className="text-muted">Fields</dt>
              <dd>
                <FieldsCell publish={publish} />
              </dd>
              <dt className="text-muted">Commit</dt>
              <dd>
                <CommitCell publish={publish} />
              </dd>
            </dl>
            {publish.status !== "committed" && (
              <div className="mt-3">
                <FailureDetails publish={publish} />
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function PublishHistory() {
  const { site } = useSite();

  const query = useQuery({
    queryKey: ["site-publishes", site.id, "history"],
    queryFn: () => loadHistory(site.id),
  });

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Loading publish history" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="The publish history could not be loaded">
        {query.error.message}
      </Notice>
    );
  } else if (query.data.publishes.length === 0) {
    body = (
      <EmptyState title="Nothing has been published yet">
        When someone publishes a page, the attempt and the commit it made will be listed here.
      </EmptyState>
    );
  } else {
    body = (
      <div className="space-y-4">
        {query.data.peopleError && (
          <Notice kind="warning" title="Names could not be loaded">
            {query.data.peopleError}
          </Notice>
        )}
        <HistoryTable publishes={query.data.publishes} people={query.data.people} />
        <HistoryCards publishes={query.data.publishes} people={query.data.people} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Publish history" description="Every publish attempt, newest first, with a link to the commit it made." />
      {body}
    </div>
  );
}
