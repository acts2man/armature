/**
 * Types shared by every part of the code engine: the preview runner, the AST engine,
 * the HTTP server, the in-page bridge and the editor. Plain data only.
 *
 * The engine edits a React site's real source. A DOM element in the preview carries the
 * source location of the JSX that rendered it (`data-ae`), the usage site of the
 * component it came from when the component forwards its props (`data-ae-p`), the index
 * inside a `.map` callback (`data-ae-i`) and the component name (`data-ae-c`). Together
 * they make a NodeRef, which is all the server needs to find the JSX again.
 */

export type Device = "desktop" | "tablet" | "phone";

/** A position in a source file. `file` is repo-relative with forward slashes; line is 1-based, col 0-based. */
export type Loc = { file: string; line: number; col: number };

export type NodeRef = {
  /** The JSX element that rendered this DOM element (data-ae), or null when only a usage tag is known. */
  loc: Loc | null;
  /** The component usage that rendered it, when the component forwards its props (data-ae-p). */
  usage: Loc | null;
  /** Indices from `.map` callbacks, outermost first (the element's own data-ae-i and its tagged ancestors'). */
  indices: number[];
  /** Source locations of the tagged DOM ancestors, nearest first. */
  ancestors: Loc[];
  /** The React component the JSX lives in (data-ae-c). */
  component: string | null;
  /** Lower-case tag name. */
  tag: string;
};

/** Why something cannot be edited, in plain English. */
export type Reason = {
  kind: "live-data" | "code" | "prop" | "unsupported";
  message: string;
};

export type TextSource =
  | {
      editable: true;
      /** The current text in the source. */
      value: string;
      /** Where the text lives: literal JSX children, or a string literal (possibly in another file). */
      where: Loc;
      kind: "jsx" | "literal";
      /** True when formatting (bold, italic, links) can be written back as JSX. */
      rich: boolean;
      /** The literal is part of a data object or array (a list rendered with .map, a defaults table). */
      inData?: string;
      /** Set when the site can also load this text from a database at runtime. */
      dbNote?: string;
    }
  | { editable: false; reason: Reason; value?: string };

export type ImageSource =
  | {
      editable: true;
      src: string;
      alt: string | null;
      where: Loc;
      /** "public": a path under public/. "import": an imported asset file. */
      pattern: "public" | "import";
      altEditable: boolean;
      /** Where the alt text literal lives, when it is a literal somewhere. */
      altWhere?: Loc | null;
      dbNote?: string;
    }
  | { editable: false; reason: Reason; src?: string; alt?: string | null };

export type ClassSource =
  | { editable: true; className: string; where: Loc; /** The className is a plain string literal (dynamic parts are kept). */ literal: boolean }
  | { editable: false; reason: Reason; className?: string };

export type LinkSource = { editable: true; href: string; where: Loc } | { editable: false; reason: Reason; href?: string };

export type StructureInfo = {
  /** The element can be moved, deleted and duplicated (it is a plain JSX element among siblings). */
  editable: boolean;
  reason?: Reason;
  /** The JSX parent element, when it is a JSX element (not a fragment or a function body). */
  parent: Loc | null;
  /** Position among the parent's JSX element children. */
  index: number;
  siblingCount: number;
  /** New elements can be inserted inside (it has literal JSX children or is empty). */
  canReceiveChildren: boolean;
};

export type NodeKind = "container" | "heading" | "text" | "image" | "button" | "link" | "list" | "item" | "other";

export type ResolvedNode = {
  ref: NodeRef;
  label: string;
  kind: NodeKind;
  component: string | null;
  file: string;
  /** Set when the element belongs to a component used from several places. */
  shared: { component: string; usedIn: string[] } | null;
  text: TextSource | null;
  image: ImageSource | null;
  link: LinkSource | null;
  classes: ClassSource;
  structure: StructureInfo;
  /** A note about the children: a list rendered from live data, for example. */
  childrenNote: Reason | null;
  /** True when Tailwind is active on the site (classes take effect); false means the plain-CSS fallback is used. */
  tailwind: boolean;
};

/** A run of rich text, as the bridge serialises a contenteditable element. */
export type RichRun = { text: string; bold?: boolean; italic?: boolean; href?: string; br?: boolean };

export type InsertKind = "heading" | "text" | "image" | "button" | "container" | "row";

/** CSS declarations the Style tab asks for, e.g. { "padding-top": "23px" }. */
export type Declarations = Record<string, string>;

export type EditOp =
  | { op: "text"; target: NodeRef; value: string }
  | { op: "richText"; target: NodeRef; runs: RichRun[] }
  | { op: "style"; target: NodeRef; device: Device; declarations: Declarations }
  | { op: "className"; target: NodeRef; className: string }
  | { op: "image"; target: NodeRef; src?: string; alt?: string; upload?: { name: string; base64: string } }
  | { op: "link"; target: NodeRef; href: string }
  | { op: "move"; target: NodeRef; parent: NodeRef; index: number }
  | { op: "delete"; target: NodeRef }
  | { op: "duplicate"; target: NodeRef }
  | { op: "insert"; parent: NodeRef; index: number; kind: InsertKind };

export type HistoryState = { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null; length: number };

export type EditResult =
  | { ok: true; label: string; changed: string[]; /** Where the edited (or inserted) element now lives, to keep it selected. */ select?: Loc | null; history: HistoryState }
  | { ok: false; message: string };

export type ChangedFile = { path: string; status: "modified" | "added" | "deleted"; additions: number; deletions: number; binary: boolean };

export type PageInfo = {
  path: string;
  label: string;
  file: string;
  /** The page component file, when the route imports one. */
  component: string | null;
  private: boolean;
  /** Tailwind is loaded on this page (by the root layout or by the route's own stylesheet). */
  tailwind: boolean;
};

export type SiteTheme = {
  /** Where the theme came from. */
  source: "tailwind-config" | "css-theme" | "css-variables" | "none";
  breakpoints: { tablet: number; desktop: number };
  colors: { name: string; value: string }[];
  fonts: { name: string; value: string }[];
};

export type PreviewStatus =
  | { phase: "idle" }
  | { phase: "cloning" | "installing" | "starting"; message: string; startedAt: number }
  | { phase: "ready"; url: string; timings: Timings }
  | { phase: "error"; message: string; missingEnv?: string[]; timings?: Timings };

export type Timings = { cloneMs: number; installMs: number; startMs: number; totalMs: number; /** Dependencies were reused from the cache. */ cachedInstall: boolean; /** The clone was reused (fetch + reset). */ cachedClone: boolean };

export type SiteInfo = {
  framework: "vite-react" | "tanstack-start" | "unknown";
  packageManager: "bun" | "npm" | "pnpm" | "yarn";
  tailwind: boolean;
  /** The stylesheet the plain-CSS fallback writes into. */
  stylesheet: string | null;
  pages: PageInfo[];
  theme: SiteTheme;
  env: { required: string[]; missing: string[] };
  headCommit: string;
};

export type OpenResponse = { ok: true; status: PreviewStatus; site: SiteInfo | null } | { ok: false; message: string; missingEnv?: string[] };

export type PublishRequest = { message: string; /** "mine" keeps the editor's version of a conflicting file; "theirs" drops it. */ resolutions?: Record<string, "mine" | "theirs"> };

export type PublishResult =
  | { ok: true; commitSha: string; commitUrl: string; files: string[]; diff: string; rebased: string[] }
  | { ok: false; code: "conflict" | "nothing" | "github_error"; message: string; conflicts?: { path: string; message: string }[] };
