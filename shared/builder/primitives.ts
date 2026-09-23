/**
 * The building blocks of the page builder's schemas: sizes, colours, links, icons, the
 * Style and Advanced tabs and rich text. schema.ts (layouts, elements, the kit) and
 * widgetSchemas.ts (the widget library) both build on these.
 */
import { z } from "./zod.ts";
import type {
  Advanced,
  Background,
  BackgroundOverlay,
  Border,
  IconValue,
  LinkValue,
  MaybeResponsive,
  RichBlock,
  RichDoc,
  RichInline,
  RichListItem,
  RichMark,
  Shadow,
  Size,
  Style,
  StyleBase,
  TextStroke,
  Typography,
} from "../../kit/types.ts";
import { BLEND_MODES } from "../../kit/types.ts";
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

export const responsiveSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.union([z.object({ desktop: inner, tablet: inner.optional(), mobile: inner.optional() }), inner]) as unknown as z.ZodType<MaybeResponsive<z.output<T>>>;

export const sizeSchema: z.ZodType<Size> = z.object({ value: z.number().min(-100_000).max(100_000), unit: z.enum(UNITS as unknown as [string, ...string[]]) as z.ZodType<Size["unit"]> });
export const sidesSchema = <T extends z.ZodTypeAny>(inner: T) => z.object({ top: inner.optional(), right: inner.optional(), bottom: inner.optional(), left: inner.optional() });
export const cornersSchema = <T extends z.ZodTypeAny>(inner: T) => z.object({ topLeft: inner.optional(), topRight: inner.optional(), bottomRight: inner.optional(), bottomLeft: inner.optional() });

export const colorSchema = z.string().max(80).refine(isColorValue, "must be a colour such as #1f3a2e, rgba(...), transparent, or a kit colour reference");
export const fontRefSchema = z.string().max(120).refine((value) => value === "" || !value.startsWith("kit:") || parseKitRef(value)?.group === "font", "must be a font family or a kit font reference");

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

export const iconNodeAttrs = z.record(z.string().regex(/^[a-zA-Z-]{1,32}$/), z.string().max(2000));
export const iconSchema: z.ZodType<IconValue> = z.object({
  name: z.string().max(64),
  nodes: z.array(z.tuple([z.enum(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]), iconNodeAttrs])).max(40),
});

export const gapSchema = z.object({ column: sizeSchema.optional(), row: sizeSchema.optional() });

// --- style -------------------------------------------------------------------------------------------

export const fontWeightSchema = z.union([z.literal(100), z.literal(200), z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900), z.literal("normal"), z.literal("bold")]);
export const textAlignSchema = z.enum(["left", "center", "right", "justify"]);

export const typographySchema: z.ZodType<Typography> = z.object({
  preset: z.string().max(60).refine((value) => parseKitRef(value)?.group === "type", "must be a kit typography reference").optional(),
  fontFamily: fontRefSchema.optional(),
  fontSize: responsiveSchema(sizeSchema).optional(),
  fontWeight: responsiveSchema(fontWeightSchema).optional(),
  textTransform: responsiveSchema(z.enum(["none", "uppercase", "lowercase", "capitalize"])).optional(),
  fontStyle: responsiveSchema(z.enum(["normal", "italic", "oblique"])).optional(),
  textDecoration: responsiveSchema(z.enum(["none", "underline", "line-through", "overline"])).optional(),
  lineHeight: responsiveSchema(sizeSchema).optional(),
  letterSpacing: responsiveSchema(sizeSchema).optional(),
  wordSpacing: responsiveSchema(sizeSchema).optional(),
  textAlign: responsiveSchema(textAlignSchema).optional(),
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
  style: responsiveSchema(z.enum(["none", "solid", "dashed", "dotted", "double"])).optional(),
  width: responsiveSchema(sidesSchema(sizeSchema)).optional(),
  color: responsiveSchema(colorSchema).optional(),
  radius: responsiveSchema(cornersSchema(sizeSchema)).optional(),
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
  blend: z.enum(BLEND_MODES).optional(),
});

export const textStrokeSchema: z.ZodType<TextStroke> = z.object({ width: z.number().min(0).max(50), color: colorSchema });

export const styleBaseShape = {
  typography: typographySchema.optional(),
  color: responsiveSchema(colorSchema).optional(),
  textShadow: responsiveSchema(shadowSchema).optional(),
  textStroke: responsiveSchema(textStrokeSchema).optional(),
  boxShadow: responsiveSchema(shadowSchema).optional(),
  border: borderSchema.optional(),
  background: responsiveSchema(backgroundSchema).optional(),
  backgroundOverlay: responsiveSchema(backgroundOverlaySchema).optional(),
  opacity: responsiveSchema(z.number().min(0).max(1)).optional(),
  mixBlendMode: responsiveSchema(z.enum(BLEND_MODES)).optional(),
  transition: z.number().min(0).max(5000).optional(),
};
export const styleBaseSchema: z.ZodType<StyleBase> = z.object(styleBaseShape);
export const styleSchema: z.ZodType<Style> = z.object({ ...styleBaseShape, hover: styleBaseSchema.optional() });

// --- advanced -------------------------------------------------------------------------------------

export const ATTRIBUTE_NAME = /^(?!on)[a-z][a-z0-9-]{0,40}$/i;
export const FORBIDDEN_ATTRIBUTES = new Set(["href", "src", "style", "srcdoc", "action", "formaction", "xlink:href", "class", "id"]);

export const advancedSchema: z.ZodType<Advanced> = z.object({
  margin: responsiveSchema(sidesSchema(sizeSchema)).optional(),
  padding: responsiveSchema(sidesSchema(sizeSchema)).optional(),
  width: responsiveSchema(z.enum(["full", "inline", "custom"])).optional(),
  customWidth: responsiveSchema(sizeSchema).optional(),
  maxWidth: responsiveSchema(sizeSchema).optional(),
  alignSelf: responsiveSchema(z.enum(["auto", "flex-start", "center", "flex-end", "stretch"])).optional(),
  order: responsiveSchema(z.number().int().min(-99).max(99)).optional(),
  flexGrow: responsiveSchema(z.number().min(0).max(99)).optional(),
  flexShrink: responsiveSchema(z.number().min(0).max(99)).optional(),
  gridColumnSpan: responsiveSchema(z.number().int().min(1).max(12)).optional(),
  gridRowSpan: responsiveSchema(z.number().int().min(1).max(24)).optional(),
  position: z
    .object({
      type: z.enum(["default", "absolute", "fixed"]),
      top: responsiveSchema(sizeSchema).optional(),
      right: responsiveSchema(sizeSchema).optional(),
      bottom: responsiveSchema(sizeSchema).optional(),
      left: responsiveSchema(sizeSchema).optional(),
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
  hoverAnimation: z.enum(["none", "grow", "shrink", "float", "sink", "rotate", "pulse", "wobble"]).optional(),
  scroll: z.object({ parallax: z.number().min(-10).max(10).optional() }).optional(),
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

export const richInlineSchema: z.ZodType<RichInline> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(LAYOUT_LIMITS.richTextChars), marks: z.array(richMarkSchema).max(8).optional() }),
  z.object({ type: z.literal("hardBreak") }),
]);

export const richBlockSchema: z.ZodType<RichBlock> = z.lazy(() =>
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
export const richListItemSchema: z.ZodType<RichListItem> = z.lazy(() => z.object({ type: z.literal("listItem"), content: z.array(richBlockSchema).max(100) }));

export const richDocSchema: z.ZodType<RichDoc> = z.object({ type: z.literal("doc"), content: z.array(richBlockSchema).max(1000) });
