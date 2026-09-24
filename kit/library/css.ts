/**
 * The widget library's CSS: one base stylesheet (scoped to .ae-root, sharing the kit's
 * custom properties) and a hook per widget for the values its Content tab sets (sizes,
 * colours, columns, heights), written like every other element rule.
 */
import { registerBaseCss, registerWidgetCss, type WidgetCssHook } from "../css.ts";
import type { Size } from "../types.ts";
import { refToCss, sizeToCss } from "../values.ts";

const color = (value: unknown) => (typeof value === "string" ? refToCss(value) : undefined);
const size = (value: unknown) => (value && typeof value === "object" ? sizeToCss(value as Size) : undefined);
const justify = (value: string) => (value === "center" ? "center" : value === "right" ? "flex-end" : "flex-start");

const alignItems = (value: string) => (value === "center" ? "center" : value === "right" ? "flex-end" : "flex-start");

const siteLogoCss: WidgetCssHook = (sheet, selector, props) => {
  const height = size(props["height"]);
  if (height) sheet.add("base", selector, "--ae-logo-height", height);
  const align = props["align"];
  if (typeof align === "string") sheet.add("base", selector, "text-align", align);
};

const navMenuCss: WidgetCssHook = (sheet, selector, props) => {
  const gap = size(props["gap"]);
  if (gap) sheet.add("base", selector, "--ae-nav-gap", gap);
  const align = props["align"];
  if (typeof align === "string") {
    sheet.add("base", selector, "--ae-nav-justify", justify(align));
    sheet.add("base", selector, "--ae-nav-align-items", alignItems(align));
  }
};

const BASE = `
.ae-root .ae-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ae-root .ae-bg-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; pointer-events: none; }
.ae-root .ae-has-video > .ae-con-inner { position: relative; z-index: 1; }
@media (prefers-reduced-motion: reduce) { .ae-root .ae-bg-video { display: none; } }
.ae-root .ae-icon-widget { line-height: 0; font-size: 48px; }
.ae-root .ae-icon-shape { display: inline-flex; align-items: center; justify-content: center; color: var(--ae-color-primary); text-decoration: none; }
.ae-root .ae-icon-shape .ae-icon-svg { width: 1em; height: 1em; }
.ae-root .ae-icon-stacked, .ae-root .ae-icon-framed { padding: 0.5em; }
.ae-root .ae-icon-stacked { background: var(--ae-color-primary); color: #fff; }
.ae-root .ae-icon-framed { border: 2px solid currentColor; }
.ae-root .ae-icon-circle { border-radius: 50%; }
.ae-root .ae-logo { line-height: 0; }
.ae-root .ae-logo-link { display: inline-block; }
.ae-root .ae-logo-img { height: var(--ae-logo-height, 48px); width: auto; max-width: 100%; }
.ae-root .ae-logo-empty { display: inline-flex; align-items: center; height: var(--ae-logo-height, 48px); padding: 0 12px; border: 1px dashed #b8c2cc; border-radius: 6px; font: 600 13px/1 var(--ae-font-body); color: #4a5866; line-height: 1; }
.ae-root .ae-nav { position: relative; font-family: var(--ae-font-body); }
.ae-root .ae-nav-sticky { position: sticky; top: 0; z-index: 40; }
.ae-root .ae-nav-list, .ae-root .ae-nav-sub { list-style: none; margin: 0; padding: 0; }
.ae-root .ae-nav-list { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ae-nav-gap, 8px); justify-content: var(--ae-nav-justify, flex-start); }
.ae-root .ae-nav-vertical .ae-nav-list { flex-direction: column; align-items: var(--ae-nav-align-items, flex-start); }
.ae-root .ae-nav-item { position: relative; }
.ae-root .ae-nav-row { display: inline-flex; align-items: center; gap: 4px; }
.ae-root .ae-nav-link { display: inline-block; padding: 8px 10px; color: var(--ae-color-text); text-decoration: none; font-weight: 500; border-radius: 6px; }
.ae-root .ae-nav-link:hover, .ae-root .ae-nav-link[aria-current="page"] { color: var(--ae-color-primary); }
.ae-root .ae-nav-sub-toggle { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 6px; }
.ae-root .ae-nav-sub { display: none; min-width: 200px; padding: 6px; background: #fff; border: 1px solid #d7dde3; border-radius: 8px; box-shadow: 0 12px 32px rgba(22, 32, 43, 0.14); }
.ae-root .ae-nav-horizontal .ae-nav-sub { position: absolute; left: 0; top: 100%; z-index: 30; }
.ae-root .ae-nav-item.ae-nav-open > .ae-nav-sub, .ae-root .ae-nav-horizontal .ae-nav-item:hover > .ae-nav-sub, .ae-root .ae-nav-horizontal .ae-nav-item:focus-within > .ae-nav-sub { display: block; }
.ae-root .ae-nav-sub .ae-nav-link { display: block; }
.ae-root .ae-nav-toggle { display: none; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; background: transparent; color: var(--ae-color-text); cursor: pointer; border-radius: 6px; }
.ae-root .ae-nav-toggle-bars { display: flex; flex-direction: column; gap: 5px; width: 22px; }
.ae-root .ae-nav-toggle-bars span { display: block; height: 2px; background: currentColor; border-radius: 2px; }
.ae-root .ae-nav-empty { display: inline-block; padding: 8px 12px; border: 1px dashed #b8c2cc; border-radius: 6px; font: 500 13px/1.4 var(--ae-font-body); color: #4a5866; }
.ae-root .ae-icon-square { border-radius: 0; }
.ae-root .ae-video { position: relative; width: 100%; overflow: hidden; background: #0d1117; border-radius: var(--ae-image-radius); }
.ae-root .ae-video-media { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; object-fit: cover; }
.ae-root .ae-video-facade { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 0; border: 0; background: #0d1117; cursor: pointer; }
.ae-root .ae-video-facade img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ae-root .ae-video-play { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 50%; background: rgba(0,0,0,0.65); color: #fff; font-size: 30px; transition: transform 0.2s ease, background-color 0.2s ease; }
.ae-root .ae-video-play .ae-icon-svg { fill: currentColor; margin-left: 4px; }
.ae-root .ae-video-facade:hover .ae-video-play, .ae-root .ae-video-facade:focus-visible .ae-video-play { transform: scale(1.08); background: var(--ae-color-primary); }
.ae-root .ae-video-note { position: absolute; bottom: 10px; right: 12px; font-size: 12px; color: rgba(255,255,255,0.8); }
.ae-root .ae-video-empty, .ae-root .ae-embed-empty { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 120px; color: #6b7785; font-size: 14px; background: repeating-linear-gradient(45deg, #eef1f4, #eef1f4 10px, #e6eaee 10px, #e6eaee 20px); }
.ae-root .ae-box { display: flex; flex-direction: column; gap: 16px; }
.ae-root .ae-box-left { flex-direction: row; }
.ae-root .ae-box-right { flex-direction: row-reverse; }
.ae-root .ae-box-media { flex: 0 0 auto; margin: 0; }
.ae-root .ae-box-icon { display: inline-flex; font-size: 44px; color: var(--ae-color-primary); line-height: 0; }
.ae-root .ae-box-image img { display: block; width: 100%; height: auto; border-radius: var(--ae-image-radius); }
.ae-root .ae-box-left .ae-box-image, .ae-root .ae-box-right .ae-box-image { width: 35%; }
.ae-root .ae-box-title { margin: 0 0 0.4em; font-family: var(--ae-type-h4-family); font-size: var(--ae-type-h4-size); font-weight: var(--ae-type-h4-weight); line-height: var(--ae-type-h4-lh); }
.ae-root .ae-box-title a { color: inherit; text-decoration: none; }
.ae-root .ae-box-text p, .ae-root .ae-panel-body p, .ae-root .ae-tab-panel p, .ae-root .ae-cta-text p, .ae-root .ae-flip-text p, .ae-root .ae-alert-text p { margin: 0 0 0.75em; }
.ae-root .ae-box-text p:last-child, .ae-root .ae-panel-body p:last-child, .ae-root .ae-tab-panel p:last-child, .ae-root .ae-cta-text p:last-child, .ae-root .ae-flip-text p:last-child, .ae-root .ae-alert-text p:last-child { margin-bottom: 0; }
.ae-root .ae-icon-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ae-root .ae-icon-list-inline { flex-direction: row; flex-wrap: wrap; gap: 8px 20px; }
.ae-root .ae-icon-list li > a, .ae-root .ae-icon-list li { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; }
.ae-root .ae-icon-list-divided li + li { border-top: 1px solid rgba(0,0,0,0.1); padding-top: 8px; }
.ae-root .ae-icon-list-icon { display: inline-flex; color: var(--ae-color-primary); flex: 0 0 auto; }
.ae-root .ae-panels { display: flex; flex-direction: column; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; overflow: hidden; }
.ae-root .ae-panel + .ae-panel { border-top: 1px solid rgba(0,0,0,0.12); }
.ae-root .ae-panel-heading { margin: 0; font: inherit; }
.ae-root .ae-panel-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 16px 20px; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.ae-root .ae-panels-icon-left .ae-panel-toggle { flex-direction: row-reverse; justify-content: flex-end; }
.ae-root .ae-panel-toggle:focus-visible, .ae-root .ae-tab:focus-visible { outline: 2px solid var(--ae-color-primary); outline-offset: -2px; }
.ae-root .ae-panel-icon { display: inline-flex; flex: 0 0 auto; color: var(--ae-color-primary); }
.ae-root .ae-panel-body { padding: 0 20px 18px; }
.ae-root .ae-tabs { display: flex; flex-direction: column; }
.ae-root .ae-tabs-vertical { flex-direction: row; }
.ae-root .ae-tabs-list { display: flex; gap: 4px; border-bottom: 1px solid rgba(0,0,0,0.12); }
.ae-root .ae-tabs-vertical .ae-tabs-list { flex-direction: column; border-bottom: 0; border-right: 1px solid rgba(0,0,0,0.12); min-width: 180px; }
.ae-root .ae-tabs-align-center .ae-tabs-list { justify-content: center; }
.ae-root .ae-tabs-align-end .ae-tabs-list { justify-content: flex-end; }
.ae-root .ae-tabs-align-stretch .ae-tabs-list > .ae-tab { flex: 1 1 0; }
.ae-root .ae-tab { padding: 12px 18px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; opacity: 0.7; }
.ae-root .ae-tab[aria-selected="true"] { opacity: 1; border-bottom-color: var(--ae-color-primary); color: var(--ae-color-primary); }
.ae-root .ae-tabs-vertical .ae-tab { text-align: left; border-bottom: 0; border-right: 2px solid transparent; }
.ae-root .ae-tabs-vertical .ae-tab[aria-selected="true"] { border-right-color: var(--ae-color-primary); }
.ae-root .ae-tab-panel { padding: 20px 4px; }
.ae-root .ae-tabs-vertical .ae-tab-panel { padding: 4px 24px; flex: 1 1 auto; }
.ae-root .ae-testimonial { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
.ae-root .ae-testimonial-image-left { flex-direction: row; text-align: left; align-items: flex-start; }
.ae-root .ae-testimonial-image-bottom { flex-direction: column-reverse; }
.ae-root .ae-testimonial-image { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; flex: 0 0 auto; }
.ae-root .ae-testimonial-quote { margin: 0 0 12px; font-size: 1.1em; font-style: italic; }
.ae-root .ae-testimonial-quote p { margin: 0 0 0.5em; }
.ae-root .ae-testimonial-cite { display: flex; flex-direction: column; gap: 2px; }
.ae-root .ae-testimonial-name { font-weight: 700; }
.ae-root .ae-testimonial-role { font-size: 0.9em; opacity: 0.75; }
.ae-root .ae-stars { position: relative; display: inline-block; line-height: 1; font-size: 22px; letter-spacing: 2px; color: #d7dde3; white-space: nowrap; }
.ae-root .ae-stars-filled { position: absolute; top: 0; left: 0; overflow: hidden; color: #f0ad1c; }
.ae-root .ae-star-rating { display: flex; align-items: center; gap: 10px; }
.ae-root .ae-counter { display: flex; flex-direction: column; gap: 6px; text-align: center; }
.ae-root .ae-counter-number { font-family: var(--ae-type-h2-family); font-size: 3em; font-weight: 700; line-height: 1; color: var(--ae-color-primary); font-variant-numeric: tabular-nums; }
.ae-root .ae-counter-title { font-weight: 600; }
.ae-root .ae-progress-head { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 6px; font-weight: 600; }
.ae-root .ae-progress-track { height: 12px; border-radius: 999px; background: #e6eaee; overflow: hidden; }
.ae-root .ae-progress-bar { height: 100%; border-radius: inherit; background: var(--ae-color-primary); transition: width 1.2s cubic-bezier(0.2, 0.8, 0.2, 1); display: flex; align-items: center; }
@media (prefers-reduced-motion: reduce) { .ae-root .ae-progress-bar { transition: none; } }
.ae-root .ae-progress-inner { padding: 0 10px; font-size: 11px; color: #fff; white-space: nowrap; }
.ae-root .ae-alert { position: relative; display: flex; gap: 12px; padding: 14px 44px 14px 16px; border-radius: 8px; border-left: 4px solid; }
.ae-root .ae-alert-info { background: #e7eafc; border-color: #24339f; color: #1b2459; }
.ae-root .ae-alert-success { background: #e1f2e9; border-color: #176b43; color: #0f4a2e; }
.ae-root .ae-alert-warning { background: #fcefd9; border-color: #8a4b00; color: #5c3200; }
.ae-root .ae-alert-danger { background: #fbe9e9; border-color: #a32d2d; color: #6e1d1d; }
.ae-root .ae-alert-icon { display: inline-flex; font-size: 20px; flex: 0 0 auto; margin-top: 1px; }
.ae-root .ae-alert-title { display: block; margin-bottom: 2px; }
.ae-root .ae-alert-close { position: absolute; top: 10px; right: 10px; display: inline-flex; padding: 4px; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 16px; }
.ae-root .ae-quote { margin: 0; }
.ae-root .ae-quote-text { margin: 0; font-size: 1.2em; }
.ae-root .ae-quote-text p { margin: 0 0 0.5em; }
.ae-root .ae-quote-border .ae-quote-text { padding-left: 20px; border-left: 4px solid var(--ae-color-primary); }
.ae-root .ae-quote-quotation .ae-quote-text::before { content: "\\201C"; display: block; font-size: 3em; line-height: 0.8; color: var(--ae-color-primary); }
.ae-root .ae-quote-boxed { padding: 24px; border-radius: 8px; background: rgba(0,0,0,0.04); }
.ae-root .ae-quote-cite { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; font-size: 0.95em; }
.ae-root .ae-quote-author { font-weight: 700; }
.ae-root .ae-quote-source { font-style: normal; opacity: 0.8; }
.ae-root .ae-quote-source::before { content: "\\2014 "; }
.ae-root .ae-ribbon { position: absolute; top: 14px; right: -34px; z-index: 2; transform: rotate(45deg); padding: 4px 40px; background: var(--ae-color-accent); color: #16202b; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.ae-root .ae-cta { position: relative; overflow: hidden; display: flex; flex-direction: column; border-radius: 10px; background: rgba(0,0,0,0.04); }
.ae-root .ae-cta-image { display: block; width: 100%; height: auto; object-fit: cover; }
.ae-root .ae-cta-body { display: flex; flex-direction: column; gap: 12px; padding: 32px; }
.ae-root .ae-cta-title { margin: 0; font-family: var(--ae-type-h3-family); font-size: var(--ae-type-h3-size); font-weight: var(--ae-type-h3-weight); line-height: var(--ae-type-h3-lh); }
.ae-root .ae-cta-cover { min-height: 320px; justify-content: center; color: #fff; }
.ae-root .ae-cta-cover .ae-cta-image { position: absolute; inset: 0; height: 100%; }
.ae-root .ae-cta-cover::after { content: ""; position: absolute; inset: 0; background: rgba(0,0,0,0.45); }
.ae-root .ae-cta-cover .ae-cta-body { position: relative; z-index: 1; }
.ae-root .ae-cta .ae-btn, .ae-root .ae-flip-back .ae-btn, .ae-root .ae-price-button { align-self: flex-start; }
.ae-root .ae-price { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 32px 24px; border: 1px solid rgba(0,0,0,0.12); border-radius: 12px; text-align: center; background: #fff; }
.ae-root .ae-price-featured { border: 2px solid var(--ae-color-primary); box-shadow: 0 16px 40px rgba(0,0,0,0.12); }
.ae-root .ae-price-heading { margin: 0; font-family: var(--ae-type-h4-family); font-size: var(--ae-type-h4-size); font-weight: var(--ae-type-h4-weight); }
.ae-root .ae-price-sub { margin: 4px 0 0; opacity: 0.75; }
.ae-root .ae-price-amount { margin: 0; display: flex; align-items: baseline; gap: 4px; }
.ae-root .ae-price-currency { font-size: 1.4em; font-weight: 600; }
.ae-root .ae-price-value { font-size: 3em; font-weight: 800; line-height: 1; color: var(--ae-color-primary); }
.ae-root .ae-price-period { opacity: 0.7; }
.ae-root .ae-price-features { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; align-self: stretch; text-align: left; }
.ae-root .ae-price-features li { display: flex; align-items: center; gap: 10px; }
.ae-root .ae-price-yes .ae-icon-svg { color: #176b43; }
.ae-root .ae-price-no { opacity: 0.55; }
.ae-root .ae-price-no .ae-icon-svg { color: #a32d2d; }
.ae-root .ae-price-button { align-self: stretch; }
.ae-root .ae-price-footer { margin: 0; font-size: 0.85em; opacity: 0.7; }
.ae-root .ae-social { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.ae-root .ae-social-link { display: inline-flex; align-items: center; justify-content: center; width: 2.4em; height: 2.4em; font-size: 18px; color: #fff; background: var(--ae-brand); border-radius: 8px; transition: transform 0.2s ease, opacity 0.2s ease; }
.ae-root .ae-social-link:hover { transform: translateY(-2px); opacity: 0.9; }
.ae-root .ae-social-circle .ae-social-link { border-radius: 50%; }
.ae-root .ae-social-square .ae-social-link { border-radius: 0; }
.ae-root .ae-social-link .ae-icon-svg { width: 1.1em; height: 1.1em; }
.ae-root .ae-gallery-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.ae-root .ae-gallery figure, .ae-root .ae-carousel figure { margin: 0; }
.ae-root .ae-gallery img, .ae-root .ae-carousel img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: var(--ae-image-radius); }
.ae-root .ae-gallery figcaption, .ae-root .ae-carousel figcaption { margin-top: 6px; font-size: 0.875em; opacity: 0.8; }
.ae-root .ae-gallery-open { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.ae-root .ae-aspect-1x1 img { aspect-ratio: 1 / 1; }
.ae-root .ae-aspect-4x3 img { aspect-ratio: 4 / 3; }
.ae-root .ae-aspect-3x2 img { aspect-ratio: 3 / 2; }
.ae-root .ae-aspect-16x9 img { aspect-ratio: 16 / 9; }
.ae-root .ae-aspect-3x4 img { aspect-ratio: 3 / 4; }
.ae-root .ae-aspect-auto img { height: auto; }
.ae-root .ae-carousel { position: relative; --ae-per-view: 1; --ae-gap: 12px; }
.ae-root .ae-carousel-track { list-style: none; margin: 0; padding: 0; display: flex; gap: var(--ae-gap); overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.ae-root .ae-carousel-track::-webkit-scrollbar { display: none; }
.ae-root .ae-carousel-slide { flex: 0 0 calc((100% - (var(--ae-per-view) - 1) * var(--ae-gap)) / var(--ae-per-view)); scroll-snap-align: start; }
.ae-root .ae-carousel-prev, .ae-root .ae-carousel-next { position: absolute; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: rgba(255,255,255,0.9); color: #16202b; font-size: 20px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.ae-root .ae-carousel-prev { left: 10px; }
.ae-root .ae-carousel-next { right: 10px; }
.ae-root .ae-carousel-dots { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
.ae-root .ae-carousel-dot { width: 10px; height: 10px; padding: 0; border: 0; border-radius: 50%; background: #c3ccd6; cursor: pointer; }
.ae-root .ae-carousel-dot[aria-current="true"] { background: var(--ae-color-primary); }
.ae-root .ae-lightbox { max-width: min(92vw, 1400px); max-height: 92vh; padding: 0; border: 0; background: transparent; overflow: visible; }
.ae-root .ae-lightbox::backdrop { background: rgba(10, 14, 20, 0.88); }
.ae-root .ae-lightbox-figure { margin: 0; }
.ae-root .ae-lightbox-img { display: block; max-width: min(92vw, 1400px); max-height: 84vh; width: auto; height: auto; margin: 0 auto; }
.ae-root .ae-lightbox figcaption { margin-top: 8px; color: #fff; text-align: center; }
.ae-root .ae-lightbox-close, .ae-root .ae-lightbox-prev, .ae-root .ae-lightbox-next { position: fixed; border: 0; background: rgba(255,255,255,0.12); color: #fff; width: 44px; height: 44px; border-radius: 50%; font-size: 28px; line-height: 1; cursor: pointer; }
.ae-root .ae-lightbox-close { top: 16px; right: 16px; }
.ae-root .ae-lightbox-prev { left: 16px; top: 50%; }
.ae-root .ae-lightbox-next { right: 16px; top: 50%; }
.ae-root .ae-lightbox-count { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); color: #fff; font-size: 13px; }
.ae-root .ae-countdown { display: flex; flex-wrap: wrap; gap: 12px; }
.ae-root .ae-countdown-unit { flex: 1 1 0; min-width: 72px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 8px; border-radius: 8px; background: var(--ae-color-secondary); color: #fff; }
.ae-root .ae-countdown-value { font-size: 2.2em; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
.ae-root .ae-countdown-label { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85; }
.ae-root .ae-countdown-expired p { margin: 0; font-weight: 600; }
.ae-root .ae-flip { position: relative; height: 300px; perspective: 1000px; }
.ae-root .ae-flip-inner { position: relative; width: 100%; height: 100%; transition: transform 0.6s ease; transform-style: preserve-3d; }
.ae-root .ae-flip-front, .ae-root .ae-flip-back { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; border-radius: 10px; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.ae-root .ae-flip-front { background: var(--ae-color-primary); color: #fff; }
.ae-root .ae-flip-back { background: var(--ae-color-secondary); color: #fff; }
.ae-root .ae-flip-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.35; }
.ae-root .ae-flip-icon, .ae-root .ae-flip-title, .ae-root .ae-flip-text, .ae-root .ae-flip-back .ae-btn { position: relative; }
.ae-root .ae-flip-icon { display: inline-flex; font-size: 40px; }
.ae-root .ae-flip-title { margin: 0; font-size: 1.4em; color: inherit; }
.ae-root .ae-cta-cover .ae-cta-title, .ae-root .ae-countdown-value { color: inherit; }
.ae-root .ae-flip-flip.ae-flip-left .ae-flip-back { transform: rotateY(180deg); }
.ae-root .ae-flip-flip.ae-flip-right .ae-flip-back { transform: rotateY(-180deg); }
.ae-root .ae-flip-flip.ae-flip-up .ae-flip-back { transform: rotateX(-180deg); }
.ae-root .ae-flip-flip.ae-flip-down .ae-flip-back { transform: rotateX(180deg); }
.ae-root .ae-flip-flip.ae-flip-left:is(:hover, :focus-within) .ae-flip-inner { transform: rotateY(180deg); }
.ae-root .ae-flip-flip.ae-flip-right:is(:hover, :focus-within) .ae-flip-inner { transform: rotateY(-180deg); }
.ae-root .ae-flip-flip.ae-flip-up:is(:hover, :focus-within) .ae-flip-inner { transform: rotateX(180deg); }
.ae-root .ae-flip-flip.ae-flip-down:is(:hover, :focus-within) .ae-flip-inner { transform: rotateX(-180deg); }
.ae-root .ae-flip-slide, .ae-root .ae-flip-fade { overflow: hidden; }
.ae-root .ae-flip-slide .ae-flip-inner, .ae-root .ae-flip-fade .ae-flip-inner { transform-style: flat; }
.ae-root .ae-flip-slide .ae-flip-back, .ae-root .ae-flip-fade .ae-flip-back { transition: transform 0.5s ease, opacity 0.5s ease; }
.ae-root .ae-flip-slide.ae-flip-left .ae-flip-back { transform: translateX(100%); }
.ae-root .ae-flip-slide.ae-flip-right .ae-flip-back { transform: translateX(-100%); }
.ae-root .ae-flip-slide.ae-flip-up .ae-flip-back { transform: translateY(100%); }
.ae-root .ae-flip-slide.ae-flip-down .ae-flip-back { transform: translateY(-100%); }
.ae-root .ae-flip-fade .ae-flip-back { opacity: 0; }
.ae-root .ae-flip-slide:is(:hover, :focus-within) .ae-flip-back { transform: none; }
.ae-root .ae-flip-fade:is(:hover, :focus-within) .ae-flip-back { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .ae-root .ae-flip-inner, .ae-root .ae-flip-back { transition: none; } }
.ae-root .ae-toc { padding: 18px 20px; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; }
.ae-root .ae-toc-head { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.ae-root .ae-toc-head[aria-expanded="true"] .ae-icon-svg { transform: rotate(180deg); }
.ae-root .ae-toc-title { margin: 0; font-weight: 700; }
.ae-root .ae-toc-list { margin: 10px 0 0; padding-left: 1.2em; display: flex; flex-direction: column; gap: 6px; }
.ae-root .ae-toc-none { list-style: none; padding-left: 0; }
.ae-root .ae-toc-list a { color: var(--ae-link-color); text-decoration: none; }
.ae-root .ae-toc-list a:hover { color: var(--ae-link-hover); text-decoration: underline; }
.ae-root .ae-toc-empty { margin: 8px 0 0; font-size: 0.9em; opacity: 0.7; }
.ae-root .ae-map, .ae-root .ae-html { position: relative; width: 100%; height: 360px; }
.ae-root .ae-map iframe, .ae-root .ae-html iframe { display: block; width: 100%; height: 100%; border: 0; border-radius: var(--ae-image-radius); }
.ae-root .ae-html { height: auto; min-height: 60px; }
.ae-root .ae-html iframe { height: var(--ae-html-height, 300px); }
.ae-root .ae-embed-shield { position: absolute; inset: 0; }
.ae-root .ae-form { display: flex; flex-direction: column; gap: 16px; }
.ae-root .ae-form-fields { display: flex; flex-wrap: wrap; gap: 16px; }
.ae-root .ae-form-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin: 0; padding: 0; border: 0; }
.ae-root .ae-form-w100 { flex: 1 1 100%; }
.ae-root .ae-form-w50 { flex: 1 1 calc(50% - 8px); }
.ae-root .ae-form-w33 { flex: 1 1 calc(33.333% - 11px); }
.ae-root .ae-form-label { font-weight: 600; font-size: 0.95em; }
.ae-root .ae-form-required { color: #a32d2d; }
.ae-root .ae-form-input { width: 100%; min-height: 44px; padding: 10px 12px; font: inherit; color: var(--ae-field-text); background: var(--ae-field-bg); border: 1px solid var(--ae-field-border); border-radius: var(--ae-field-radius); }
.ae-root textarea.ae-form-input { min-height: 120px; resize: vertical; }
.ae-root .ae-form-input:focus-visible { outline: 2px solid var(--ae-color-primary); outline-offset: 1px; }
.ae-root .ae-form-input[aria-invalid="true"] { border-color: #a32d2d; }
.ae-root .ae-form-choice { display: flex; align-items: flex-start; gap: 8px; }
.ae-root .ae-form-choice input { margin-top: 0.25em; }
.ae-root .ae-form-help { margin: 0; font-size: 0.85em; opacity: 0.75; }
.ae-root .ae-form-error { margin: 0; font-size: 0.85em; color: #a32d2d; }
.ae-root .ae-form-message { margin: 0; font-size: 0.9em; opacity: 0.8; }
.ae-root .ae-form-message-error { color: #a32d2d; opacity: 1; }
.ae-root .ae-form-submit { align-self: flex-start; }
.ae-root .ae-form-submit[disabled] { opacity: 0.7; cursor: progress; }
.ae-root .ae-form-trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.ae-root .ae-form-sent p { margin: 0; padding: 16px; border-radius: 8px; background: #e1f2e9; color: #0f4a2e; font-weight: 600; }
@media (max-width: 767px) { .ae-root .ae-form-w50, .ae-root .ae-form-w33 { flex-basis: 100%; } }
@media (max-width: 767px) { .ae-root .ae-box-left, .ae-root .ae-box-right, .ae-root .ae-testimonial-image-left, .ae-root .ae-tabs-vertical { flex-direction: column; } .ae-root .ae-box-left .ae-box-image, .ae-root .ae-box-right .ae-box-image { width: 100%; } .ae-root .ae-tabs-vertical .ae-tabs-list { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid rgba(0,0,0,0.12); } }
`.trim();

const alignHook: WidgetCssHook = (sheet, selector, props) => {
  sheet.responsive(selector, props["align"] as never, (value: string) => [["text-align", value]]);
};

const hooks: Record<string, WidgetCssHook> = {
  icon: (sheet, selector, props) => {
    sheet.responsive(selector, props["align"] as never, (value: string) => [["text-align", value]]);
    sheet.responsive(selector, props["size"] as never, (value: Size) => [["font-size", sizeToCss(value) ?? "48px"]]);
    const main = color(props["color"]);
    const second = color(props["secondary"]);
    const shape = `${selector} .ae-icon-shape`;
    if (props["view"] === "stacked") {
      sheet.add("base", shape, "background", main);
      sheet.add("base", shape, "color", second);
    } else {
      sheet.add("base", shape, "color", main);
      if (props["view"] === "framed") sheet.add("base", shape, "background", second);
    }
    if (typeof props["rotate"] === "number" && props["rotate"] !== 0) sheet.add("base", `${shape} .ae-icon-svg`, "transform", `rotate(${props["rotate"]}deg)`);
  },
  "icon-box": (sheet, selector, props) => {
    alignHook(sheet, selector, props, undefined as never);
    sheet.responsive(selector, props["align"] as never, (value: string) => [["align-items", props["position"] === "top" || !props["position"] ? justify(value) : "flex-start"]]);
    sheet.add("base", `${selector} .ae-box-icon`, "color", color(props["iconColor"]));
    sheet.add("base", `${selector} .ae-box-icon`, "font-size", size(props["iconSize"]));
  },
  "image-box": (sheet, selector, props) => {
    alignHook(sheet, selector, props, undefined as never);
    sheet.add("base", `${selector} .ae-box-image`, "width", size(props["imageWidth"]));
  },
  "icon-list": (sheet, selector, props) => {
    sheet.add("base", `${selector} .ae-icon-list-icon`, "color", color(props["iconColor"]));
    sheet.add("base", selector, "gap", size(props["gap"]));
  },
  testimonial: alignHook,
  counter: (sheet, selector, props) => {
    sheet.responsive(selector, props["align"] as never, (value: string) => [["text-align", value], ["align-items", justify(value)]]);
  },
  blockquote: alignHook,
  cta: (sheet, selector, props) => {
    sheet.responsive(`${selector} .ae-cta-body`, props["align"] as never, (value: string) => [["text-align", value], ["align-items", justify(value)]]);
    sheet.add("base", selector, "min-height", size(props["minHeight"]));
  },
  "star-rating": (sheet, selector, props) => {
    sheet.responsive(selector, props["align"] as never, (value: string) => [["justify-content", justify(value)]]);
    sheet.add("base", `${selector} .ae-stars-filled`, "color", color(props["color"]));
    sheet.add("base", `${selector} .ae-stars`, "color", color(props["emptyColor"]));
    sheet.add("base", `${selector} .ae-stars`, "font-size", size(props["size"]));
  },
  progress: (sheet, selector, props) => {
    sheet.add("base", `${selector} .ae-progress-bar`, "background", color(props["color"]));
    sheet.add("base", `${selector} .ae-progress-track`, "background", color(props["trackColor"]));
    sheet.add("base", `${selector} .ae-progress-track`, "height", size(props["height"]));
  },
  "social-icons": (sheet, selector, props) => {
    sheet.responsive(selector, props["align"] as never, (value: string) => [["justify-content", justify(value)]]);
    sheet.add("base", `${selector} .ae-social-link`, "font-size", size(props["size"]));
    sheet.add("base", selector, "gap", size(props["gap"]));
    if (props["colors"] === "custom") {
      sheet.add("base", `${selector} .ae-social-link`, "background", color(props["color"]) ?? "var(--ae-color-primary)");
      sheet.add("base", `${selector} .ae-social-link`, "color", color(props["iconColor"]) ?? "#ffffff");
    }
  },
  gallery: (sheet, selector, props) => {
    sheet.responsive(`${selector} .ae-gallery-grid`, props["columns"] as never, (value: number) => [["grid-template-columns", `repeat(${Math.max(1, Math.min(8, Math.round(value)))}, minmax(0, 1fr))`]]);
    sheet.add("base", `${selector} .ae-gallery-grid`, "gap", size(props["gap"]));
  },
  carousel: (sheet, selector, props) => {
    sheet.responsive(selector, props["perView"] as never, (value: number) => [["--ae-per-view", String(Math.max(1, Math.min(6, Math.round(value))))]]);
    sheet.add("base", selector, "--ae-gap", size(props["gap"]));
  },
  map: (sheet, selector, props) => {
    sheet.responsive(selector, props["height"] as never, (value: Size) => [["height", sizeToCss(value) ?? "360px"]]);
  },
  html: (sheet, selector, props) => {
    sheet.responsive(selector, props["height"] as never, (value: Size) => [["--ae-html-height", sizeToCss(value) ?? "300px"]]);
  },
  "flip-box": (sheet, selector, props) => {
    sheet.responsive(selector, props["height"] as never, (value: Size) => [["height", sizeToCss(value) ?? "300px"]]);
    sheet.add("base", `${selector} .ae-flip-front`, "background", color(props["frontColor"]));
    sheet.add("base", `${selector} .ae-flip-back`, "background", color(props["backColor"]));
  },
};

let registered = false;
/**
 * Adds the library's base CSS and its per-widget CSS hooks to the generator. Called by
 * `createArmatureKit` (through library/index.ts), never at import, so a bundler that
 * trusts the site's `"sideEffects": false` cannot drop the widgets' styles. Calling it
 * again does nothing.
 */
export function registerLibraryCss(): void {
  if (registered) return;
  registered = true;
  registerBaseCss(BASE);
  registerBaseCss((kit) => `@media (max-width: ${kit.breakpoints.mobile}px) { .ae-root .ae-bg-video-nomobile { display: none; } }`);
  for (const [type, hook] of Object.entries(hooks)) registerWidgetCss(type, hook);
  registerWidgetCss("site-logo", siteLogoCss);
  registerWidgetCss("nav-menu", navMenuCss);
}
