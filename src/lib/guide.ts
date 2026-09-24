/**
 * The in-app Help section reads the markdown files from docs/guide/ and shows them
 * in the dashboard's own chrome. Two audiences: agency staff (docs/guide/agency)
 * and clients (docs/guide/client). Vite bundles each folder with import.meta.glob
 * so the whole guide ships with the app — no network calls, works offline.
 */
export type GuideEntry = {
  id: string;
  title: string;
  order: number;
  body: string;
  wordCount: number;
};

const agencyModules = import.meta.glob("/docs/guide/agency/*.md", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const clientModules = import.meta.glob("/docs/guide/client/*.md", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

function toEntry(path: string, source: string): GuideEntry {
  const filename = path.split("/").pop() ?? "";
  const match = /^(\d+)-([a-z0-9-]+)\.md$/i.exec(filename);
  const order = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
  const id = match ? match[2]! : filename.replace(/\.md$/, "");
  // The first ATX heading in the file is the entry's title. Everything below it is the body.
  const headingIndex = source.indexOf("# ");
  const title = headingIndex === -1 ? id.replace(/-/g, " ") : source.slice(headingIndex + 2).split("\n", 1)[0]!.trim();
  const body = headingIndex === -1 ? source.trim() : source.slice(headingIndex + 2 + title.length).trim();
  return { id, title, order, body, wordCount: body.split(/\s+/).length };
}

function entries(modules: Record<string, string>): GuideEntry[] {
  return Object.entries(modules)
    .map(([path, source]) => toEntry(path, source))
    .sort((a, b) => a.order - b.order);
}

export const AGENCY_GUIDE: GuideEntry[] = entries(agencyModules);
export const CLIENT_GUIDE: GuideEntry[] = entries(clientModules);

/** Case-insensitive substring search over titles and bodies. */
export function filterGuide(guide: GuideEntry[], query: string): GuideEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return guide;
  return guide.filter((entry) => entry.title.toLowerCase().includes(needle) || entry.body.toLowerCase().includes(needle));
}
