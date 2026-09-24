/**
 * Interactive widgets from the library: Accordion and Toggle, Tabs, Image Gallery,
 * Image Carousel, Countdown, Flip Box, Table of Contents, Google Map and the agency's
 * HTML embed. Keyboard and screen-reader patterns follow the WAI-ARIA practices; motion
 * stops for visitors who ask for less of it. In the editor, a click on an interactive
 * part of a selected widget reaches it (data-ae-interactive), and embedded frames sit
 * under a shield so a click selects the widget instead.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../icon.tsx";
import { safeMediaSrc } from "../sanitize.ts";
import type { AccordionProps, CarouselProps, CountdownProps, FlipBoxProps, GalleryImage, GalleryProps, HtmlProps, MapProps, PanelItem, TabsProps, TocProps } from "../types.ts";
import { linkAttributes, type WidgetContext, type WidgetRender } from "../widgets.tsx";
import { Lightbox, Paragraphs, Picture, Title, useReducedMotion } from "./common.tsx";
import { GLYPHS } from "./glyphs.ts";

const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

// --- accordion and toggle -------------------------------------------------------------------

function Panels({ props, common, multiple, type }: { props: AccordionProps; common: WidgetContext["common"]; multiple: boolean; type: string }) {
  const items = list<PanelItem>(props.items);
  const base = useId();
  const initial = (): Set<string> => {
    const open = props.open ?? (multiple ? "none" : "first");
    if (open === "all") return new Set(items.map((item) => item.id));
    if (open === "first" && items[0]) return new Set([items[0].id]);
    return new Set();
  };
  const [open, setOpen] = useState<Set<string>>(initial);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(multiple ? current : []);
      if (current.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div {...common} className={`${common.className} ae-panels ae-${type} ae-panels-icon-${props.iconPosition ?? "right"}`}>
      {items.map((item) => {
        const expanded = open.has(item.id);
        const button = `${base}-${item.id}-b`;
        const region = `${base}-${item.id}-r`;
        return (
          <div key={item.id} className={`ae-panel${expanded ? " ae-panel-open" : ""}`}>
            <Title tag={props.titleTag ?? "h3"} className="ae-panel-heading">
              <button type="button" id={button} className="ae-panel-toggle" aria-expanded={expanded} aria-controls={region} onClick={() => toggle(item.id)} data-ae-interactive="">
                <span className="ae-panel-title">{item.title}</span>
                <span className="ae-panel-icon" aria-hidden="true">
                  <Icon icon={expanded ? GLYPHS.minus : GLYPHS.plus} />
                </span>
              </button>
            </Title>
            <div id={region} role="region" aria-labelledby={button} className="ae-panel-body" hidden={!expanded}>
              <Paragraphs text={item.content} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
const Accordion = ({ element, common }: WidgetContext) => <Panels props={element.props as AccordionProps} common={common} multiple={false} type="accordion" />;
const Toggle = ({ element, common }: WidgetContext) => <Panels props={element.props as AccordionProps} common={common} multiple type="toggle" />;

// --- tabs --------------------------------------------------------------------------------------------

function TabsView({ props, common }: { props: TabsProps; common: WidgetContext["common"] }) {
  const items = list<PanelItem>(props.items);
  const base = useId();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.min(active, Math.max(0, items.length - 1));
  const vertical = props.layout === "vertical";
  const onKey = (event: KeyboardEvent) => {
    const keys = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    let next: number;
    if (event.key === keys[0]) next = (current - 1 + items.length) % items.length;
    else if (event.key === keys[1]) next = (current + 1) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };
  return (
    <div {...common} className={`${common.className} ae-tabs ae-tabs-${props.layout ?? "horizontal"} ae-tabs-align-${props.align ?? "start"}`}>
      <div role="tablist" aria-orientation={vertical ? "vertical" : "horizontal"} className="ae-tabs-list" onKeyDown={onKey}>
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${base}-${item.id}-t`}
            aria-selected={index === current}
            aria-controls={`${base}-${item.id}-p`}
            tabIndex={index === current ? 0 : -1}
            className="ae-tab"
            onClick={() => setActive(index)}
            data-ae-interactive=""
          >
            {item.title}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div key={item.id} role="tabpanel" id={`${base}-${item.id}-p`} aria-labelledby={`${base}-${item.id}-t`} className="ae-tab-panel" hidden={index !== current} tabIndex={0}>
          <Paragraphs text={item.content} />
        </div>
      ))}
    </div>
  );
}
const Tabs = ({ element, common }: WidgetContext) => <TabsView props={element.props as TabsProps} common={common} />;

// --- gallery and carousel ---------------------------------------------------------------------------------

function GalleryView({ props, common }: { props: GalleryProps; common: WidgetContext["common"] }) {
  const images = list<GalleryImage>(props.images).filter((image) => safeMediaSrc(image.src));
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div {...common} className={`${common.className} ae-gallery ae-aspect-${(props.aspect ?? "1/1").replace("/", "x")}`}>
      <ul className="ae-gallery-grid">
        {images.map((image, index) => (
          <li key={image.id} className="ae-gallery-item">
            <figure>
              {props.lightbox !== false ? (
                <button type="button" className="ae-gallery-open" onClick={() => setOpen(index)} aria-label={`Open picture ${index + 1}${image.alt ? `: ${image.alt}` : ""}`} data-ae-interactive="">
                  <Picture src={image.src} alt={image.alt} />
                </button>
              ) : (
                <Picture src={image.src} alt={image.alt} />
              )}
              {props.captions && image.caption ? <figcaption>{image.caption}</figcaption> : null}
            </figure>
          </li>
        ))}
      </ul>
      {props.lightbox !== false ? <Lightbox images={images} index={open} onClose={() => setOpen(null)} onIndex={setOpen} /> : null}
    </div>
  );
}
const Gallery = ({ element, common }: WidgetContext) => <GalleryView props={element.props as GalleryProps} common={common} />;

function CarouselView({ props, common, editMode }: { props: CarouselProps; common: WidgetContext["common"]; editMode: boolean }) {
  const images = list<GalleryImage>(props.images).filter((image) => safeMediaSrc(image.src));
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const count = images.length;
  const go = (next: number) => {
    const node = track.current;
    if (!node || count === 0) return;
    const wrapped = props.loop !== false ? (next + count) % count : Math.max(0, Math.min(count - 1, next));
    const slide = node.children[wrapped] as HTMLElement | undefined;
    if (slide) node.scrollTo({ left: slide.offsetLeft - node.offsetLeft, behavior: reduced ? "auto" : "smooth" });
    setIndex(wrapped);
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  // Autoplay: never in the editor, never under reduced motion, paused on hover and focus.
  useEffect(() => {
    if (!props.autoplay || editMode || reduced || paused || count < 2) return;
    const timer = window.setInterval(() => goRef.current(index + 1), props.interval ?? 5000);
    return () => window.clearInterval(timer);
  }, [props.autoplay, props.interval, editMode, reduced, paused, count, index]);
  // Keep the dots in step with manual scrolling.
  const onScroll = () => {
    const node = track.current;
    if (!node) return;
    const children = Array.from(node.children) as HTMLElement[];
    let nearest = 0;
    let best = Infinity;
    children.forEach((child, childIndex) => {
      const distance = Math.abs(child.offsetLeft - node.offsetLeft - node.scrollLeft);
      if (distance < best) {
        best = distance;
        nearest = childIndex;
      }
    });
    if (nearest !== index) setIndex(nearest);
  };
  const hover = props.pauseOnHover !== false ? { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false) } : {};
  return (
    <div {...common} className={`${common.className} ae-carousel ae-aspect-${(props.aspect ?? "4/3").replace("/", "x")}`} role="region" aria-roledescription="carousel" aria-label="Pictures" {...hover} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <ul ref={track} className="ae-carousel-track" onScroll={onScroll}>
        {images.map((image, slide) => (
          <li key={image.id} className="ae-carousel-slide" aria-roledescription="slide" aria-label={`${slide + 1} of ${count}`}>
            <figure>
              {props.lightbox ? (
                <button type="button" className="ae-gallery-open" onClick={() => setOpen(slide)} aria-label={`Open picture ${slide + 1}`} data-ae-interactive="">
                  <Picture src={image.src} alt={image.alt} />
                </button>
              ) : (
                <Picture src={image.src} alt={image.alt} eager={slide === 0} />
              )}
              {props.captions && image.caption ? <figcaption>{image.caption}</figcaption> : null}
            </figure>
          </li>
        ))}
      </ul>
      {props.arrows !== false && count > 1 ? (
        <>
          <button type="button" className="ae-carousel-prev" aria-label="Previous" onClick={() => go(index - 1)} data-ae-interactive="">
            <Icon icon={GLYPHS.chevronLeft} />
          </button>
          <button type="button" className="ae-carousel-next" aria-label="Next" onClick={() => go(index + 1)} data-ae-interactive="">
            <Icon icon={GLYPHS.chevronRight} />
          </button>
        </>
      ) : null}
      {props.dots !== false && count > 1 ? (
        <div className="ae-carousel-dots">
          {images.map((image, dot) => (
            <button key={image.id} type="button" className="ae-carousel-dot" aria-label={`Go to picture ${dot + 1}`} aria-current={dot === index ? "true" : undefined} onClick={() => go(dot)} data-ae-interactive="" />
          ))}
        </div>
      ) : null}
      {props.lightbox ? <Lightbox images={images} index={open} onClose={() => setOpen(null)} onIndex={setOpen} /> : null}
    </div>
  );
}
const Carousel = ({ element, common, editMode }: WidgetContext) => <CarouselView props={element.props as CarouselProps} common={common} editMode={editMode} />;

// --- countdown -----------------------------------------------------------------------------------------

/** When this visitor first saw an evergreen countdown (remembered in their browser when it can be). */
export function evergreenStart(id: string, now: number, storage: Pick<Storage, "getItem" | "setItem"> | null): number {
  try {
    const key = `ae-countdown-${id}`;
    const saved = Number(storage?.getItem(key));
    if (saved > 0 && saved <= now) return saved;
    storage?.setItem(key, String(now));
  } catch {
    // Storage blocked (private mode): the countdown restarts on each visit.
  }
  return now;
}

/** The moment the countdown ends: a fixed date, or the visitor's first visit plus the minutes. */
export function countdownTarget(props: CountdownProps, start: number): number | null {
  if ((props.mode ?? "date") === "date") {
    const parsed = props.date ? Date.parse(props.date) : NaN;
    return Number.isNaN(parsed) ? null : parsed;
  }
  return start + (props.minutes ?? 60) * 60_000;
}

const browserStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function countdownParts(remaining: number) {
  const total = Math.max(0, Math.floor(remaining / 1000));
  return { days: Math.floor(total / 86_400), hours: Math.floor((total % 86_400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

function CountdownView({ props, common, id, editMode }: { props: CountdownProps; common: WidgetContext["common"]; id: string; editMode: boolean }) {
  const [now, setNow] = useState<number>(() => Date.now());
  // The editor never remembers a start, so the countdown there always shows its full length.
  const [start] = useState<number>(() => (editMode ? Date.now() : evergreenStart(id, Date.now(), browserStorage())));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const target = countdownTarget(props, start);
  const units = { days: true, hours: true, minutes: true, seconds: true, ...(props.units ?? {}) };
  const remaining = target !== null ? target - now : null;
  if (remaining !== null && remaining <= 0 && !editMode) {
    return (
      <div {...common} className={`${common.className} ae-countdown ae-countdown-expired`}>
        <p>{props.expired || "This offer has ended."}</p>
      </div>
    );
  }
  const parts = remaining !== null ? countdownParts(remaining) : null;
  const labels = { days: "Days", hours: "Hours", minutes: "Minutes", seconds: "Seconds" };
  return (
    <div {...common} className={`${common.className} ae-countdown`} role="timer" aria-live="off">
      {(Object.keys(labels) as (keyof typeof labels)[])
        .filter((unit) => units[unit])
        .map((unit) => (
          <div key={unit} className="ae-countdown-unit">
            <span className="ae-countdown-value">{parts ? String(parts[unit]).padStart(2, "0") : "--"}</span>
            {props.labels !== false ? <span className="ae-countdown-label">{labels[unit]}</span> : null}
          </div>
        ))}
    </div>
  );
}
const Countdown = ({ element, common, editMode }: WidgetContext) => <CountdownView props={element.props as CountdownProps} common={common} id={element.id} editMode={editMode} />;

// --- flip box ---------------------------------------------------------------------------------------------

function FlipBox({ element, common }: WidgetContext) {
  const props = element.props as FlipBoxProps;
  const front = props.front ?? { title: "" };
  const back = props.back ?? { title: "" };
  const link = linkAttributes(back.link);
  const side = (content: typeof front, className: string) => (
    <div className={className}>
      {content.src ? <Picture src={content.src} alt="" className="ae-flip-image" /> : null}
      {content.icon ? (
        <span className="ae-flip-icon">
          <Icon icon={content.icon} />
        </span>
      ) : null}
      <h3 className="ae-flip-title">{content.title}</h3>
      <Paragraphs text={content.description} className="ae-flip-text" />
    </div>
  );
  return (
    // Focusable so keyboard users can turn it too (the back's link is reachable either way).
    <div {...common} className={`${common.className} ae-flip ae-flip-${props.effect ?? "flip"} ae-flip-${props.direction ?? "left"}`} tabIndex={link ? undefined : 0}>
      <div className="ae-flip-inner">
        {side(front, "ae-flip-front")}
        <div className="ae-flip-back">
          {back.icon ? (
            <span className="ae-flip-icon">
              <Icon icon={back.icon} />
            </span>
          ) : null}
          <h3 className="ae-flip-title">{back.title}</h3>
          <Paragraphs text={back.description} className="ae-flip-text" />
          {back.buttonText ? (
            <a className="ae-btn ae-btn-primary ae-btn-md" {...(link ?? { href: "#" })}>
              <span className="ae-btn-text">{back.buttonText}</span>
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --- table of contents ------------------------------------------------------------------------------------

type TocEntry = { id: string; text: string; level: number };

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "section";

function TocView({ props, common }: { props: TocProps; common: WidgetContext["common"] }) {
  const root = useRef<HTMLElement>(null);
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [open, setOpen] = useState(props.startOpen !== false);
  const levels = (props.headings ?? ["h2", "h3"]).join(",");
  useEffect(() => {
    const node = root.current;
    const page = node?.closest(".ae-root")?.parentElement ?? document.body;
    if (!node) return;
    const scan = () => {
      const used = new Set<string>();
      const found: TocEntry[] = [];
      for (const heading of Array.from(page.querySelectorAll<HTMLElement>(levels))) {
        if (node.contains(heading) || heading.closest("[hidden], .ae-toc, dialog")) continue;
        const text = heading.textContent?.trim() ?? "";
        if (!text) continue;
        // Headings without an id get one, so the links have somewhere to go.
        let id = heading.id;
        if (!id) {
          id = slugify(text);
          let n = 2;
          while (used.has(id) || (document.getElementById(id) && document.getElementById(id) !== heading)) id = `${slugify(text)}-${n++}`;
          heading.id = id;
        }
        used.add(id);
        found.push({ id, text, level: Number(heading.tagName.slice(1)) });
      }
      setEntries((current) => (JSON.stringify(current) === JSON.stringify(found) ? current : found));
    };
    scan();
    const observer = typeof MutationObserver === "function" ? new MutationObserver(scan) : null;
    observer?.observe(page, { childList: true, subtree: true, characterData: true });
    return () => observer?.disconnect();
  }, [levels]);
  const top = entries.reduce((min, entry) => Math.min(min, entry.level), 6);
  const ListTag = props.marker === "numbers" ? "ol" : "ul";
  const body = (
    <ListTag className={`ae-toc-list ae-toc-${props.marker ?? "bullets"}`}>
      {entries.map((entry) => (
        <li key={entry.id} style={{ marginInlineStart: `${(entry.level - top) * 1.1}em` }}>
          <a href={`#${entry.id}`}>{entry.text}</a>
        </li>
      ))}
    </ListTag>
  );
  return (
    <nav {...common} ref={root} className={`${common.className} ae-toc`} aria-label={props.title || "Table of contents"}>
      {props.collapsible ? (
        <button type="button" className="ae-toc-head" aria-expanded={open} onClick={() => setOpen((current) => !current)} data-ae-interactive="">
          <span className="ae-toc-title">{props.title || "Contents"}</span>
          <Icon icon={GLYPHS.chevronDown} />
        </button>
      ) : props.title ? (
        <p className="ae-toc-title">{props.title}</p>
      ) : null}
      {!props.collapsible || open ? body : null}
      {entries.length === 0 ? <p className="ae-toc-empty">Headings on this page appear here.</p> : null}
    </nav>
  );
}
const Toc = ({ element, common }: WidgetContext) => <TocView props={element.props as TocProps} common={common} />;

// --- embeds -------------------------------------------------------------------------------------------------

/** A Google Maps embed address for a place. */
export const mapUrl = (address: string, zoom: number) => `https://maps.google.com/maps?q=${encodeURIComponent(address.slice(0, 300))}&z=${Math.max(1, Math.min(20, Math.round(zoom)))}&output=embed`;

function MapWidget({ element, common, editMode }: WidgetContext) {
  const props = element.props as MapProps;
  const address = typeof props.address === "string" ? props.address.trim() : "";
  return (
    <div {...common} className={`${common.className} ae-map`}>
      {address ? <iframe src={mapUrl(address, props.zoom ?? 14)} title={props.title || `Map of ${address}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : <div className="ae-embed-empty">Add an address</div>}
      {editMode ? <span className="ae-embed-shield" aria-hidden="true" /> : null}
    </div>
  );
}

/** Agency only: the code runs in a sandboxed frame with its own origin; it can never reach the page. */
function Html({ element, common, editMode }: WidgetContext) {
  const props = element.props as HtmlProps;
  const code = typeof props.code === "string" ? props.code : "";
  return (
    <div {...common} className={`${common.className} ae-html`}>
      {code ? <iframe srcDoc={code} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms" title={props.title || "Embedded content"} loading="lazy" referrerPolicy="no-referrer" /> : editMode ? <div className="ae-embed-empty">Add HTML</div> : null}
      {editMode ? <span className="ae-embed-shield" aria-hidden="true" /> : null}
    </div>
  );
}

/** Registered by `createArmatureKit` (see library/index.ts); nothing happens at import. */
export const INTERACTIVE_WIDGETS: Readonly<Record<string, WidgetRender>> = {
  accordion: Accordion,
  toggle: Toggle,
  tabs: Tabs,
  gallery: Gallery,
  carousel: Carousel,
  countdown: Countdown,
  "flip-box": FlipBox,
  toc: Toc,
  map: MapWidget,
  html: Html,
};
