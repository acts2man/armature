/**
 * zod schemas for the widget library (every widget beyond the core eight). schema.ts
 * folds these into PROPS_SCHEMAS, so the editor and the publish function validate
 * them exactly like the core widgets. Types live in kit/types.ts.
 */
import { z } from "./zod.ts";
import type {
  AccordionProps,
  AlertProps,
  BlockquoteProps,
  CarouselProps,
  CountdownProps,
  CounterProps,
  CtaProps,
  FlipBoxProps,
  FormProps,
  GalleryProps,
  HtmlProps,
  IconBoxProps,
  IconListProps,
  IconProps,
  ImageBoxProps,
  MapProps,
  PriceTableProps,
  ProgressProps,
  SocialIconsProps,
  StarRatingProps,
  TabsProps,
  TestimonialProps,
  TocProps,
  VideoProps,
} from "../../kit/types.ts";
import { parseKitRef } from "../../kit/values.ts";
import { colorSchema, hrefSchema, iconSchema, isAllowedMediaSrc, linkSchema, mediaSrcSchema, responsiveSchema, sizeSchema } from "./primitives.ts";

/** A repeater row's id: short, lowercase, stable for the row's life. */
const rowId = z.string().regex(/^[a-z0-9]{1,12}$/, "a row id is up to 12 lowercase letters or digits");
const text = (max: number) => z.string().max(max);
const align = responsiveSchema(z.enum(["left", "center", "right"]));
const titleTag = z.enum(["h2", "h3", "h4", "h5", "h6", "p", "div"]);
const icon = iconSchema.nullable();
const position = z.enum(["top", "left", "right"]);
const aspect = z.enum(["1/1", "4/3", "3/2", "16/9", "3/4", "auto"]);

/** Video addresses: YouTube, Vimeo and Wistia pages, a generic https embed, or a file on the site or https. */
export const isAllowedVideoUrl = (source: string, url: string): boolean => {
  if (url === "") return true;
  if (source === "youtube") return /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)\//i.test(url);
  if (source === "vimeo") return /^https:\/\/(www\.|player\.)?vimeo\.com\//i.test(url);
  if (source === "wistia") return /^https:\/\/([a-z0-9-]+\.)?(wistia\.com|wistia\.net|wi\.st)\//i.test(url);
  // A generic embed is any https iframe address; it loads only when the visitor presses play.
  if (source === "embed") return /^https:\/\//i.test(url) && !url.startsWith("data:");
  return isAllowedMediaSrc(url) && !url.startsWith("data:");
};

export const iconPropsSchema: z.ZodType<IconProps> = z.object({
  icon,
  link: linkSchema.optional(),
  size: responsiveSchema(sizeSchema).optional(),
  view: z.enum(["default", "stacked", "framed"]).optional(),
  shape: z.enum(["circle", "square"]).optional(),
  color: colorSchema.optional(),
  secondary: colorSchema.optional(),
  align: align.optional(),
  rotate: z.number().min(-360).max(360).optional(),
});

export const videoPropsSchema: z.ZodType<VideoProps> = z
  .object({
    source: z.enum(["youtube", "vimeo", "wistia", "file", "embed"]),
    url: text(2000),
    poster: mediaSrcSchema.optional(),
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    controls: z.boolean().optional(),
    muted: z.boolean().optional(),
    aspect: z.enum(["16/9", "4/3", "1/1", "9/16", "21/9"]).optional(),
    start: z.number().int().min(0).max(86_400).optional(),
    title: text(200).optional(),
  })
  .refine((props) => isAllowedVideoUrl(props.source, props.url), { message: "must be a YouTube, Vimeo or Wistia address, a generic https embed address, or a video file on this site or on https://", path: ["url"] });

export const iconBoxPropsSchema: z.ZodType<IconBoxProps> = z.object({
  icon,
  title: text(300),
  titleTag: titleTag.optional(),
  description: text(5000).optional(),
  link: linkSchema.optional(),
  position: position.optional(),
  align: align.optional(),
  iconColor: colorSchema.optional(),
  iconSize: sizeSchema.optional(),
});

export const imageBoxPropsSchema: z.ZodType<ImageBoxProps> = z.object({
  src: mediaSrcSchema,
  alt: text(500).optional(),
  title: text(300),
  titleTag: titleTag.optional(),
  description: text(5000).optional(),
  link: linkSchema.optional(),
  position: position.optional(),
  align: align.optional(),
  imageWidth: sizeSchema.optional(),
});

export const iconListPropsSchema: z.ZodType<IconListProps> = z.object({
  items: z.array(z.object({ id: rowId, text: text(500), icon: icon.optional(), link: linkSchema.optional() })).max(100),
  icon: icon.optional(),
  layout: z.enum(["stacked", "inline"]).optional(),
  divider: z.boolean().optional(),
  iconColor: colorSchema.optional(),
  gap: sizeSchema.optional(),
});

const panelItems = z.array(z.object({ id: rowId, title: text(300), content: text(10_000) })).max(50);

export const accordionPropsSchema: z.ZodType<AccordionProps> = z.object({
  items: panelItems,
  open: z.enum(["first", "none", "all"]).optional(),
  titleTag: titleTag.optional(),
  iconPosition: z.enum(["left", "right"]).optional(),
});

export const tabsPropsSchema: z.ZodType<TabsProps> = z.object({
  items: panelItems,
  layout: z.enum(["horizontal", "vertical"]).optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
});

export const testimonialPropsSchema: z.ZodType<TestimonialProps> = z.object({
  quote: text(5000),
  name: text(200),
  role: text(200).optional(),
  src: mediaSrcSchema.optional(),
  alt: text(500).optional(),
  rating: z.number().min(0).max(5).optional(),
  align: align.optional(),
  layout: z.enum(["image-top", "image-left", "image-bottom"]).optional(),
});

export const starRatingPropsSchema: z.ZodType<StarRatingProps> = z
  .object({
    rating: z.number().min(0).max(10),
    scale: z.union([z.literal(5), z.literal(10)]).optional(),
    title: text(200).optional(),
    color: colorSchema.optional(),
    emptyColor: colorSchema.optional(),
    size: sizeSchema.optional(),
    align: align.optional(),
  })
  .refine((props) => props.rating <= (props.scale ?? 5), { message: "the rating cannot be above the scale", path: ["rating"] });

export const counterPropsSchema: z.ZodType<CounterProps> = z.object({
  start: z.number().min(-1e12).max(1e12).optional(),
  end: z.number().min(-1e12).max(1e12),
  duration: z.number().int().min(0).max(20_000).optional(),
  prefix: text(20).optional(),
  suffix: text(20).optional(),
  separator: z.boolean().optional(),
  decimals: z.number().int().min(0).max(4).optional(),
  title: text(200).optional(),
  align: align.optional(),
});

export const progressPropsSchema: z.ZodType<ProgressProps> = z.object({
  title: text(200).optional(),
  percent: z.number().min(0).max(100),
  showPercent: z.boolean().optional(),
  innerText: text(100).optional(),
  color: colorSchema.optional(),
  trackColor: colorSchema.optional(),
  height: sizeSchema.optional(),
});

export const alertPropsSchema: z.ZodType<AlertProps> = z.object({
  kind: z.enum(["info", "success", "warning", "danger"]),
  title: text(300),
  description: text(3000).optional(),
  dismissible: z.boolean().optional(),
  icon: z.boolean().optional(),
});

export const SOCIAL_NETWORKS = ["facebook", "instagram", "x", "twitter", "linkedin", "youtube", "tiktok", "pinterest", "github", "email", "phone", "website", "rss", "whatsapp"] as const;
export const socialIconsPropsSchema: z.ZodType<SocialIconsProps> = z.object({
  // A link, or for the email and phone networks a bare address or number (the kit adds mailto:/tel:).
  items: z.array(z.object({ id: rowId, network: z.enum(SOCIAL_NETWORKS), href: z.union([hrefSchema, z.string().regex(/^[^\s@:/]{1,64}@[^\s@:/]{1,190}$|^[+()\-.\s\d]{5,40}$/)]), label: text(80).optional() })).max(30),
  shape: z.enum(["rounded", "square", "circle"]).optional(),
  size: sizeSchema.optional(),
  colors: z.enum(["brand", "custom"]).optional(),
  color: colorSchema.optional(),
  iconColor: colorSchema.optional(),
  gap: sizeSchema.optional(),
  align: align.optional(),
});

const images = z.array(z.object({ id: rowId, src: mediaSrcSchema, alt: text(500).optional(), caption: text(500).optional() })).max(100);

export const galleryPropsSchema: z.ZodType<GalleryProps> = z.object({
  images,
  columns: responsiveSchema(z.number().int().min(1).max(8)).optional(),
  gap: sizeSchema.optional(),
  aspect: aspect.optional(),
  lightbox: z.boolean().optional(),
  captions: z.boolean().optional(),
});

export const carouselPropsSchema: z.ZodType<CarouselProps> = z.object({
  images,
  perView: responsiveSchema(z.number().int().min(1).max(6)).optional(),
  gap: sizeSchema.optional(),
  aspect: aspect.optional(),
  autoplay: z.boolean().optional(),
  interval: z.number().int().min(1500).max(30_000).optional(),
  loop: z.boolean().optional(),
  arrows: z.boolean().optional(),
  dots: z.boolean().optional(),
  pauseOnHover: z.boolean().optional(),
  captions: z.boolean().optional(),
  lightbox: z.boolean().optional(),
});

export const mapPropsSchema: z.ZodType<MapProps> = z.object({
  address: text(300),
  zoom: z.number().int().min(1).max(20).optional(),
  height: responsiveSchema(sizeSchema).optional(),
  title: text(200).optional(),
});

export const ctaPropsSchema: z.ZodType<CtaProps> = z.object({
  layout: z.enum(["classic", "cover"]).optional(),
  src: mediaSrcSchema.optional(),
  alt: text(500).optional(),
  title: text(300),
  description: text(3000).optional(),
  buttonText: text(120).optional(),
  link: linkSchema.optional(),
  ribbon: text(40).optional(),
  align: align.optional(),
  minHeight: sizeSchema.optional(),
});

export const priceTablePropsSchema: z.ZodType<PriceTableProps> = z.object({
  heading: text(200),
  subheading: text(300).optional(),
  currency: text(8).optional(),
  price: text(40),
  period: text(40).optional(),
  features: z.array(z.object({ id: rowId, text: text(300), included: z.boolean() })).max(40),
  buttonText: text(120).optional(),
  link: linkSchema.optional(),
  ribbon: text(40).optional(),
  footer: text(500).optional(),
  featured: z.boolean().optional(),
});

export const countdownPropsSchema: z.ZodType<CountdownProps> = z.object({
  mode: z.enum(["date", "evergreen"]).optional(),
  date: z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "must be a date and time").optional(),
  minutes: z.number().int().min(1).max(525_600).optional(),
  units: z.object({ days: z.boolean().optional(), hours: z.boolean().optional(), minutes: z.boolean().optional(), seconds: z.boolean().optional() }).optional(),
  labels: z.boolean().optional(),
  expired: text(300).optional(),
});

const flipSide = z.object({ icon: icon.optional(), src: mediaSrcSchema.optional(), title: text(300), description: text(3000).optional() });
export const flipBoxPropsSchema: z.ZodType<FlipBoxProps> = z.object({
  front: flipSide,
  back: flipSide.extend({ buttonText: text(120).optional(), link: linkSchema.optional() }),
  effect: z.enum(["flip", "slide", "fade"]).optional(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  height: responsiveSchema(sizeSchema).optional(),
  frontColor: colorSchema.optional(),
  backColor: colorSchema.optional(),
});

export const blockquotePropsSchema: z.ZodType<BlockquoteProps> = z.object({
  quote: text(5000),
  author: text(200).optional(),
  source: text(200).optional(),
  link: linkSchema.optional(),
  look: z.enum(["border", "quotation", "boxed"]).optional(),
  align: align.optional(),
});

export const tocPropsSchema: z.ZodType<TocProps> = z.object({
  title: text(200).optional(),
  headings: z.array(z.enum(["h2", "h3", "h4", "h5", "h6"])).min(1).max(5).optional(),
  marker: z.enum(["numbers", "bullets", "none"]).optional(),
  collapsible: z.boolean().optional(),
  startOpen: z.boolean().optional(),
});

/** Agency only. Runs in a sandboxed iframe (srcdoc, no same-origin), never in the page. */
export const htmlPropsSchema: z.ZodType<HtmlProps> = z.object({
  code: text(100_000),
  height: responsiveSchema(sizeSchema).optional(),
  title: text(200).optional(),
});

const fieldName = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "a field name uses lowercase letters, digits and _");
export const formPropsSchema: z.ZodType<FormProps> = z
  .object({
    fields: z
      .array(
        z.object({
          id: rowId,
          type: z.enum(["text", "email", "tel", "textarea", "number", "date", "select", "radio", "checkbox", "consent"]),
          label: text(300),
          name: fieldName,
          placeholder: text(200).optional(),
          required: z.boolean().optional(),
          options: z.array(text(200)).max(50).optional(),
          width: z.union([z.literal(100), z.literal(50), z.literal(33)]).optional(),
          help: text(300).optional(),
        }),
      )
      .min(1)
      .max(30),
    submitText: text(120).optional(),
    success: text(1000).optional(),
    redirect: hrefSchema.optional(),
    buttonPreset: z.string().max(60).refine((value) => parseKitRef(value)?.group === "button", "must be a kit button reference").optional(),
    name: text(120).optional(),
    labels: z.boolean().optional(),
  })
  .refine((props) => new Set(props.fields.map((field) => field.name)).size === props.fields.length, { message: "every field needs its own name", path: ["fields"] });

export const WIDGET_PROPS_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  icon: iconPropsSchema,
  video: videoPropsSchema,
  "icon-box": iconBoxPropsSchema,
  "image-box": imageBoxPropsSchema,
  "icon-list": iconListPropsSchema,
  accordion: accordionPropsSchema,
  toggle: accordionPropsSchema,
  tabs: tabsPropsSchema,
  testimonial: testimonialPropsSchema,
  "star-rating": starRatingPropsSchema,
  counter: counterPropsSchema,
  progress: progressPropsSchema,
  alert: alertPropsSchema,
  "social-icons": socialIconsPropsSchema,
  gallery: galleryPropsSchema,
  carousel: carouselPropsSchema,
  map: mapPropsSchema,
  cta: ctaPropsSchema,
  "price-table": priceTablePropsSchema,
  countdown: countdownPropsSchema,
  "flip-box": flipBoxPropsSchema,
  blockquote: blockquotePropsSchema,
  toc: tocPropsSchema,
  html: htmlPropsSchema,
  form: formPropsSchema,
};

/** Widgets only agency staff may add or change (the publish function enforces it). */
export const AGENCY_ONLY_TYPES: readonly string[] = ["html"];
