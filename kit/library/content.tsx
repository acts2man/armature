/**
 * Content widgets from the library: Icon Box, Image Box, Icon List, Testimonial, Star
 * Rating, Alert, Blockquote, Call to Action, Price Table, Social Icons, Progress Bar and
 * Counter. Semantic HTML; links and pictures pass the sanitizers.
 */
import { useEffect, useState } from "react";
import { Icon } from "../icon.tsx";
import { safeHref } from "../sanitize.ts";
import type {
  AlertProps,
  BlockquoteProps,
  CounterProps,
  CtaProps,
  IconBoxProps,
  IconListProps,
  ImageBoxProps,
  PriceTableProps,
  ProgressProps,
  SocialIconsProps,
  StarRatingProps,
  TestimonialProps,
} from "../types.ts";
import { linkAttributes, type WidgetContext, type WidgetRender } from "../widgets.tsx";
import { formatNumber, Paragraphs, Picture, Title, useInView, useReducedMotion } from "./common.tsx";
import { GLYPHS, NETWORKS } from "./glyphs.ts";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** A title that links when the box has a link. */
function LinkedTitle({ link, tag, className, text }: { link: ReturnType<typeof linkAttributes>; tag: IconBoxProps["titleTag"]; className: string; text: string }) {
  return <Title tag={tag} className={className}>{link ? <a {...link}>{text}</a> : text}</Title>;
}

function IconBox({ element, common }: WidgetContext) {
  const props = element.props as IconBoxProps;
  const link = linkAttributes(props.link);
  return (
    <div {...common} className={`${common.className} ae-box ae-box-${props.position ?? "top"}`}>
      {props.icon ? (
        <span className="ae-box-media ae-box-icon">
          <Icon icon={props.icon} />
        </span>
      ) : null}
      <div className="ae-box-body">
        <LinkedTitle link={link} tag={props.titleTag} className="ae-box-title" text={str(props.title)} />
        <Paragraphs text={props.description} className="ae-box-text" />
      </div>
    </div>
  );
}

function ImageBox({ element, common }: WidgetContext) {
  const props = element.props as ImageBoxProps;
  const link = linkAttributes(props.link);
  const picture = <Picture src={props.src} alt={props.alt} />;
  return (
    <div {...common} className={`${common.className} ae-box ae-box-${props.position ?? "top"}`}>
      {props.src ? <figure className="ae-box-media ae-box-image">{link ? <a {...link} tabIndex={-1} aria-hidden="true">{picture}</a> : picture}</figure> : null}
      <div className="ae-box-body">
        <LinkedTitle link={link} tag={props.titleTag} className="ae-box-title" text={str(props.title)} />
        <Paragraphs text={props.description} className="ae-box-text" />
      </div>
    </div>
  );
}

function IconList({ element, common }: WidgetContext) {
  const props = element.props as IconListProps;
  const items = Array.isArray(props.items) ? props.items : [];
  return (
    <ul {...common} className={`${common.className} ae-icon-list ae-icon-list-${props.layout ?? "stacked"}${props.divider ? " ae-icon-list-divided" : ""}`}>
      {items.map((item) => {
        const link = linkAttributes(item.link);
        const body = (
          <>
            <span className="ae-icon-list-icon">
              <Icon icon={item.icon ?? props.icon ?? GLYPHS.check} />
            </span>
            <span className="ae-icon-list-text">{str(item.text)}</span>
          </>
        );
        return <li key={item.id}>{link ? <a {...link}>{body}</a> : body}</li>;
      })}
    </ul>
  );
}

/** Stars as text glyphs with the filled part clipped, so halves and tenths show exactly. */
function Stars({ rating, scale }: { rating: number; scale: number }) {
  const clamped = Math.max(0, Math.min(scale, rating));
  return (
    <span className="ae-stars" role="img" aria-label={`Rated ${clamped} out of ${scale}`}>
      <span className="ae-stars-empty" aria-hidden="true">
        {"★".repeat(scale)}
      </span>
      <span className="ae-stars-filled" aria-hidden="true" style={{ width: `${(clamped / scale) * 100}%` }}>
        {"★".repeat(scale)}
      </span>
    </span>
  );
}

function Testimonial({ element, common }: WidgetContext) {
  const props = element.props as TestimonialProps;
  return (
    <figure {...common} className={`${common.className} ae-testimonial ae-testimonial-${props.layout ?? "image-top"}`}>
      {props.src ? <Picture src={props.src} alt={props.alt ?? str(props.name)} className="ae-testimonial-image" /> : null}
      <div className="ae-testimonial-body">
        {props.rating ? <Stars rating={props.rating} scale={5} /> : null}
        <blockquote className="ae-testimonial-quote">
          <Paragraphs text={props.quote} />
        </blockquote>
        <figcaption className="ae-testimonial-cite">
          <span className="ae-testimonial-name">{str(props.name)}</span>
          {props.role ? <span className="ae-testimonial-role">{props.role}</span> : null}
        </figcaption>
      </div>
    </figure>
  );
}

function StarRating({ element, common }: WidgetContext) {
  const props = element.props as StarRatingProps;
  return (
    <div {...common} className={`${common.className} ae-star-rating`}>
      {props.title ? <span className="ae-star-rating-title">{props.title}</span> : null}
      <Stars rating={Number(props.rating) || 0} scale={props.scale ?? 5} />
    </div>
  );
}

const ALERT_ICONS = { info: GLYPHS.info, success: GLYPHS.circleCheck, warning: GLYPHS.triangleAlert, danger: GLYPHS.circleAlert };
function AlertView({ props, common, editMode }: { props: AlertProps; common: WidgetContext["common"]; editMode: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed && !editMode) return null;
  const kind = props.kind in ALERT_ICONS ? props.kind : "info";
  return (
    <div {...common} className={`${common.className} ae-alert ae-alert-${kind}`} role={kind === "danger" || kind === "warning" ? "alert" : "status"}>
      {props.icon !== false ? (
        <span className="ae-alert-icon">
          <Icon icon={ALERT_ICONS[kind]} />
        </span>
      ) : null}
      <div className="ae-alert-body">
        <strong className="ae-alert-title">{str(props.title)}</strong>
        <Paragraphs text={props.description} className="ae-alert-text" />
      </div>
      {props.dismissible ? (
        <button type="button" className="ae-alert-close" aria-label="Dismiss" onClick={() => setDismissed(true)} data-ae-interactive="">
          <Icon icon={GLYPHS.x} />
        </button>
      ) : null}
    </div>
  );
}
const Alert = ({ element, common, editMode }: WidgetContext) => <AlertView props={element.props as AlertProps} common={common} editMode={editMode} />;

function Blockquote({ element, common }: WidgetContext) {
  const props = element.props as BlockquoteProps;
  const link = linkAttributes(props.link);
  const cite = props.author || props.source;
  return (
    <figure {...common} className={`${common.className} ae-quote ae-quote-${props.look ?? "border"}`}>
      <blockquote cite={link?.href} className="ae-quote-text">
        <Paragraphs text={props.quote} />
      </blockquote>
      {cite ? (
        <figcaption className="ae-quote-cite">
          {props.author ? <span className="ae-quote-author">{props.author}</span> : null}
          {props.source ? <cite className="ae-quote-source">{link ? <a {...link}>{props.source}</a> : props.source}</cite> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Cta({ element, common }: WidgetContext) {
  const props = element.props as CtaProps;
  const link = linkAttributes(props.link);
  const layout = props.layout ?? "classic";
  return (
    <div {...common} className={`${common.className} ae-cta ae-cta-${layout}`}>
      {props.src ? <Picture src={props.src} alt={layout === "cover" ? "" : props.alt} className="ae-cta-image" /> : null}
      {props.ribbon ? <span className="ae-ribbon">{props.ribbon}</span> : null}
      <div className="ae-cta-body">
        <h3 className="ae-cta-title">{str(props.title)}</h3>
        <Paragraphs text={props.description} className="ae-cta-text" />
        {props.buttonText ? (
          <a className="ae-btn ae-btn-primary ae-btn-md" {...(link ?? { href: "#" })}>
            <span className="ae-btn-text">{props.buttonText}</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function PriceTable({ element, common }: WidgetContext) {
  const props = element.props as PriceTableProps;
  const link = linkAttributes(props.link);
  const features = Array.isArray(props.features) ? props.features : [];
  return (
    <div {...common} className={`${common.className} ae-price${props.featured ? " ae-price-featured" : ""}`}>
      {props.ribbon ? <span className="ae-ribbon">{props.ribbon}</span> : null}
      <div className="ae-price-head">
        <h3 className="ae-price-heading">{str(props.heading)}</h3>
        {props.subheading ? <p className="ae-price-sub">{props.subheading}</p> : null}
      </div>
      <p className="ae-price-amount">
        {props.currency ? <span className="ae-price-currency">{props.currency}</span> : null}
        <span className="ae-price-value">{str(props.price)}</span>
        {props.period ? <span className="ae-price-period">{props.period}</span> : null}
      </p>
      <ul className="ae-price-features">
        {features.map((feature) => (
          <li key={feature.id} className={feature.included ? "ae-price-yes" : "ae-price-no"}>
            <Icon icon={feature.included ? GLYPHS.check : GLYPHS.x} />
            <span>{str(feature.text)}</span>
            {!feature.included ? <span className="ae-sr-only"> (not included)</span> : null}
          </li>
        ))}
      </ul>
      {props.buttonText ? (
        <a className="ae-btn ae-btn-primary ae-btn-md ae-price-button" {...(link ?? { href: "#" })}>
          <span className="ae-btn-text">{props.buttonText}</span>
        </a>
      ) : null}
      {props.footer ? <p className="ae-price-footer">{props.footer}</p> : null}
    </div>
  );
}

/** mailto: and tel: for the email and phone networks when a bare address was typed. */
const socialHref = (network: string, href: string): string | undefined => {
  if (network === "email" && href && !href.includes(":")) return safeHref(`mailto:${href}`);
  if (network === "phone" && href && !href.includes(":")) return safeHref(`tel:${href.replace(/[^+\d]/g, "")}`);
  return safeHref(href);
};

function SocialIcons({ element, common }: WidgetContext) {
  const props = element.props as SocialIconsProps;
  const items = Array.isArray(props.items) ? props.items : [];
  return (
    <ul {...common} className={`${common.className} ae-social ae-social-${props.shape ?? "rounded"} ae-social-${props.colors ?? "brand"}`}>
      {items.map((item) => {
        const network = NETWORKS[item.network] ?? NETWORKS.website;
        const href = socialHref(item.network, item.href);
        const label = item.label || network.label;
        const external = !!href && /^https?:/i.test(href);
        return (
          <li key={item.id}>
            <a className="ae-social-link" href={href ?? "#"} aria-label={label} title={label} style={{ "--ae-brand": network.color } as React.CSSProperties} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
              <Icon icon={network.icon} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function ProgressView({ props, common, editMode }: { props: ProgressProps; common: WidgetContext["common"]; editMode: boolean }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  const percent = Math.max(0, Math.min(100, Number(props.percent) || 0));
  const shown = seen || editMode || reduced ? percent : 0;
  return (
    <div {...common} className={`${common.className} ae-progress`}>
      {props.title || props.showPercent !== false ? (
        <div className="ae-progress-head">
          {props.title ? <span className="ae-progress-title">{props.title}</span> : <span />}
          {props.showPercent !== false ? <span className="ae-progress-value">{percent}%</span> : null}
        </div>
      ) : null}
      <div ref={ref} className="ae-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={props.title || "Progress"}>
        <div className="ae-progress-bar" style={{ width: `${shown}%` }}>
          {props.innerText ? <span className="ae-progress-inner">{props.innerText}</span> : null}
        </div>
      </div>
    </div>
  );
}
const Progress = ({ element, common, editMode }: WidgetContext) => <ProgressView props={element.props as ProgressProps} common={common} editMode={editMode} />;

/** Counts from start to end once in view (ease-out), or shows the end at once under reduced motion. */
function CounterView({ props, common, editMode }: { props: CounterProps; common: WidgetContext["common"]; editMode: boolean }) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const reduced = useReducedMotion();
  const end = Number(props.end) || 0;
  const start = Number(props.start) || 0;
  const decimals = props.decimals ?? 0;
  const [value, setValue] = useState(start);
  const instant = editMode || reduced || !props.duration;
  useEffect(() => {
    if (instant || !seen) return;
    let frame = 0;
    const began = performance.now();
    const duration = props.duration ?? 2000;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      setValue(start + (end - start) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, instant, start, end, props.duration]);
  const shown = instant ? end : value;
  return (
    <div {...common} className={`${common.className} ae-counter`}>
      <span ref={ref} className="ae-counter-number" aria-label={`${props.prefix ?? ""}${formatNumber(end, decimals, props.separator !== false)}${props.suffix ?? ""}`}>
        <span aria-hidden="true">
          {props.prefix ? <span className="ae-counter-prefix">{props.prefix}</span> : null}
          {formatNumber(shown, decimals, props.separator !== false)}
          {props.suffix ? <span className="ae-counter-suffix">{props.suffix}</span> : null}
        </span>
      </span>
      {props.title ? <span className="ae-counter-title">{props.title}</span> : null}
    </div>
  );
}
const Counter = ({ element, common, editMode }: WidgetContext) => <CounterView props={element.props as CounterProps} common={common} editMode={editMode} />;

/** Registered by `createArmatureKit` (see library/index.ts); nothing happens at import. */
export const CONTENT_WIDGETS: Readonly<Record<string, WidgetRender>> = {
  "icon-box": IconBox,
  "image-box": ImageBox,
  "icon-list": IconList,
  testimonial: Testimonial,
  "star-rating": StarRating,
  alert: Alert,
  blockquote: Blockquote,
  cta: Cta,
  "price-table": PriceTable,
  "social-icons": SocialIcons,
  progress: Progress,
  counter: Counter,
};
