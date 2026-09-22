/**
 * Pieces the widget library shares: plain-text paragraphs, a title with a chosen tag, a
 * picture, the in-view and reduced-motion hooks, and the lightbox (a native <dialog>, so
 * the browser handles focus, Esc and the top layer).
 */
import { createElement, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { safeMediaSrc } from "../sanitize.ts";
import type { GalleryImage, TitleTag } from "../types.ts";

/** Plain text with blank lines as paragraphs and single newlines as line breaks. */
export function Paragraphs({ text, className }: { text: string | undefined; className?: string }) {
  if (!text) return null;
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim() !== "");
  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <p key={index}>
          {block.split("\n").map((line, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

const TITLE_TAGS = new Set(["h2", "h3", "h4", "h5", "h6", "p", "div"]);
export function Title({ tag, className, children }: { tag: TitleTag | undefined; className: string; children: ReactNode }) {
  return createElement(tag && TITLE_TAGS.has(tag) ? tag : "h3", { className }, children);
}

export function Picture({ src, alt, className, eager }: { src: string | undefined; alt?: string; className?: string; eager?: boolean }) {
  const safe = safeMediaSrc(src);
  if (!safe) return null;
  return <img src={safe} alt={alt ?? ""} className={className} loading={eager ? "eager" : "lazy"} decoding="async" />;
}

const reducedQuery = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (listener: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(reducedQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
/** True when the visitor asks for reduced motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => (typeof window !== "undefined" && !!window.matchMedia?.(reducedQuery).matches), () => false);
}

/** True once the element has scrolled into view (and stays true). */
export function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  // Without IntersectionObserver (very old browsers) everything counts as seen.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver !== "function");
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** Pictures opened larger, one at a time, with previous/next and Esc. */
export function Lightbox({ images, index, onClose, onIndex }: { images: GalleryImage[]; index: number | null; onClose: () => void; onIndex: (index: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (index !== null && !node.open) node.showModal?.();
    if (index === null && node.open) node.close();
  }, [index]);
  const current = index !== null ? images[index] : undefined;
  const count = images.length;
  const step = (delta: number) => index !== null && count > 0 && onIndex((index + delta + count) % count);
  return (
    <dialog
      ref={dialog}
      className="ae-lightbox"
      aria-label="Picture"
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && onClose()}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") step(1);
        if (event.key === "ArrowLeft") step(-1);
      }}
    >
      {current ? (
        <figure className="ae-lightbox-figure">
          <Picture src={current.src} alt={current.alt} className="ae-lightbox-img" eager />
          {current.caption ? <figcaption>{current.caption}</figcaption> : null}
        </figure>
      ) : null}
      <button type="button" className="ae-lightbox-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {count > 1 ? (
        <>
          <button type="button" className="ae-lightbox-prev" aria-label="Previous picture" onClick={() => step(-1)}>
            ‹
          </button>
          <button type="button" className="ae-lightbox-next" aria-label="Next picture" onClick={() => step(1)}>
            ›
          </button>
          <span className="ae-lightbox-count" aria-live="polite">
            {(index ?? 0) + 1} / {count}
          </span>
        </>
      ) : null}
    </dialog>
  );
}

/** Numbers as the visitor's locale writes them. */
export const formatNumber = (value: number, decimals: number, separator: boolean) =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: separator }).format(value);
