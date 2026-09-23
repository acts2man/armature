/**
 * A regression fixture for the CSS-leak guarantee: a hand-coded site section, registered
 * with the kit, rendered twice on one page — once bare (no `.ae-root`, no kit CSS) and once
 * the way the builder renders it (inside `.ae-root`, wrapped in `.ae-site-section`, with the
 * full kit stylesheet applied). The section leans entirely on browser defaults: a bordered
 * content-box `::before` circle (the exact case that shrank from 30px to 26px when the kit's
 * box-sizing reset leaked in), default heading/paragraph margins, and a default ordered list.
 * None of it sets `box-sizing`. The Playwright test screenshots both renderings and asserts
 * they are pixel-identical, so builder CSS can never again change how a site section renders.
 *
 * This page is only reachable at /section-parity and is not part of the real demo site.
 */
import { ArmaturePage } from "../../../kit/index.ts";
import type { LayoutDoc } from "../../../kit/index.ts";
import { armature } from "./armature.ts";

function ParitySection() {
  return (
    <section className="parity">
      <h3 className="parity-title">How it works</h3>
      <p className="parity-lead">Three steps, then we build.</p>
      <ul className="parity-steps">
        <li className="parity-step">We meet and map the site.</li>
        <li className="parity-step">We draw the plan together.</li>
        <li className="parity-step">We build it out for real.</li>
      </ul>
      <ol className="parity-notes">
        <li>First footnote, default list marker.</li>
        <li>Second footnote, default padding.</li>
      </ol>
    </section>
  );
}

armature.registerSiteSection("parity", { label: "Parity", component: ParitySection });

/** A one-element layout whose only element is the registered `parity` section. */
const parityLayout: LayoutDoc = {
  version: 1,
  pageSlug: "parity",
  path: "/section-parity",
  root: [
    {
      id: "parity01",
      type: "site-section",
      props: { key: "parity" },
      style: {},
      advanced: {},
      meta: { createdBy: "test", updatedAt: "2026-09-22T00:00:00.000Z" },
    },
  ],
};

export function SectionParity() {
  return (
    <div className="parity-harness">
      {/* The section's own CSS: loaded once, applied in both contexts. It sets no
          box-sizing anywhere, so the bordered circle relies on the browser default
          (content-box). If the kit's reset leaks in, the wrapped copy shrinks.

          The two copies are stacked at the exact same absolute coordinate so the
          Playwright test can screenshot each (with the other hidden) at pixel-identical
          positions — same sub-pixel alignment, so any difference is a real CSS leak, not
          antialiasing jitter from a different x-offset. */}
      <style>{`
        .parity-harness { position: relative; width: 460px; height: 320px; background: #ffffff; }
        .parity-cell { position: absolute; top: 0; left: 0; }
        .parity { width: 420px; background: #ffffff; color: #1f2933; font-family: Georgia, "Times New Roman", serif; }
        .parity-title { color: #8a4b00; }
        .parity-steps { list-style: none; margin: 16px 0; padding: 0; }
        .parity-step { position: relative; padding-left: 44px; margin-bottom: 14px; line-height: 1.4; }
        .parity-step::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          width: 26px;
          height: 26px;
          border: 2px solid #8a4b00;
          border-radius: 50%;
        }
      `}</style>
      <div id="parity-bare" className="parity-cell" data-testid="parity-bare">
        <ParitySection />
      </div>
      <div id="parity-wrapped" className="parity-cell" data-testid="parity-wrapped">
        <ArmaturePage slug="parity" layout={parityLayout} />
      </div>
    </div>
  );
}
