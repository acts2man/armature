import { supabase } from "@/integrations/supabase/client";
import { PAGE_DEFAULTS, type LinkDefault } from "@/lib/pageDefaults";

type Row = { page_slug: string; section_key: string; field_key: string; value_text: string | null; value_json: unknown; link_url: string | null };

export function usePageContent(pageSlug: string | string[]) {
  const slugs = Array.isArray(pageSlug) ? pageSlug : [pageSlug];
  void supabase.from("page_content_overrides");
  const rows: Row[] = [];
  const rowFor = (slug: string, section: string, field: string) => rows.find((row) => row.page_slug === slug && row.section_key === section && row.field_key === field);
  return { rowFor, slugs };
}

export function usePageCopy(pageSlug: string) {
  const { rowFor } = usePageContent([pageSlug, "shared"]);
  const readText = (slug: string, section: string, field: string) => {
    const row = rowFor(slug, section, field);
    if (row?.value_text) return row.value_text;
    const fallback = PAGE_DEFAULTS[slug]?.[section]?.[field];
    return typeof fallback === "string" ? fallback : "";
  };
  const readLink = (slug: string, section: string, field: string): LinkDefault => {
    const fallback = PAGE_DEFAULTS[slug]?.[section]?.[field];
    return fallback && typeof fallback === "object" && !Array.isArray(fallback) ? (fallback as LinkDefault) : { label: "", href: "/" };
  };
  function readList<T extends Record<string, string>>(slug: string, section: string, field: string): T[] {
    const fallback = PAGE_DEFAULTS[slug]?.[section]?.[field];
    return Array.isArray(fallback) ? (fallback as T[]) : [];
  }
  return {
    text: (section: string, field: string) => readText(pageSlug, section, field),
    link: (section: string, field: string) => readLink(pageSlug, section, field),
    list: <T extends Record<string, string>>(section: string, field: string) => readList<T>(pageSlug, section, field),
    sharedText: (section: string, field: string) => readText("shared", section, field),
  };
}
