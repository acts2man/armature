/**
 * The page builder's data model (site contract v2). Plain TypeScript types with no
 * dependencies, so the kit can be copied into a site as is. The dashboard and the edge
 * functions validate these shapes with the zod schemas in shared/builder/schema.ts,
 * which are typed against this file so the two can never drift.
 *
 * Layout files live at content/layouts/<pageSlug>.json in the site's repository and
 * the site kit at content/site-kit.json.
 */

// --- responsive values -------------------------------------------------------------------

export type Device = "desktop" | "tablet" | "mobile";

/** A value with per-device overrides. Tablet inherits desktop, mobile inherits tablet. */
export type Responsive<T> = { desktop: T; tablet?: T; mobile?: T };
export type MaybeResponsive<T> = T | Responsive<T>;

// --- sizes, colours, references ----------------------------------------------------------

export type Unit = "px" | "%" | "em" | "rem" | "vw" | "vh" | "vmin" | "vmax" | "ch" | "ex" | "svh" | "dvh" | "lvh" | "svw" | "dvw" | "lvw" | "pt" | "auto" | "";
/**
 * Every size control stores a value and a unit. With "auto" the value is ignored; "" is
 * unitless (line-height 1.4, or a bare 0). Decimals and negative values are fine wherever
 * CSS allows them (letter-spacing -0.02em, margin -20px).
 */
export type Size = { value: number; unit: Unit };
export type Sides<T> = { top?: T; right?: T; bottom?: T; left?: T };
export type Corners<T> = { topLeft?: T; topRight?: T; bottomRight?: T; bottomLeft?: T };

/**
 * A colour is a literal ("#1f3a2e", "#1f3a2e80", "rgba(...)", "transparent") or a kit
 * reference such as "kit:color.primary" or "kit:color.custom.<id>".
 */
export type Color = string;
/** A font family literal or "kit:font.heading" / "kit:font.body" / "kit:font.custom.<id>". */
export type FontRef = string;

export type Gap = { column?: Size; row?: Size };

// --- style (the Style tab) -----------------------------------------------------------------

/** Any whole number from 1 to 1000 (variable fonts use 650, 450…), or a CSS keyword. */
export type FontWeight = number | "normal" | "bold" | "lighter" | "bolder";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type FontStyle = "normal" | "italic" | "oblique";
export type TextDecoration = "none" | "underline" | "line-through" | "overline";
export type TextAlign = "left" | "center" | "right" | "justify" | "start" | "end";

export type Typography = {
  /** A kit typography preset, e.g. "kit:type.h2". Explicit values below override it. */
  preset?: string;
  fontFamily?: FontRef;
  fontSize?: MaybeResponsive<Size>;
  fontWeight?: MaybeResponsive<FontWeight>;
  textTransform?: MaybeResponsive<TextTransform>;
  fontStyle?: MaybeResponsive<FontStyle>;
  textDecoration?: MaybeResponsive<TextDecoration>;
  lineHeight?: MaybeResponsive<Size>;
  letterSpacing?: MaybeResponsive<Size>;
  wordSpacing?: MaybeResponsive<Size>;
  textAlign?: MaybeResponsive<TextAlign>;
};

export type Shadow = { x: number; y: number; blur: number; spread?: number; color: Color; inset?: boolean };

export type BorderStyle = "none" | "solid" | "dashed" | "dotted" | "double" | "groove" | "ridge" | "inset" | "outset" | "hidden";
export type Border = {
  style?: MaybeResponsive<BorderStyle>;
  width?: MaybeResponsive<Sides<Size>>;
  color?: MaybeResponsive<Color>;
  radius?: MaybeResponsive<Corners<Size>>;
};

export type GradientStop = { color: Color; position: number };
export type Background =
  | { kind: "none" }
  | { kind: "color"; color: Color }
  | { kind: "gradient"; type: "linear" | "radial"; angle?: number; stops: GradientStop[] }
  | {
      kind: "image";
      src: string;
      position?: string;
      attachment?: "scroll" | "fixed";
      repeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
      /** A keyword, or any CSS background-size such as "100% auto" or "480px". */
      size?: "auto" | "cover" | "contain" | (string & {});
      /** Focal point as percentages, used when size is cover. */
      focal?: { x: number; y: number };
    }
  | { kind: "video"; src: string; poster?: string; loop?: boolean; playOnMobile?: boolean };

export type BackgroundOverlay = { background: Background; opacity: number; blend?: string };

export const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** An outline drawn around the glyphs (-webkit-text-stroke). */
export type TextStroke = { width: number; color: Color };

export type StyleBase = {
  typography?: Typography;
  color?: MaybeResponsive<Color>;
  textShadow?: MaybeResponsive<Shadow>;
  textStroke?: MaybeResponsive<TextStroke>;
  boxShadow?: MaybeResponsive<Shadow>;
  border?: Border;
  background?: MaybeResponsive<Background>;
  backgroundOverlay?: MaybeResponsive<BackgroundOverlay>;
  opacity?: MaybeResponsive<number>;
  /** How the element blends with what is behind it (mix-blend-mode). */
  mixBlendMode?: MaybeResponsive<BlendMode>;
  /** Transition duration in milliseconds for hover changes. */
  transition?: number;
};

export type Style = StyleBase & { hover?: StyleBase };

// --- advanced (the Advanced tab) -----------------------------------------------------------

export type WidthMode = "full" | "inline" | "custom";
export type AlignSelf = "auto" | "flex-start" | "center" | "flex-end" | "stretch";
export type PositionType = "default" | "absolute" | "fixed" | "relative" | "sticky";
export type AnimationType =
  | "none"
  | "fadeIn"
  | "fadeInUp"
  | "fadeInDown"
  | "fadeInLeft"
  | "fadeInRight"
  | "zoomIn"
  | "slideInUp"
  | "bounceIn";

export type Advanced = {
  margin?: MaybeResponsive<Sides<Size>>;
  padding?: MaybeResponsive<Sides<Size>>;
  width?: MaybeResponsive<WidthMode>;
  customWidth?: MaybeResponsive<Size>;
  maxWidth?: MaybeResponsive<Size>;
  alignSelf?: MaybeResponsive<AlignSelf>;
  order?: MaybeResponsive<number>;
  flexGrow?: MaybeResponsive<number>;
  flexShrink?: MaybeResponsive<number>;
  /** Inside a grid: how many columns and rows the element spans. */
  gridColumnSpan?: MaybeResponsive<number>;
  gridRowSpan?: MaybeResponsive<number>;
  position?: {
    type: PositionType;
    top?: MaybeResponsive<Size>;
    right?: MaybeResponsive<Size>;
    bottom?: MaybeResponsive<Size>;
    left?: MaybeResponsive<Size>;
    zIndex?: number;
  };
  animation?: { type: AnimationType; duration?: number; delay?: number };
  /** A small effect while the pointer is over the element. */
  hoverAnimation?: HoverAnimation;
  /** Scrolling effects: vertical parallax (-10 to 10; 0 is none). */
  scroll?: { parallax?: number };
  /** Hidden per device. A hidden element still shows in the editor at 40% with a badge. */
  hidden?: { desktop?: boolean; tablet?: boolean; mobile?: boolean };
  /** Agency only from here on. */
  cssId?: string;
  cssClasses?: string;
  attributes?: { name: string; value: string }[];
  /** Scoped to this element's selector; "selector" in the text stands for it. */
  customCss?: string;
};

// --- rich text (TipTap-compatible JSON, rendered by the kit's own whitelist renderer) ------

export type RichMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "code" }
  | { type: "link"; attrs: { href: string; target?: "_blank" | null } }
  | { type: "textStyle"; attrs: { color?: string } }
  | { type: "highlight"; attrs: { color?: string } };

export type RichText = { type: "text"; text: string; marks?: RichMark[] };
export type RichInline = RichText | { type: "hardBreak" };
export type RichBlock =
  | { type: "paragraph"; attrs?: { textAlign?: TextAlign }; content?: RichInline[] }
  | { type: "heading"; attrs: { level: 1 | 2 | 3 | 4 | 5 | 6; textAlign?: TextAlign }; content?: RichInline[] }
  | { type: "bulletList"; content: RichListItem[] }
  | { type: "orderedList"; attrs?: { start?: number }; content: RichListItem[] }
  | { type: "blockquote"; content: RichBlock[] };
export type RichListItem = { type: "listItem"; content: RichBlock[] };
export type RichDoc = { type: "doc"; content: RichBlock[] };

// --- icons ---------------------------------------------------------------------------------

/** An icon's SVG nodes (a subset of the lucide format), saved so the site needs no icon library. */
export type IconValue = { name: string; nodes: [string, Record<string, string>][] };

// --- links -------------------------------------------------------------------------------

export type LinkValue = { href: string; newTab?: boolean; rel?: string };

// --- elements ------------------------------------------------------------------------------

export type ElementMeta = { createdBy: string; updatedAt: string };

/**
 * What the validator puts in place of an element it could not read (kit/validate.ts).
 * The site skips it, the editor shows "Unsupported element", and a publish writes the
 * original element back exactly as it was.
 */
export const UNSUPPORTED_TYPE = "unsupported";
export type UnsupportedProps = { originalType: string; reason: string };

export type Element = {
  /** Eight characters, [a-z0-9]. Stable for the element's life; its CSS class is .ae-<id>. */
  id: string;
  type: string;
  label?: string;
  props: Record<string, unknown>;
  style: Style;
  advanced: Advanced;
  children?: Element[];
  locked?: boolean;
  meta: ElementMeta;
};

export type PageSeo = { title?: string; description?: string; ogImage?: string; noindex?: boolean };
export type PageSettings = { hideTitle?: boolean; bodyBackground?: Color | null; fullCanvas?: boolean };

export type LayoutDoc = {
  version: 1;
  pageSlug: string;
  path: string;
  /** Required for builder-only pages (coded pages carry their label in schema.json). */
  label?: string;
  seo?: PageSeo;
  pageSettings?: PageSettings;
  root: Element[];
};

// --- widget props (the Content tab) -----------------------------------------------------------

export type ContainerTag = "div" | "section" | "header" | "footer" | "article" | "aside" | "nav" | "main";
export type FlexDirection = "row" | "column" | "row-reverse" | "column-reverse";
export type Justify = "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly" | "start" | "end";
export type AlignItems = "flex-start" | "center" | "flex-end" | "stretch" | "baseline" | "start" | "end";

export type ContainerProps = {
  tag?: ContainerTag;
  /** Boxed keeps the content at the kit's content width; full lets it span the page. */
  layout?: "boxed" | "full";
  contentWidth?: MaybeResponsive<Size>;
  /** "screen" fits the viewport height. */
  minHeight?: MaybeResponsive<Size | "screen">;
  direction?: MaybeResponsive<FlexDirection>;
  justify?: MaybeResponsive<Justify>;
  align?: MaybeResponsive<AlignItems>;
  gap?: MaybeResponsive<Gap>;
  wrap?: MaybeResponsive<boolean>;
  overflow?: "visible" | "hidden";
  link?: LinkValue;
};

export type GridProps = {
  tag?: ContainerTag;
  layout?: "boxed" | "full";
  contentWidth?: MaybeResponsive<Size>;
  minHeight?: MaybeResponsive<Size | "screen">;
  /** A count, or a custom grid-template-columns string. */
  columns?: MaybeResponsive<number | string>;
  rows?: MaybeResponsive<number | string>;
  gap?: MaybeResponsive<Gap>;
  autoFlow?: "row" | "column" | "row dense" | "column dense";
  justifyItems?: MaybeResponsive<"start" | "center" | "end" | "stretch">;
  alignItems?: MaybeResponsive<"start" | "center" | "end" | "stretch">;
  overflow?: "visible" | "hidden";
};

export type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div" | "span";
export type HeadingProps = { text: string; tag?: HeadingTag; link?: LinkValue };

export type TextProps = { doc: RichDoc };

export type ImageFit = "cover" | "contain" | "fill" | "none" | "scale-down";
export type ImageLink = { kind: "none" } | { kind: "lightbox" } | { kind: "url"; href: string; newTab?: boolean };
export type ImageProps = {
  src: string;
  alt?: string;
  width?: MaybeResponsive<Size>;
  height?: MaybeResponsive<Size>;
  fit?: ImageFit;
  focal?: { x: number; y: number };
  align?: MaybeResponsive<"left" | "center" | "right">;
  link?: ImageLink;
  caption?: string;
  /** Intrinsic size, written when the picture is chosen, so the page never shifts while it loads. */
  naturalWidth?: number;
  naturalHeight?: number;
};

export type ButtonSize = "sm" | "md" | "lg" | "xl";
export type ButtonProps = {
  text: string;
  link?: LinkValue;
  /** A kit button preset, e.g. "kit:button.primary". */
  preset?: string;
  size?: ButtonSize;
  icon?: IconValue | null;
  iconPosition?: "before" | "after";
  align?: MaybeResponsive<"left" | "center" | "right" | "justify">;
};

export type SpacerProps = { height?: MaybeResponsive<Size> };

export type DividerProps = {
  style?: BorderStyle;
  width?: MaybeResponsive<Size>;
  weight?: Size;
  color?: Color;
  align?: "left" | "center" | "right";
  text?: string;
  icon?: IconValue | null;
};

export type SiteSectionProps = { key: string };

// --- the widget library (Basic and General) ----------------------------------------------------

/** Rows in a repeater (accordion items, list items, gallery pictures) carry a stable id. */
export type Align = "left" | "center" | "right";

export type IconProps = {
  icon: IconValue | null;
  link?: LinkValue;
  size?: MaybeResponsive<Size>;
  view?: "default" | "stacked" | "framed";
  shape?: "circle" | "square";
  color?: Color;
  secondary?: Color;
  align?: MaybeResponsive<Align>;
  rotate?: number;
};

export type VideoSource = "youtube" | "vimeo" | "wistia" | "file" | "embed";
export type VideoProps = {
  source: VideoSource;
  url: string;
  /** A picture shown before the video loads (YouTube's own thumbnail when empty). */
  poster?: string;
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
  muted?: boolean;
  aspect?: "16/9" | "4/3" | "1/1" | "9/16" | "21/9";
  /** Start at this many seconds. */
  start?: number;
  title?: string;
};

export type TitleTag = "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div";
export type BoxPosition = "top" | "left" | "right";

export type IconBoxProps = { icon: IconValue | null; title: string; titleTag?: TitleTag; description?: string; link?: LinkValue; position?: BoxPosition; align?: MaybeResponsive<Align>; iconColor?: Color; iconSize?: Size };
export type ImageBoxProps = { src: string; alt?: string; title: string; titleTag?: TitleTag; description?: string; link?: LinkValue; position?: BoxPosition; align?: MaybeResponsive<Align>; imageWidth?: Size };

export type IconListItem = { id: string; text: string; icon?: IconValue | null; link?: LinkValue };
export type IconListProps = { items: IconListItem[]; icon?: IconValue | null; layout?: "stacked" | "inline"; divider?: boolean; iconColor?: Color; gap?: Size };

export type PanelItem = { id: string; title: string; content: string };
export type AccordionProps = { items: PanelItem[]; /** Which items start open. */ open?: "first" | "none" | "all"; titleTag?: TitleTag; iconPosition?: "left" | "right" };
export type TabsProps = { items: PanelItem[]; layout?: "horizontal" | "vertical"; align?: "start" | "center" | "end" | "stretch" };

export type TestimonialProps = { quote: string; name: string; role?: string; src?: string; alt?: string; rating?: number; align?: MaybeResponsive<Align>; layout?: "image-top" | "image-left" | "image-bottom" };
export type StarRatingProps = { rating: number; scale?: 5 | 10; title?: string; color?: Color; emptyColor?: Color; size?: Size; align?: MaybeResponsive<Align> };
export type CounterProps = { start?: number; end: number; duration?: number; prefix?: string; suffix?: string; separator?: boolean; decimals?: number; title?: string; align?: MaybeResponsive<Align> };
export type ProgressProps = { title?: string; percent: number; showPercent?: boolean; innerText?: string; color?: Color; trackColor?: Color; height?: Size };
export type AlertKind = "info" | "success" | "warning" | "danger";
export type AlertProps = { kind: AlertKind; title: string; description?: string; dismissible?: boolean; icon?: boolean };

export type SocialNetwork = "facebook" | "instagram" | "x" | "twitter" | "linkedin" | "youtube" | "tiktok" | "pinterest" | "github" | "email" | "phone" | "website" | "rss" | "whatsapp";
export type SocialItem = { id: string; network: SocialNetwork; href: string; label?: string };
export type SocialIconsProps = { items: SocialItem[]; shape?: "rounded" | "square" | "circle"; size?: Size; colors?: "brand" | "custom"; color?: Color; iconColor?: Color; gap?: Size; align?: MaybeResponsive<Align> };

export type GalleryImage = { id: string; src: string; alt?: string; caption?: string };
export type Aspect = "1/1" | "4/3" | "3/2" | "16/9" | "3/4" | "auto";
export type GalleryProps = { images: GalleryImage[]; columns?: MaybeResponsive<number>; gap?: Size; aspect?: Aspect; lightbox?: boolean; captions?: boolean };
export type CarouselProps = { images: GalleryImage[]; perView?: MaybeResponsive<number>; gap?: Size; aspect?: Aspect; autoplay?: boolean; interval?: number; loop?: boolean; arrows?: boolean; dots?: boolean; pauseOnHover?: boolean; captions?: boolean; lightbox?: boolean };

export type MapProps = { address: string; zoom?: number; height?: MaybeResponsive<Size>; title?: string };
export type CtaProps = { layout?: "classic" | "cover"; src?: string; alt?: string; title: string; description?: string; buttonText?: string; link?: LinkValue; ribbon?: string; align?: MaybeResponsive<Align>; minHeight?: Size };
export type PriceFeature = { id: string; text: string; included: boolean };
export type PriceTableProps = { heading: string; subheading?: string; currency?: string; price: string; period?: string; features: PriceFeature[]; buttonText?: string; link?: LinkValue; ribbon?: string; footer?: string; featured?: boolean };
export type CountdownProps = { mode?: "date" | "evergreen"; date?: string; minutes?: number; units?: { days?: boolean; hours?: boolean; minutes?: boolean; seconds?: boolean }; labels?: boolean; expired?: string };
export type FlipSide = { icon?: IconValue | null; src?: string; title: string; description?: string };
export type FlipBoxProps = { front: FlipSide; back: FlipSide & { buttonText?: string; link?: LinkValue }; effect?: "flip" | "slide" | "fade"; direction?: "left" | "right" | "up" | "down"; height?: MaybeResponsive<Size>; frontColor?: Color; backColor?: Color };
export type BlockquoteProps = { quote: string; author?: string; source?: string; link?: LinkValue; look?: "border" | "quotation" | "boxed"; align?: MaybeResponsive<Align> };
export type TocProps = { title?: string; headings?: ("h2" | "h3" | "h4" | "h5" | "h6")[]; marker?: "numbers" | "bullets" | "none"; collapsible?: boolean; startOpen?: boolean };
export type HtmlProps = { code: string; height?: MaybeResponsive<Size>; title?: string };

export type FormFieldType = "text" | "email" | "tel" | "textarea" | "number" | "date" | "select" | "radio" | "checkbox" | "consent";
export type FormField = { id: string; type: FormFieldType; label: string; name: string; placeholder?: string; required?: boolean; options?: string[]; width?: 100 | 50 | 33; help?: string };
export type FormProps = { fields: FormField[]; submitText?: string; success?: string; redirect?: string; buttonPreset?: string; /** Shown to the person filling it in; the address the entries go to lives in the dashboard. */ name?: string; labels?: boolean };

/** Advanced motion effects added by the widget library. */
export type HoverAnimation = "none" | "grow" | "shrink" | "float" | "sink" | "rotate" | "pulse" | "wobble";

// --- site kit (content/site-kit.json) ------------------------------------------------------------

export type TypographyPreset = {
  fontFamily?: FontRef;
  fontSize: MaybeResponsive<Size>;
  fontWeight?: FontWeight;
  lineHeight?: Size;
  letterSpacing?: Size;
  textTransform?: TextTransform;
};

export type ButtonPreset = {
  background: Color;
  color: Color;
  borderWidth?: Size;
  borderColor?: Color;
  radius?: Size;
  padding?: Sides<Size>;
  hover?: { background?: Color; color?: Color; borderColor?: Color };
};

export type SiteKit = {
  version: 1;
  colors: {
    primary: Color;
    secondary: Color;
    text: Color;
    accent: Color;
    custom: { id: string; label: string; value: Color }[];
  };
  fonts: {
    heading: string;
    body: string;
    custom: { id: string; family: string; source: "google" | "system" }[];
  };
  typography: {
    h1: TypographyPreset;
    h2: TypographyPreset;
    h3: TypographyPreset;
    h4: TypographyPreset;
    h5: TypographyPreset;
    h6: TypographyPreset;
    body: TypographyPreset;
    small: TypographyPreset;
    button: TypographyPreset;
  };
  buttons: { primary: ButtonPreset; secondary: ButtonPreset; outline: ButtonPreset };
  links: { color: Color; hover: Color };
  forms: { fieldBackground: Color; fieldBorder: Color; fieldRadius: Size; fieldText: Color };
  container: { contentWidth: Size; padding: Sides<Size>; gap: Size };
  breakpoints: { tablet: number; mobile: number };
  imageRadius: Size;
  pageBackground: Color;
  /** Navigation menus (optional; older kits have none). */
  menus?: Menu[];
};

/**
 * The site's navigation menus (Appearance › Menus), used by the Nav Menu widget. A page
 * item points at a page slug (coded or built); a url item carries an address. One level
 * of children makes a dropdown.
 */
export type MenuItem = {
  id: string;
  label: string;
  kind: "page" | "url";
  page?: string;
  href?: string;
  newTab?: boolean;
  children?: MenuItem[];
};
export type Menu = { id: string; name: string; items: MenuItem[] };

/** The header and footer built in the editor live in content/layouts/_header.json and _footer.json. */
export const CHROME_SLUGS = ["_header", "_footer"] as const;
export type ChromeSlug = (typeof CHROME_SLUGS)[number];
export type ChromePart = "header" | "footer";
export const isChromeSlug = (slug: string): slug is ChromeSlug => (CHROME_SLUGS as readonly string[]).includes(slug);
export const chromeSlug = (part: ChromePart): ChromeSlug => (part === "header" ? "_header" : "_footer");

export type SiteLogoProps = {
  src: string;
  alt?: string;
  height?: MaybeResponsive<Size>;
  /** Wrap the logo in a link to the home page (on by default). */
  linkHome?: boolean;
  align?: MaybeResponsive<"left" | "center" | "right">;
  naturalWidth?: number;
  naturalHeight?: number;
};

export type NavMenuProps = {
  /** The id of a menu from the site kit's menus. */
  menu?: string;
  layout?: "horizontal" | "vertical";
  align?: MaybeResponsive<"left" | "center" | "right">;
  /** Below this width (pixels) the menu folds behind a hamburger button. */
  breakpoint?: number;
  /** Keep the menu at the top of the window while the page scrolls. */
  sticky?: boolean;
  gap?: Size;
};

/** What a site registers for a hand-coded section it wants in the tree. */
export type SiteSectionInfo = { key: string; label: string; repeatable: boolean };
