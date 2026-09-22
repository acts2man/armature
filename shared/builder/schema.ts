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
  Advanced,
  Background,
  BackgroundOverlay,
  Border,
  ButtonPreset,
  ButtonProps,
  ContainerProps,
  DividerProps,
  Element,
  GridProps,
  HeadingProps,
  IconValue,
  ImageProps,
  LayoutDoc,
  LinkValue,
  MaybeResponsive,
  RichBlock,
  RichDoc,
  RichInline,
  RichListItem,
  RichMark,
  Shadow,
  SiteKit,
  SiteSectionProps,
  Size,
  SpacerProps,
  Style,
  StyleBase,
  TextProps,
  Typography,
  TypographyPreset,
} from "../../kit/types.ts";
import { UNITS, isColorValue, parseKitRef } from "../../kit/values.ts";

export const LAYOUT_LIMITS = {
  /** Serialized layout file size. */
  fileBytes: 1024 * 1024,
  depth: 12,
  elementsPerPage: 2000,
  textChars: 20_000,
  richTextChars: 50_000,
  customCssChars: 20_000,
  attributes: 20,
} as const;

export const ELEMENT_ID_PATTERN = /^[a-z0-9]{8}$/;
export const PAGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// --- primitives -----------------------------------------------------------------------------------

const responsive = <T extends z.ZodTypeAny>(inner: T) =>
  z.union([z.object({ desktop: inner, tablet: inner.optional(), mobile: inner.optional() }), inner]) as unknown as z.ZodType<MaybeResponsive<z.output<T>>>;

export const sizeSchema: z.ZodType<Size> = z.object({ value: z.number().min(-100_000).max(100_000), unit: z.enum(UNITS as unknown as [string, ...string[]]) as z.ZodType<Size["unit"]> });
const sides = <T extends z.ZodTypeAny>(inner: T) => z.object({ top: inner.optional(), right: inner.optional(), bottom: inner.optional(), left: inner.optional() });
const corners = <T extends z.ZodTypeAny>(inner: T) => z.object({ topLeft: inner.optional(), topRight: inner.optional(), bottomRight: inner.optional(), bottomLeft: inner.optional() });

export const colorSchema = z.string().max(80).refine(isColorValue, "must be a colour such as #1f3a2e, rgba(...), transparent, or a kit colour reference");
const fontRefSchema = z.string().max(120).refine((value) => value === "" || !value.startsWith("kit:") || parseKitRef(value)?.group === "font", "must be a font family or a kit font reference");

/** Links may only use https, http, mailto, tel, a site path (/...) or a fragment (#...). */
export const isAllowedHref = (value: string): boolean => {
  if (value === "") return true;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/") || value.startsWith("#")) return true;
  return /^(https?:\/\/|mailto:|tel:)/i.test(value);
};
export const hrefSchema = z.string().max(2000).refine(isAllowedHref, "must start with https://, http://, mailto:, tel:, / or #");
/** Images and media must live on the site itself or on https. */
export const isAllowedMediaSrc = (value: string): boolean => value === "" || (value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) || /^https:\/\//i.test(value) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value);
export const mediaSrcSchema = z.string().max(2_000_000).refine(isAllowedMediaSrc, "must be a path on this site (/assets/...) or an https:// address");

export const linkSchema: z.ZodType<LinkValue> = z.object({ href: hrefSchema, newTab: z.boolean().optional(), rel: z.string().max(60).optional() });

const iconNodeAttrs = z.record(z.string().regex(/^[a-zA-Z-]{1,32}$/), z.string().max(2000));
export const iconSchema: z.ZodType<IconValue> = z.object({
  name: z.string().max(64),
  nodes: z.array(z.tuple([z.enum(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]), iconNodeAttrs])).max(40),
});

const gapSchema = z.object({ column: sizeSchema.optional(), row: sizeSchema.optional() });

// --- style -------------------------------------------------------------------------------------------

const fontWeightSchema = z.union([z.literal(100), z.literal(200), z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900), z.literal("normal"), z.literal("bold")]);
const textAlignSchema = z.enum(["left", "center", "right", "justify"]);

export const typographySchema: z.ZodType<Typography> = z.object({
  preset: z.string().max(60).refine((value) => parseKitRef(value)?.group === "type", "must be a kit typography reference").optional(),
  fontFamily: fontRefSchema.optional(),
  fontSize: responsive(sizeSchema).optional(),
  fontWeight: responsive(fontWeightSchema).optional(),
  textTransform: responsive(z.enum(["none", "uppercase", "lowercase", "capitalize"])).optional(),
  fontStyle: responsive(z.enum(["normal", "italic", "oblique"])).optional(),
  textDecoration: responsive(z.enum(["none", "underline", "line-through", "overline"])).optional(),
  lineHeight: responsive(sizeSchema).optional(),
  letterSpacing: responsive(sizeSchema).optional(),
  wordSpacing: responsive(sizeSchema).optional(),
  textAlign: responsive(textAlignSchema).optional(),
});

export const shadowSchema: z.ZodType<Shadow> = z.object({
  x: z.number().min(-500).max(500),
  y: z.number().min(-500).max(500),
  blur: z.number().min(0).max(500),
  spread: z.number().min(-500).max(500).optional(),
  color: colorSchema,
  inset: z.boolean().optional(),
});

export const borderSchema: z.ZodType<Border> = z.object({
  style: responsive(z.enum(["none", "solid", "dashed", "dotted", "double"])).optional(),
  width: responsive(sides(sizeSchema)).optional(),
  color: responsive(colorSchema).optional(),
  radius: responsive(corners(sizeSchema)).optional(),
});

export const backgroundSchema: z.ZodType<Background> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("color"), color: colorSchema }),
  z.object({
    kind: z.literal("gradient"),
    type: z.enum(["linear", "radial"]),
    angle: z.number().min(0).max(360).optional(),
    stops: z.array(z.object({ color: colorSchema, position: z.number().min(0).max(100) })).min(2).max(10),
  }),
  z.object({
    kind: z.literal("image"),
    src: mediaSrcSchema,
    position: z.string().max(40).regex(/^[a-z0-9%\s.-]*$/).optional(),
    attachment: z.enum(["scroll", "fixed"]).optional(),
    repeat: z.enum(["no-repeat", "repeat", "repeat-x", "repeat-y"]).optional(),
    size: z.enum(["auto", "cover", "contain"]).optional(),
    focal: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).optional(),
  }),
  z.object({ kind: z.literal("video"), src: mediaSrcSchema, poster: mediaSrcSchema.optional(), loop: z.boolean().optional(), playOnMobile: z.boolean().optional() }),
]);

export const backgroundOverlaySchema: z.ZodType<BackgroundOverlay> = z.object({
  background: backgroundSchema,
  opacity: z.number().min(0).max(1),
  blend: z.enum(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]).optional(),
});

const styleBaseShape = {
  typography: typographySchema.optional(),
  color: responsive(colorSchema).optional(),
  textShadow: responsive(shadowSchema).optional(),
  boxShadow: responsive(shadowSchema).optional(),
  border: borderSchema.optional(),
  background: responsive(backgroundSchema).optional(),
  backgroundOverlay: responsive(backgroundOverlaySchema).optional(),
  opacity: responsive(z.number().min(0).max(1)).optional(),
  transition: z.number().min(0).max(5000).optional(),
};
export const styleBaseSchema: z.ZodType<StyleBase> = z.object(styleBaseShape);
export const styleSchema: z.ZodType<Style> = z.object({ ...styleBaseShape, hover: styleBaseSchema.optional() });

// --- advanced -------------------------------------------------------------------------------------

const ATTRIBUTE_NAME = /^(?!on)[a-z][a-z0-9-]{0,40}$/i;
const FORBIDDEN_ATTRIBUTES = new Set(["href", "src", "style", "srcdoc", "action", "formaction", "xlink:href", "class", "id"]);

export const advancedSchema: z.ZodType<Advanced> = z.object({
  margin: responsive(sides(sizeSchema)).optional(),
  padding: responsive(sides(sizeSchema)).optional(),
  width: responsive(z.enum(["full", "inline", "custom"])).optional(),
  customWidth: responsive(sizeSchema).optional(),
  maxWidth: responsive(sizeSchema).optional(),
  alignSelf: responsive(z.enum(["auto", "flex-start", "center", "flex-end", "stretch"])).optional(),
  order: responsive(z.number().int().min(-99).max(99)).optional(),
  flexGrow: responsive(z.number().min(0).max(99)).optional(),
  flexShrink: responsive(z.number().min(0).max(99)).optional(),
  position: z
    .object({
      type: z.enum(["default", "absolute", "fixed"]),
      top: responsive(sizeSchema).optional(),
      right: responsive(sizeSchema).optional(),
      bottom: responsive(sizeSchema).optional(),
      left: responsive(sizeSchema).optional(),
      zIndex: z.number().int().min(-999).max(9999).optional(),
    })
    .optional(),
  animation: z
    .object({
      type: z.enum(["none", "fadeIn", "fadeInUp", "fadeInDown", "fadeInLeft", "fadeInRight", "zoomIn", "slideInUp", "bounceIn"]),
      duration: z.number().min(0).max(10_000).optional(),
      delay: z.number().min(0).max(10_000).optional(),
    })
    .optional(),
  hidden: z.object({ desktop: z.boolean().optional(), tablet: z.boolean().optional(), mobile: z.boolean().optional() }).optional(),
  cssId: z.string().max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$|^$/, "a CSS id starts with a letter and uses letters, digits, - and _").optional(),
  cssClasses: z.string().max(200).regex(/^[a-zA-Z0-9_\s-]*$/, "classes use letters, digits, - and _").optional(),
  attributes: z
    .array(z.object({ name: z.string().regex(ATTRIBUTE_NAME, "attribute names use letters, digits and -, and cannot start with 'on'").refine((name) => !FORBIDDEN_ATTRIBUTES.has(name.toLowerCase()), "this attribute cannot be set here"), value: z.string().max(500) }))
    .max(LAYOUT_LIMITS.attributes)
    .optional(),
  customCss: z.string().max(LAYOUT_LIMITS.customCssChars).optional(),
});

// --- rich text --------------------------------------------------------------------------------------

export const richMarkSchema: z.ZodType<RichMark> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("link"), attrs: z.object({ href: hrefSchema, target: z.enum(["_blank"]).nullable().optional() }) }),
  z.object({ type: z.literal("textStyle"), attrs: z.object({ color: colorSchema.optional() }) }),
  z.object({ type: z.literal("highlight"), attrs: z.object({ color: colorSchema.optional() }) }),
]);

const richInlineSchema: z.ZodType<RichInline> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(LAYOUT_LIMITS.richTextChars), marks: z.array(richMarkSchema).max(8).optional() }),
  z.object({ type: z.literal("hardBreak") }),
]);

const richBlockSchema: z.ZodType<RichBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), attrs: z.object({ textAlign: textAlignSchema.optional() }).optional(), content: z.array(richInlineSchema).optional() }),
    z.object({
      type: z.literal("heading"),
      attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), textAlign: textAlignSchema.optional() }),
      content: z.array(richInlineSchema).optional(),
    }),
    z.object({ type: z.literal("bulletList"), content: z.array(richListItemSchema).max(500) }),
    z.object({ type: z.literal("orderedList"), attrs: z.object({ start: z.number().int().min(0).optional() }).optional(), content: z.array(richListItemSchema).max(500) }),
    z.object({ type: z.literal("blockquote"), content: z.array(richBlockSchema).max(200) }),
  ]),
);
const richListItemSchema: z.ZodType<RichListItem> = z.lazy(() => z.object({ type: z.literal("listItem"), content: z.array(richBlockSchema).max(100) }));

export const richDocSchema: z.ZodType<RichDoc> = z.object({ type: z.literal("doc"), content: z.array(richBlockSchema).max(1000) });

// --- widget props --------------------------------------------------------------------------------

const containerTag = z.enum(["div", "section", "header", "footer", "article", "aside", "nav"]);
const minHeight = responsive(z.union([sizeSchema, z.literal("screen")]));

export const containerPropsSchema: z.ZodType<ContainerProps> = z.object({
  tag: containerTag.optional(),
  layout: z.enum(["boxed", "full"]).optional(),
  contentWidth: responsive(sizeSchema).optional(),
  minHeight: minHeight.optional(),
  direction: responsive(z.enum(["row", "column", "row-reverse", "column-reverse"])).optional(),
  justify: responsive(z.enum(["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"])).optional(),
  align: responsive(z.enum(["flex-start", "center", "flex-end", "stretch", "baseline"])).optional(),
  gap: responsive(gapSchema).optional(),
  wrap: responsive(z.boolean()).optional(),
  overflow: z.enum(["visible", "hidden"]).optional(),
  link: linkSchema.optional(),
});

const gridTrack = z.union([z.number().int().min(1).max(12), z.string().max(200).regex(/^[a-z0-9\s().,%-]+$/i)]);
export const gridPropsSchema: z.ZodType<GridProps> = z.object({
  tag: containerTag.optional(),
  layout: z.enum(["boxed", "full"]).optional(),
  contentWidth: responsive(sizeSchema).optional(),
  minHeight: minHeight.optional(),
  columns: responsive(gridTrack).optional(),
  rows: responsive(gridTrack).optional(),
  gap: responsive(gapSchema).optional(),
  autoFlow: z.enum(["row", "column", "row dense", "column dense"]).optional(),
  justifyItems: responsive(z.enum(["start", "center", "end", "stretch"])).optional(),
  alignItems: responsive(z.enum(["start", "center", "end", "stretch"])).optional(),
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
  width: responsive(sizeSchema).optional(),
  height: responsive(sizeSchema).optional(),
  fit: z.enum(["cover", "contain", "fill", "none"]).optional(),
  focal: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).optional(),
  align: responsive(z.enum(["left", "center", "right"])).optional(),
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
  align: responsive(z.enum(["left", "center", "right", "justify"])).optional(),
});

export const spacerPropsSchema: z.ZodType<SpacerProps> = z.object({ height: responsive(sizeSchema).optional() });

export const dividerPropsSchema: z.ZodType<DividerProps> = z.object({
  style: z.enum(["none", "solid", "dashed", "dotted", "double"]).optional(),
  width: responsive(sizeSchema).optional(),
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
  fontSize: responsive(sizeSchema),
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
  padding: sides(sizeSchema).optional(),
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
  container: z.object({ contentWidth: sizeSchema, padding: sides(sizeSchema), gap: sizeSchema }),
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
