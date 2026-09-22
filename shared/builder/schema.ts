/**
 * zod schemas for the page builder's data model: every element type, the layout file
 * and the site kit. Shared by the editor (validates before it stores) and the publish
 * function (validates before it commits). The kit's renderer never needs zod: it only
 * ever renders files that passed these checks, and it skips unknown types safely.
 *
 * The TypeScript types live in kit/types.ts (dependency-free, copied into sites); every
 * schema here is annotated with the matching type so the two cannot drift.
 */
import { z } from "zod";
import type {
  ButtonPreset,
  ButtonProps,
  ContainerProps,
  DividerProps,
  Element,
  GridProps,
  HeadingProps,
  ImageProps,
  LayoutDoc,
  SiteKit,
  SiteSectionProps,
  SpacerProps,
  TextProps,
  TypographyPreset,
} from "../../kit/types.ts";
import { parseKitRef } from "../../kit/values.ts";
import {
  LAYOUT_LIMITS,
  ELEMENT_ID_PATTERN,
  PAGE_SLUG_PATTERN,
  responsiveSchema,
  sizeSchema,
  sidesSchema,
  colorSchema,
  fontRefSchema,
  hrefSchema,
  mediaSrcSchema,
  linkSchema,
  iconSchema,
  gapSchema,
  fontWeightSchema,
  styleSchema,
  advancedSchema,
  richDocSchema,
} from "./primitives.ts";
import { WIDGET_PROPS_SCHEMAS } from "./widgetSchemas.ts";

export * from "./primitives.ts";
export * from "./widgetSchemas.ts";

// --- widget props --------------------------------------------------------------------------------

const containerTag = z.enum(["div", "section", "header", "footer", "article", "aside", "nav"]);
const minHeight = responsiveSchema(z.union([sizeSchema, z.literal("screen")]));

export const containerPropsSchema: z.ZodType<ContainerProps> = z.object({
  tag: containerTag.optional(),
  layout: z.enum(["boxed", "full"]).optional(),
  contentWidth: responsiveSchema(sizeSchema).optional(),
  minHeight: minHeight.optional(),
  direction: responsiveSchema(z.enum(["row", "column", "row-reverse", "column-reverse"])).optional(),
  justify: responsiveSchema(z.enum(["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"])).optional(),
  align: responsiveSchema(z.enum(["flex-start", "center", "flex-end", "stretch", "baseline"])).optional(),
  gap: responsiveSchema(gapSchema).optional(),
  wrap: responsiveSchema(z.boolean()).optional(),
  overflow: z.enum(["visible", "hidden"]).optional(),
  link: linkSchema.optional(),
});

const gridTrack = z.union([z.number().int().min(1).max(12), z.string().max(200).regex(/^[a-z0-9\s().,%-]+$/i)]);
export const gridPropsSchema: z.ZodType<GridProps> = z.object({
  tag: containerTag.optional(),
  layout: z.enum(["boxed", "full"]).optional(),
  contentWidth: responsiveSchema(sizeSchema).optional(),
  minHeight: minHeight.optional(),
  columns: responsiveSchema(gridTrack).optional(),
  rows: responsiveSchema(gridTrack).optional(),
  gap: responsiveSchema(gapSchema).optional(),
  autoFlow: z.enum(["row", "column", "row dense", "column dense"]).optional(),
  justifyItems: responsiveSchema(z.enum(["start", "center", "end", "stretch"])).optional(),
  alignItems: responsiveSchema(z.enum(["start", "center", "end", "stretch"])).optional(),
  overflow: z.enum(["visible", "hidden"]).optional(),
});

export const headingPropsSchema: z.ZodType<HeadingProps> = z.object({
  text: z.string().max(LAYOUT_LIMITS.textChars),
  tag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span"]).optional(),
  link: linkSchema.optional(),
});

export const textPropsSchema: z.ZodType<TextProps> = z.object({ doc: richDocSchema });

export const imagePropsSchema: z.ZodType<ImageProps> = z.object({
  src: mediaSrcSchema,
  alt: z.string().max(500).optional(),
  width: responsiveSchema(sizeSchema).optional(),
  height: responsiveSchema(sizeSchema).optional(),
  fit: z.enum(["cover", "contain", "fill", "none"]).optional(),
  focal: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).optional(),
  align: responsiveSchema(z.enum(["left", "center", "right"])).optional(),
  link: z
    .discriminatedUnion("kind", [z.object({ kind: z.literal("none") }), z.object({ kind: z.literal("lightbox") }), z.object({ kind: z.literal("url"), href: hrefSchema, newTab: z.boolean().optional() })])
    .optional(),
  caption: z.string().max(1000).optional(),
  naturalWidth: z.number().int().min(1).max(20_000).optional(),
  naturalHeight: z.number().int().min(1).max(20_000).optional(),
});

export const buttonPropsSchema: z.ZodType<ButtonProps> = z.object({
  text: z.string().max(300),
  link: linkSchema.optional(),
  preset: z.string().max(60).refine((value) => parseKitRef(value)?.group === "button", "must be a kit button reference").optional(),
  size: z.enum(["sm", "md", "lg", "xl"]).optional(),
  icon: iconSchema.nullable().optional(),
  iconPosition: z.enum(["before", "after"]).optional(),
  align: responsiveSchema(z.enum(["left", "center", "right", "justify"])).optional(),
});

export const spacerPropsSchema: z.ZodType<SpacerProps> = z.object({ height: responsiveSchema(sizeSchema).optional() });

export const dividerPropsSchema: z.ZodType<DividerProps> = z.object({
  style: z.enum(["none", "solid", "dashed", "dotted", "double"]).optional(),
  width: responsiveSchema(sizeSchema).optional(),
  weight: sizeSchema.optional(),
  color: colorSchema.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  text: z.string().max(300).optional(),
  icon: iconSchema.nullable().optional(),
});

export const siteSectionPropsSchema: z.ZodType<SiteSectionProps> = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "a section key uses lowercase letters, digits, - and _").max(60) });

/** Element types that carry children. */
export const CONTAINER_TYPES: readonly string[] = ["container", "grid"];

/**
 * Every known element type with its props schema. Unknown types are accepted with
 * unvalidated props so a newer editor's element survives an older publish function;
 * the renderer skips them and the editor shows "Unsupported element".
 */
export const PROPS_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  container: containerPropsSchema,
  grid: gridPropsSchema,
  heading: headingPropsSchema,
  text: textPropsSchema,
  image: imagePropsSchema,
  button: buttonPropsSchema,
  spacer: spacerPropsSchema,
  divider: dividerPropsSchema,
  "site-section": siteSectionPropsSchema,
  ...WIDGET_PROPS_SCHEMAS,
};

/** Register a props schema for a widget added later (M5 widgets call this at module load). */
export function registerPropsSchema(type: string, schema: z.ZodType<unknown>): void {
  PROPS_SCHEMAS[type] = schema;
}

export const isKnownElementType = (type: string): boolean => type in PROPS_SCHEMAS;

// --- elements and layouts ----------------------------------------------------------------------------

const metaSchema = z.object({ createdBy: z.string().max(200), updatedAt: z.string().max(40) });

export const elementSchema: z.ZodType<Element> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(ELEMENT_ID_PATTERN, "an element id is 8 lowercase letters or digits"),
      type: z.string().min(1).max(40).regex(/^[a-z][a-z0-9-]*$/),
      label: z.string().max(80).optional(),
      props: z.record(z.string(), z.unknown()),
      style: styleSchema,
      advanced: advancedSchema,
      children: z.array(elementSchema).optional(),
      locked: z.boolean().optional(),
      meta: metaSchema,
    })
    .superRefine((element, context) => {
      const propsSchema = PROPS_SCHEMAS[element.type];
      if (propsSchema) {
        const result = propsSchema.safeParse(element.props);
        if (!result.success) {
          for (const issue of result.error.issues) {
            context.addIssue({ code: "custom", path: ["props", ...issue.path.map(String)], message: issue.message });
          }
        }
      }
      if (element.children && element.children.length > 0 && !CONTAINER_TYPES.includes(element.type)) {
        context.addIssue({ code: "custom", path: ["children"], message: `a ${element.type} cannot contain other elements` });
      }
    }),
);

export const pageSeoSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  ogImage: mediaSrcSchema.optional(),
  noindex: z.boolean().optional(),
});

export const pageSettingsSchema = z.object({
  hideTitle: z.boolean().optional(),
  bodyBackground: colorSchema.nullable().optional(),
  fullCanvas: z.boolean().optional(),
});

export const layoutDocSchema: z.ZodType<LayoutDoc> = z.object({
  version: z.literal(1),
  pageSlug: z.string().regex(PAGE_SLUG_PATTERN, "a page slug is lowercase letters, digits and hyphens"),
  path: z.string().max(200).regex(/^\/[a-z0-9\-_/]*$/i, "a path starts with / and uses letters, digits, - and _"),
  label: z.string().max(120).optional(),
  seo: pageSeoSchema.optional(),
  pageSettings: pageSettingsSchema.optional(),
  root: z.array(elementSchema),
});

// --- site kit ---------------------------------------------------------------------------------------------

export const typographyPresetSchema: z.ZodType<TypographyPreset> = z.object({
  fontFamily: fontRefSchema.optional(),
  fontSize: responsiveSchema(sizeSchema),
  fontWeight: fontWeightSchema.optional(),
  lineHeight: sizeSchema.optional(),
  letterSpacing: sizeSchema.optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
});

export const buttonPresetSchema: z.ZodType<ButtonPreset> = z.object({
  background: colorSchema,
  color: colorSchema,
  borderWidth: sizeSchema.optional(),
  borderColor: colorSchema.optional(),
  radius: sizeSchema.optional(),
  padding: sidesSchema(sizeSchema).optional(),
  hover: z.object({ background: colorSchema.optional(), color: colorSchema.optional(), borderColor: colorSchema.optional() }).optional(),
});

const kitId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/, "an id uses lowercase letters, digits, - and _");

export const siteKitSchema: z.ZodType<SiteKit> = z.object({
  version: z.literal(1),
  colors: z.object({
    primary: colorSchema,
    secondary: colorSchema,
    text: colorSchema,
    accent: colorSchema,
    custom: z.array(z.object({ id: kitId, label: z.string().max(60), value: colorSchema })).max(40),
  }),
  fonts: z.object({
    heading: z.string().max(120),
    body: z.string().max(120),
    custom: z.array(z.object({ id: kitId, family: z.string().max(120), source: z.enum(["google", "system"]) })).max(20),
  }),
  typography: z.object({
    h1: typographyPresetSchema,
    h2: typographyPresetSchema,
    h3: typographyPresetSchema,
    h4: typographyPresetSchema,
    h5: typographyPresetSchema,
    h6: typographyPresetSchema,
    body: typographyPresetSchema,
    small: typographyPresetSchema,
    button: typographyPresetSchema,
  }),
  buttons: z.object({ primary: buttonPresetSchema, secondary: buttonPresetSchema, outline: buttonPresetSchema }),
  links: z.object({ color: colorSchema, hover: colorSchema }),
  forms: z.object({ fieldBackground: colorSchema, fieldBorder: colorSchema, fieldRadius: sizeSchema, fieldText: colorSchema }),
  container: z.object({ contentWidth: sizeSchema, padding: sidesSchema(sizeSchema), gap: sizeSchema }),
  breakpoints: z.object({ tablet: z.number().int().min(480).max(2000), mobile: z.number().int().min(320).max(1200) }).refine((points) => points.mobile < points.tablet, "the mobile breakpoint must be below the tablet one"),
  imageRadius: sizeSchema,
  pageBackground: colorSchema,
});

// --- reports --------------------------------------------------------------------------------------

export type ValidationReport<T> = { errors: string[]; value?: T };

const formatIssues = (prefix: string, issues: { path: PropertyKey[]; message: string }[]): string[] =>
  issues.slice(0, 30).map((issue) => `${prefix}${issue.path.length ? issue.path.map(String).join(".") : "(file)"}: ${issue.message}`);

/** Depth and count of a tree, for the limits. */
export function measureTree(root: Element[]): { depth: number; count: number } {
  let count = 0;
  const walk = (elements: Element[], depth: number): number => {
    let deepest = depth;
    for (const element of elements) {
      count += 1;
      if (element.children && element.children.length > 0) deepest = Math.max(deepest, walk(element.children, depth + 1));
    }
    return deepest;
  };
  return { depth: root.length === 0 ? 0 : walk(root, 1), count };
}

/** Validate a parsed layout file, including the size, depth and count limits. */
export function validateLayout(raw: unknown, where = "layout"): ValidationReport<LayoutDoc> {
  const result = layoutDocSchema.safeParse(raw);
  if (!result.success) return { errors: formatIssues(`${where}: `, result.error.issues) };
  const layout = result.data;
  const errors: string[] = [];
  const { depth, count } = measureTree(layout.root);
  if (depth > LAYOUT_LIMITS.depth) errors.push(`${where}: elements are nested ${depth} deep; the limit is ${LAYOUT_LIMITS.depth}`);
  if (count > LAYOUT_LIMITS.elementsPerPage) errors.push(`${where}: ${count} elements on one page; the limit is ${LAYOUT_LIMITS.elementsPerPage}`);
  const ids = new Set<string>();
  const walk = (elements: Element[]) => {
    for (const element of elements) {
      if (ids.has(element.id)) errors.push(`${where}: element id "${element.id}" appears twice`);
      ids.add(element.id);
      if (element.children) walk(element.children);
    }
  };
  walk(layout.root);
  const bytes = new TextEncoder().encode(JSON.stringify(layout)).length;
  if (bytes > LAYOUT_LIMITS.fileBytes) errors.push(`${where}: the layout is ${(bytes / 1024 / 1024).toFixed(2)} MB; the limit is 1 MB`);
  return errors.length > 0 ? { errors } : { errors, value: layout };
}

export function validateSiteKit(raw: unknown, where = "site-kit.json"): ValidationReport<SiteKit> {
  const result = siteKitSchema.safeParse(raw);
  if (!result.success) return { errors: formatIssues(`${where}: `, result.error.issues) };
  return { errors: [], value: result.data };
}

export function validateElement(raw: unknown, where = "element"): ValidationReport<Element> {
  const result = elementSchema.safeParse(raw);
  if (!result.success) return { errors: formatIssues(`${where}: `, result.error.issues) };
  return { errors: [], value: result.data };
}

/** The canonical on-disk form of a layout or kit file (sorted keys, 2-space indent, newline). */
export function serializeBuilderFile(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) out[key] = sort((input as Record<string, unknown>)[key]);
      return out;
    }
    return input;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export const LAYOUTS_DIR = "content/layouts";
export const SITE_KIT_PATH = "content/site-kit.json";
export const MEDIA_META_PATH = "content/media.json";
export const layoutPath = (slug: string): string => `${LAYOUTS_DIR}/${slug}.json`;
