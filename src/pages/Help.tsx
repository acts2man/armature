/**
 * "How Armature works" — the in-app Help section. Agency staff at /agency/help see
 * the full agency guide (docs/guide/agency/*.md); clients see the short "How to edit
 * your site" guide (docs/guide/client/*.md). Search filters entries by title and
 * body; every guide is served straight from the built app so nothing needs the
 * network.
 */
import { useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconHelp, IconSearch } from "@/components/icons.tsx";
import { Input, PageHeader } from "@/components/ui.tsx";
import { AGENCY_GUIDE, CLIENT_GUIDE, filterGuide, type GuideEntry } from "@/lib/guide.ts";
import { renderMarkdown, snippet } from "@/lib/markdown.ts";

function Body({ entry, needle }: { entry: GuideEntry; needle: string }) {
  const html = useMemo(() => renderMarkdown(entry.body), [entry.body]);
  return (
    <article className="prose max-w-2xl" data-testid={`guide-entry-${entry.id}`}>
      <h1 className="font-display text-[26px] font-semibold leading-tight text-text">{entry.title}</h1>
      <p className="mt-1 text-[12px] uppercase tracking-wide text-muted">About {entry.wordCount} words</p>
      {needle && <p className="mt-2 text-[13px] text-muted">Search match: {snippet(entry.body, needle)}</p>}
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-text [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-[20px] [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-[16px] [&_h3]:font-semibold [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_code]:rounded [&_code]:bg-ground [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:bg-ink [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:text-white" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}

export function AgencyHelp() {
  return <HelpPage kind="agency" guide={AGENCY_GUIDE} />;
}

export function ClientHelp() {
  return <HelpPage kind="client" guide={CLIENT_GUIDE} />;
}

function HelpPage({ kind, guide }: { kind: "agency" | "client"; guide: GuideEntry[] }) {
  const { agencyRole } = useAuth();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterGuide(guide, query), [guide, query]);
  const [selectedId, setSelectedId] = useState<string | null>(guide[0]?.id ?? null);
  const shownList = filtered;
  const shown = shownList.find((entry) => entry.id === selectedId) ?? shownList[0] ?? guide[0];

  const description = kind === "agency" ? "How Armature works: adding projects, giving clients access, publishing, SEO, storage and troubleshooting." : "How to edit your site: sign in, change words, publish and ask for help.";
  const hint = kind === "agency" && agencyRole === undefined ? " Only agency staff see the agency guide." : null;

  return (
    <div className="flex flex-col gap-5" data-testid="help-page">
      <PageHeader title={<span className="inline-flex items-center gap-2"><IconHelp size={22} /> Help</span>} description={<>{description}{hint && <span className="ml-1 text-muted">{hint}</span>}</>} />
      <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-card border border-line bg-panel p-4">
          <label className="relative block">
            <span className="sr-only">Search the guide</span>
            <IconSearch size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input type="search" value={query} placeholder="Search" className="h-10 pl-9" onChange={(event) => setQuery(event.target.value)} data-testid="help-search" />
          </label>
          <nav className="mt-3">
            <ul className="flex flex-col gap-1" data-testid="help-list">
              {shownList.length === 0 && <li className="px-2 py-1 text-[13px] text-muted">Nothing matches "{query}".</li>}
              {shownList.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className={`w-full rounded-control px-3 py-2 text-left text-[13px] ${(shown?.id === entry.id) ? "bg-blue-soft font-semibold text-text" : "text-text hover:bg-ground"}`}
                    data-testid={`help-item-${entry.id}`}
                  >
                    {entry.title}
                    {query && <span className="block truncate text-[11px] font-normal text-muted">{snippet(entry.body, query, 40)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <section className="min-w-0">
          {shown ? <Body entry={shown} needle={query} /> : <p className="text-[14px] text-muted">The guide is empty.</p>}
        </section>
      </div>
    </div>
  );
}
