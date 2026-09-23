/**
 * Publish history — every publish attempt for one site, newest first, with who
 * made it, which fields changed, and the commit it produced. Failures keep their
 * error text on screen behind a "Why it failed" disclosure.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { IconExternal, IconHistory } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { EmptyState, Notice, PageHeader, Panel, Pill, SkeletonRows, SrOnly, type PillTone } from "@/components/ui.tsx";
import { formatDateTime, plural, shortSha } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import { PUBLISH_STATUS_LABELS, type Profile, type Publish, type PublishStatus } from "@/lib/types.ts";

const PUBLISH_TONES: Record<PublishStatus, PillTone> = { committed: "green", conflict: "amber", failed: "danger" };

type Person = Pick<Profile, "id" | "email" | "full_name">;

type HistoryData = {
  publishes: Publish[];
  /** Profiles by user id. RLS may hide some, in which case the row shows "—". */
  people: Record<string, Person>;
  /** A problem reading profiles; the history still renders without names. */
  peopleError: string | null;
};

async function loadHistory(siteId: string): Promise<HistoryData> {
  const { data, error } = await supabase.from("publishes").select("*").eq("site_id", siteId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  const publishes = (data ?? []) as Publish[];

  const ids = [...new Set(publishes.map((publish) => publish.user_id).filter((id): id is string => typeof id === "string" && id.length > 0))];
  const people: Record<string, Person> = {};
  let peopleError: string | null = null;
  if (ids.length > 0) {
    const profiles = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
    if (profiles.error) peopleError = profiles.error.message;
    else for (const row of (profiles.data ?? []) as Person[]) people[row.id] = row;
  }
  return { publishes, people, peopleError };
}

const personName = (person: Person | undefined): string => person?.full_name?.trim() || person?.email?.trim() || "—";
const whoFor = (publish: Publish, people: Record<string, Person>): string => personName(publish.user_id ? people[publish.user_id] : undefined);

function CommitLink({ publish }: { publish: Publish }) {
  if (!publish.commit_url) return <span className="text-muted">—</span>;
  return (
    <a href={publish.commit_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-text underline-offset-2 hover:underline">
      {shortSha(publish.commit_sha) || "commit"}
      <IconExternal size={12} />
      <SrOnly>(opens the commit in a new tab)</SrOnly>
    </a>
  );
}

/** Rendered only for conflict and failed rows: the error text, kept on screen behind a disclosure. */
function FailureDetails({ publish }: { publish: Publish }) {
  return (
    <details className="rounded-control bg-red-soft px-3 text-[13px]">
      <summary className="cursor-pointer py-2 font-semibold text-red">Why it failed</summary>
      <p className="whitespace-pre-wrap break-words pb-3 text-text">{publish.error?.trim() || "No details were recorded for this attempt."}</p>
    </details>
  );
}

const COLUMNS = "1.3fr 1fr 1fr 1.4fr 100px 90px";

function HistoryRows({ publishes, people }: { publishes: Publish[]; people: Record<string, Person> }) {
  return (
    <>
      <div className="hidden h-10 items-center gap-3 border-b border-line px-5 text-[12px] font-semibold text-muted md:grid" style={{ gridTemplateColumns: COLUMNS }}>
        <div>When</div>
        <div>Who</div>
        <div>Page</div>
        <div>Fields</div>
        <div>Status</div>
        <div>Commit</div>
      </div>
      {publishes.map((publish) => (
        <div key={publish.id} className="border-b border-line last:border-b-0">
          <div className="grid items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px] md:min-h-[58px] md:px-5" style={{ gridTemplateColumns: "1fr auto" }}>
            <div className="contents md:hidden">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-text">{publish.page_slug}</div>
                <div className="text-muted">
                  {formatDateTime(publish.created_at)} · {whoFor(publish, people)}
                </div>
                <div className="mt-1 break-words font-mono text-[12px] text-muted">{publish.fields_changed.join(", ") || "no fields"}</div>
                <div className="mt-1">
                  <CommitLink publish={publish} />
                </div>
              </div>
              <Pill tone={PUBLISH_TONES[publish.status]}>{PUBLISH_STATUS_LABELS[publish.status]}</Pill>
            </div>
            <div className="col-span-2 hidden items-center gap-3 md:grid" style={{ gridTemplateColumns: COLUMNS }}>
              <div className="text-text">{formatDateTime(publish.created_at)}</div>
              <div className="truncate text-text">{whoFor(publish, people)}</div>
              <div className="truncate text-[14px] font-semibold text-text">{publish.page_slug}</div>
              <div className="min-w-0">
                <div className="text-text">{plural(publish.fields_changed.length, "field")}</div>
                {publish.fields_changed.length > 0 && <div className="truncate font-mono text-[12px] text-muted" title={publish.fields_changed.join(", ")}>{publish.fields_changed.join(", ")}</div>}
              </div>
              <div>
                <Pill tone={PUBLISH_TONES[publish.status]}>{PUBLISH_STATUS_LABELS[publish.status]}</Pill>
              </div>
              <div>
                <CommitLink publish={publish} />
              </div>
            </div>
          </div>
          {publish.status !== "committed" && (
            <div className="px-4 pb-3 md:px-5">
              <FailureDetails publish={publish} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export function PublishHistory({ embedded = false }: { embedded?: boolean } = {}) {
  const { site } = useSite();
  const query = useQuery({ queryKey: ["site-publishes", site.id, "history"], queryFn: () => loadHistory(site.id) });

  let body: ReactNode;
  if (query.isPending) {
    body = <SkeletonRows rows={4} label="Loading publish history" />;
  } else if (query.isError) {
    body = (
      <div className="p-4">
        <Notice kind="danger" title="The publish history could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  } else if (query.data.publishes.length === 0) {
    body = (
      <div className="p-5">
        <EmptyState title="Nothing has been published yet" icon={<IconHistory size={18} />}>
          When someone publishes a page, the attempt and the commit it made will be listed here.
        </EmptyState>
      </div>
    );
  } else {
    body = (
      <>
        {query.data.peopleError && (
          <div className="p-4">
            <Notice kind="warning" title="Names could not be loaded">
              {query.data.peopleError}
            </Notice>
          </div>
        )}
        <HistoryRows publishes={query.data.publishes} people={query.data.people} />
      </>
    );
  }

  const count = query.data?.publishes.length;
  return (
    <div className="flex flex-col gap-5">
      {!embedded && <PageHeader title="Publish history" description="Every publish attempt, newest first, with a link to the commit it made." />}
      <Panel title="Publishes" aside={count !== undefined ? <span className="text-[12px] text-muted">{count >= 100 ? "The latest 100" : plural(count, "attempt")}</span> : undefined}>
        {body}
      </Panel>
    </div>
  );
}
