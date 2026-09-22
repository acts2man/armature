/**
 * Templates: saved sections and pages (builder_templates, per site or agency-wide) and
 * the built-in starter pages a new page can begin from. A template is stored as element
 * trees; inserting one always gives every element a fresh id.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withFreshIds, type Element, type LayoutDoc } from "@shared/builder/index.ts";
import { px } from "@kit/values.ts";
import { supabase } from "@/lib/supabase.ts";
import { createElement } from "./store.ts";
import { widgetDefinition } from "./widgets/registry.ts";
import "./widgets/library.ts";

export type TemplateKind = "section" | "page";
export type TemplateRow = {
  id: string;
  agency_id: string;
  site_id: string | null;
  name: string;
  kind: TemplateKind;
  content: { root: Element[]; label?: string; seo?: LayoutDoc["seo"]; pageSettings?: LayoutDoc["pageSettings"] };
  element_count: number;
  first_heading: string | null;
  created_by: string | null;
  created_at: string;
};

/** How many elements a tree holds, and its first heading (for the placeholder card). */
export function describeTree(root: Element[]): { count: number; heading: string | null } {
  let count = 0;
  let heading: string | null = null;
  const walk = (elements: Element[]) => {
    for (const element of elements) {
      count += 1;
      if (!heading && element.type === "heading" && typeof element.props["text"] === "string") heading = String(element.props["text"]).slice(0, 200);
      if (element.children) walk(element.children);
    }
  };
  walk(root);
  return { count, heading };
}

export const templatesKey = (siteId: string) => ["builder-templates", siteId] as const;

/** This site's templates and the agency-wide ones (RLS decides what the person sees). */
export function useTemplates(siteId: string, agencyId: string) {
  return useQuery({
    queryKey: templatesKey(siteId),
    queryFn: async (): Promise<TemplateRow[]> => {
      const { data, error } = await supabase.from("builder_templates").select("*").eq("agency_id", agencyId).or(`site_id.is.null,site_id.eq.${siteId}`).order("created_at", { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as TemplateRow[];
    },
    staleTime: 30_000,
  });
}

export function useTemplateActions(siteId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: templatesKey(siteId) });
  return {
    async save(input: { agencyId: string; siteId: string | null; name: string; kind: TemplateKind; content: TemplateRow["content"]; userId: string }): Promise<string | null> {
      const { count, heading } = describeTree(input.content.root);
      const { error } = await supabase.from("builder_templates").insert({ agency_id: input.agencyId, site_id: input.siteId, name: input.name.trim().slice(0, 120), kind: input.kind, content: input.content, element_count: count, first_heading: heading, created_by: input.userId });
      await refresh();
      return error ? error.message : null;
    },
    async remove(id: string): Promise<string | null> {
      const { error } = await supabase.from("builder_templates").delete().eq("id", id);
      await refresh();
      return error ? error.message : null;
    },
  };
}

/** A template's elements, ready to insert (fresh ids, so it can go in any number of times). */
export const instantiate = (root: Element[]): Element[] => root.map((element) => withFreshIds(element));

// --- built-in starter pages ----------------------------------------------------------------------------

const make = (type: string, props: Record<string, unknown> = {}, extra: Parameters<typeof createElement>[2] = {}): Element => {
  const base = widgetDefinition(type)?.create() ?? createElement(type, {});
  return { ...base, props: { ...base.props, ...props }, ...(extra.style ? { style: extra.style } : {}), ...(extra.advanced ? { advanced: extra.advanced } : {}), ...(extra.children ? { children: extra.children } : {}) };
};
const section = (children: Element[], props: Record<string, unknown> = {}) => createElement("container", { tag: "section", layout: "boxed", direction: "column", gap: { column: px(24), row: px(24) }, ...props }, { children });
const row = (children: Element[]) => createElement("container", { layout: "full", direction: { desktop: "row", mobile: "column" }, gap: { column: px(24), row: px(24) } }, { children });

export type StarterPage = { id: string; name: string; description: string; build: () => Element[] };

export const STARTER_PAGES: StarterPage[] = [
  { id: "blank", name: "Blank page", description: "An empty page with one section, ready for widgets.", build: () => [section([])] },
  {
    id: "landing",
    name: "Landing page",
    description: "A headline with a button, three reasons to choose you, and a call to action.",
    build: () => [
      section([make("heading", { text: "A clear promise in one line", tag: "h1" }, { style: { typography: { preset: "kit:type.h1" } } }), make("text"), make("button", { text: "Get in touch", link: { href: "/contact/" } })], { minHeight: px(420), justify: "center" }),
      section([row([make("icon-box"), make("icon-box", { title: "A second reason" }), make("icon-box", { title: "And a third" })])]),
      section([make("cta")]),
    ],
  },
  {
    id: "contact",
    name: "Contact page",
    description: "A heading, a short note, a contact form and a map.",
    build: () => [section([make("heading", { text: "Get in touch", tag: "h1" }, { style: { typography: { preset: "kit:type.h1" } } }), make("text"), row([make("form"), make("map")])])],
  },
  {
    id: "faq",
    name: "Questions page",
    description: "A heading and an accordion of questions and answers.",
    build: () => [section([make("heading", { text: "Questions people ask", tag: "h1" }, { style: { typography: { preset: "kit:type.h1" } } }), make("accordion")])],
  },
];
