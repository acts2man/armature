/**
 * The core widgets (site contract v2): Container, Grid, Heading, Text Editor, Image,
 * Button, Spacer, Divider and the site-section wrapper. Each render function receives
 * the element, the common attributes it must spread on its root, and its rendered
 * children. Semantic HTML only; every href and src passes through the sanitizers.
 * Widgets added later register themselves with `registerWidget`.
 */
import { createElement, type ReactNode } from "react";
import { Icon } from "./icon.tsx";
import { RichText } from "./richText.tsx";
import { newTabRel, safeHref, safeMediaSrc } from "./sanitize.ts";
import type { ButtonProps, ContainerProps, DividerProps, Element, GridProps, HeadingProps, ImageProps, SiteKit, TextProps } from "./types.ts";
import { parseKitRef } from "./values.ts";

export type CommonAttributes = Record<string, string | undefined> & { className: string };

export type WidgetContext = {
  element: Element;
  common: CommonAttributes;
  children: ReactNode;
  kit: SiteKit;
  editMode: boolean;
  /** For images: the first picture on the page loads eagerly with a high priority. */
  imageIndex: number;
  /** The page's slug (the Form widget says which page an entry came from). */
  page: string;
};

export type WidgetRender = (context: WidgetContext) => ReactNode;

const WIDGETS = new Map<string, WidgetRender>();

export function registerWidget(type: string, render: WidgetRender): void {
  WIDGETS.set(type, render);
}

export const getWidget = (type: string): WidgetRender | undefined => WIDGETS.get(type);

export const linkAttributes = (link: { href: string; newTab?: boolean; rel?: string } | undefined) => {
  const href = safeHref(link?.href);
  if (!href) return null;
  const rel = [link?.newTab ? newTabRel : "", link?.rel ?? ""].filter(Boolean).join(" ") || undefined;
  return { href, target: link?.newTab ? "_blank" : undefined, rel };
};

// --- containers ------------------------------------------------------------------------------

/**
 * A container's video background (the kit renders the <video>; the CSS shows the poster
 * instead for visitors who ask for reduced motion, and on phones unless allowed).
 */
function BackgroundVideo({ element }: { element: Element }) {
  const raw = element.style.background as unknown;
  const background = (raw && typeof raw === "object" && "desktop" in (raw as object) ? (raw as { desktop: unknown }).desktop : raw) as { kind?: string; src?: string; poster?: string; loop?: boolean; playOnMobile?: boolean } | undefined;
  if (!background || background.kind !== "video") return null;
  const src = safeMediaSrc(background.src);
  if (!src || src.startsWith("data:")) return null;
  return <video className={`ae-bg-video${background.playOnMobile ? "" : " ae-bg-video-nomobile"}`} src={src} poster={safeMediaSrc(background.poster)} autoPlay muted loop={background.loop !== false} playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />;
}
const hasVideo = (element: Element) => {
  const raw = element.style.background as unknown;
  const background = raw && typeof raw === "object" && "desktop" in (raw as object) ? (raw as { desktop: unknown }).desktop : raw;
  return !!background && typeof background === "object" && (background as { kind?: string }).kind === "video";
};

function Container({ element, common, children, editMode }: WidgetContext) {
  const props = element.props as ContainerProps;
  const tag = props.tag ?? "div";
  const empty = !element.children || element.children.length === 0;
  const className = `${common.className} ae-con${(props.layout ?? "boxed") === "boxed" ? " ae-con-boxed" : ""}${editMode && empty ? " ae-empty" : ""}${hasVideo(element) ? " ae-has-video" : ""}`;
  const link = linkAttributes(props.link);
  const inner = <div className="ae-con-inner">{children}</div>;
  const video = <BackgroundVideo element={element} />;
  if (link) {
    return createElement(tag, { ...common, className }, video, <a className="ae-con-link" {...link}>{inner}</a>);
  }
  return createElement(tag, { ...common, className }, video, inner);
}

function Grid({ element, common, children, editMode }: WidgetContext) {
  const props = element.props as GridProps;
  const tag = props.tag ?? "div";
  const empty = !element.children || element.children.length === 0;
  const className = `${common.className} ae-con ae-grid${(props.layout ?? "boxed") === "boxed" ? " ae-con-boxed" : ""}${editMode && empty ? " ae-empty" : ""}${hasVideo(element) ? " ae-has-video" : ""}`;
  return createElement(tag, { ...common, className }, <BackgroundVideo element={element} />, <div className="ae-con-inner">{children}</div>);
}

// --- basic ----------------------------------------------------------------------------------

function Heading({ element, common }: WidgetContext) {
  const props = element.props as HeadingProps;
  const tag = props.tag ?? "h2";
  const link = linkAttributes(props.link);
  const text = typeof props.text === "string" ? props.text : "";
  return createElement(tag, { ...common, className: `${common.className} ae-heading` }, link ? <a {...link}>{text}</a> : text);
}

function Text({ element, common }: WidgetContext) {
  const props = element.props as TextProps;
  return (
    <div {...common} className={`${common.className} ae-text`}>
      <RichText doc={props.doc} />
    </div>
  );
}

function Image({ element, common, imageIndex, editMode }: WidgetContext) {
  const props = element.props as ImageProps;
  const src = safeMediaSrc(props.src);
  const first = imageIndex === 0;
  const image = src ? (
    <img
      src={src}
      alt={props.alt ?? ""}
      width={props.naturalWidth}
      height={props.naturalHeight}
      loading={first ? "eager" : "lazy"}
      decoding={first ? "sync" : "async"}
      fetchPriority={first ? "high" : undefined}
    />
  ) : editMode ? (
    <span className="ae-image-empty" style={{ display: "inline-block", width: "100%", minHeight: 120, background: "repeating-linear-gradient(45deg, #eef1f4, #eef1f4 10px, #e6eaee 10px, #e6eaee 20px)" }} />
  ) : null;
  let body: ReactNode = image;
  if (image && props.link && props.link.kind === "url") {
    const link = linkAttributes({ href: props.link.href, newTab: props.link.newTab });
    if (link) body = <a {...link}>{image}</a>;
  } else if (image && props.link && props.link.kind === "lightbox" && src) {
    body = (
      <a href={src} data-ae-lightbox="" onClick={(event) => event.preventDefault()}>
        {image}
      </a>
    );
  }
  return (
    <figure {...common} className={`${common.className} ae-image`}>
      {body}
      {props.caption ? <figcaption>{props.caption}</figcaption> : null}
    </figure>
  );
}

function Button({ element, common, kit }: WidgetContext) {
  const props = element.props as ButtonProps;
  const ref = parseKitRef(props.preset ?? "kit:button.primary");
  const preset = ref && ref.group === "button" && ref.name in kit.buttons ? ref.name : "primary";
  const link = linkAttributes(props.link) ?? { href: "#", target: undefined, rel: undefined };
  const icon = props.icon ? <Icon icon={props.icon} /> : null;
  const position = props.iconPosition ?? "before";
  return (
    <div {...common} className={`${common.className} ae-button`}>
      <a className={`ae-btn ae-btn-${preset} ae-btn-${props.size ?? "md"}`} {...link}>
        {position === "before" ? icon : null}
        <span className="ae-btn-text">{props.text ?? ""}</span>
        {position === "after" ? icon : null}
      </a>
    </div>
  );
}

function Spacer({ common }: WidgetContext) {
  return <div {...common} className={`${common.className} ae-spacer`} aria-hidden="true" />;
}

function Divider({ element, common }: WidgetContext) {
  const props = element.props as DividerProps;
  const middle = props.text || props.icon ? (
    <span className="ae-divider-text">
      {props.icon ? <Icon icon={props.icon} /> : null}
      {props.text ?? ""}
    </span>
  ) : null;
  return (
    <div {...common} className={`${common.className} ae-divider`} role="separator">
      <span className="ae-divider-line" />
      {middle}
      {middle ? <span className="ae-divider-line" /> : null}
    </div>
  );
}

registerWidget("container", Container);
registerWidget("grid", Grid);
registerWidget("heading", Heading);
registerWidget("text", Text);
registerWidget("image", Image);
registerWidget("button", Button);
registerWidget("spacer", Spacer);
registerWidget("divider", Divider);
