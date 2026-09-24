import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Project } from "../ast/project.ts";
import { EngineSession, type SiteStyle } from "../ast/session.ts";
import { applyDeclarations, declarationToClass, groupOf } from "../ast/tailwind.ts";
import { applyCssRule, detectBreakpoints } from "../ast/css.ts";
import { collapseJsxText } from "../ast/resolve.ts";
import { indexSiteCss, siteCssSets } from "../ast/sitecss.ts";
import type { Loc, NodeRef } from "../shared/types.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const temps: string[] = [];

function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `armature-engine-${name}-`));
  cpSync(join(fixtures, name), dir, { recursive: true });
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tailwindStyle: SiteStyle = { tailwind: true, tailwindVersion: 4, stylesheet: "src/index.css", breakpoints: { tablet: 768, desktop: 1024 }, colors: { primary: "#1d3770", accent: "#349e49" } };
const plainStyle: SiteStyle = { tailwind: false, tailwindVersion: 4, stylesheet: "src/styles/globals.css", breakpoints: { tablet: 768, desktop: 1024 }, colors: {} };

/** A NodeRef for the JSX element whose opening tag is the first match of `needle` in the file. */
function refTo(project: Project, file: string, needle: string, extra: Partial<NodeRef> = {}): NodeRef {
  const loc = locOf(project, file, needle);
  const tag = /^<([a-zA-Z0-9.]+)/.exec(needle)?.[1] ?? "div";
  return { loc, usage: null, indices: [], ancestors: [], component: null, tag: tag.toLowerCase(), ...extra };
}

function locOf(project: Project, file: string, needle: string, occurrence = 0): Loc {
  const code = project.read(file);
  if (code === null) throw new Error(`${file} missing`);
  let at = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    at = code.indexOf(needle, at + 1);
    if (at === -1) throw new Error(`${needle} not in ${file}`);
  }
  const before = code.slice(0, at);
  const line = before.split("\n").length;
  const col = at - (before.lastIndexOf("\n") + 1);
  return { file, line, col };
}

describe("tracing on a Lovable-style Vite + Tailwind site", () => {
  it("edits literal JSX text in place and keeps formatting", () => {
    const project = new Project(copyFixture("lovable-site"));
    const session = new EngineSession(project, tailwindStyle, "src/pages/Index.tsx");
    const ref = refTo(project, "src/pages/Index.tsx", "<h1", { tag: "h1" });
    const node = session.resolve(ref);
    expect(node.kind).toBe("heading");
    expect(node.text).toMatchObject({ editable: true, kind: "jsx", rich: true, value: "Welcome to Fixture" });
    expect(node.structure.editable).toBe(true);
    const result = session.apply({ op: "richText", target: ref, runs: [{ text: "Hello " }, { text: "world", bold: true }, { text: ", see " }, { text: "docs", href: "/docs" }] });
    expect(result.ok).toBe(true);
    const code = project.read("src/pages/Index.tsx") ?? "";
    expect(code).toContain('<h1 className="text-4xl font-bold md:text-6xl">Hello <strong>world</strong>, see <a href="/docs">docs</a></h1>');
    // Untouched lines are byte-identical.
    expect(code).toContain('<p className="mt-4 text-lg text-gray-600">{tagline}</p>');
    expect(code.split("\n")[0]).toBe('import heroImage from "@/assets/hero.png";');
  });

  it("follows a const to its literal, refuses computed text with a plain reason", () => {
    const project = new Project(copyFixture("lovable-site"));
    const session = new EngineSession(project, tailwindStyle);
    const paragraph = session.resolve(refTo(project, "src/pages/Index.tsx", '<p className="mt-4', { tag: "p" }));
    expect(paragraph.text).toMatchObject({ editable: true, kind: "literal", value: "Built for small teams" });
    session.apply({ op: "text", target: refTo(project, "src/pages/Index.tsx", '<p className="mt-4', { tag: "p" }), value: "Built for you" });
    expect(project.read("src/pages/Index.tsx")).toContain('const tagline = "Built for you";');
    const computed = session.resolve(refTo(project, "src/pages/Index.tsx", '<p className="px-6">{tagline.toUpperCase', { tag: "p" }));
    expect(computed.text).toMatchObject({ editable: false });
    expect((computed.text as { reason: { message: string } }).reason.message).toMatch(/changed by code/);
  });

  it("edits an item of a literal array rendered with .map, by index", () => {
    const project = new Project(copyFixture("lovable-site"));
    const session = new EngineSession(project, tailwindStyle);
    const ref = refTo(project, "src/pages/Index.tsx", '<h2 className="text-xl', { tag: "h2", indices: [1] });
    const node = session.resolve(ref);
    expect(node.text).toMatchObject({ editable: true, kind: "literal", value: "Simple", inData: "features" });
    expect(node.structure.editable).toBe(false);
    expect(node.structure.reason?.message).toMatch(/one item of a list/);
    session.apply({ op: "text", target: ref, value: "Easy" });
    expect(project.read("src/pages/Index.tsx")).toContain('{ title: "Easy", body: "Nothing to learn." }');
  });

  it("reads a shadcn Button's words from the usage that rendered it", () => {
    const project = new Project(copyFixture("lovable-site"));
    const session = new EngineSession(project, tailwindStyle, "src/pages/Index.tsx");
    const ref: NodeRef = { loc: locOf(project, "src/components/ui/button.tsx", "<button"), usage: locOf(project, "src/pages/Index.tsx", "<Button"), indices: [], ancestors: [], component: "Button", tag: "button" };
    const node = session.resolve(ref);
    expect(node.label).toBe("Button");
    expect(node.text).toMatchObject({ editable: true, kind: "jsx", value: "Get started" });
    expect(node.classes).toMatchObject({ editable: true, className: "mt-6" });
    session.apply({ op: "text", target: ref, value: "Start now" });
    expect(project.read("src/pages/Index.tsx")).toContain('<Button className="mt-6">Start now</Button>');
    expect(project.read("src/components/ui/button.tsx")).toContain("{...props}");
  });

  it("names live data and shared components instead of failing", () => {
    const project = new Project(copyFixture("lovable-site"));
    const session = new EngineSession(project, tailwindStyle, "src/pages/Index.tsx");
    const item = session.resolve(refTo(project, "src/pages/Index.tsx", "<li key={item.name}", { tag: "li", indices: [0] }));
    expect(item.text).toMatchObject({ editable: false, reason: { kind: "live-data" } });
    const list = session.resolve(refTo(project, "src/pages/Index.tsx", '<ul className="px-6"', { tag: "ul" }));
    expect(list.childrenNote?.kind).toBe("live-data");
    const header = session.resolve(refTo(project, "src/components/Header.tsx", "<header", { tag: "header", component: "Header" }));
    expect(header.shared).toMatchObject({ component: "Header" });
    expect(header.shared?.usedIn).toEqual(["src/pages/About.tsx", "src/pages/Index.tsx"]);
    const nav = session.resolve(refTo(project, "src/components/Header.tsx", "<Link key", { tag: "a", indices: [1] }));
    expect(nav.text).toMatchObject({ editable: true, value: "About", inData: "links" });
  });

  it("swaps a picture following the site's import pattern and public/ pattern", () => {
    const project = new Project(copyFixture("lovable-site"));
    const session = new EngineSession(project, tailwindStyle);
    const imported = refTo(project, "src/pages/Index.tsx", "<img src={heroImage}", { tag: "img" });
    const node = session.resolve(imported);
    expect(node.image).toMatchObject({ editable: true, pattern: "import", src: "@/assets/hero.png", alt: "A hero" });
    const result = session.apply({ op: "image", target: imported, upload: { name: "New Photo.PNG", base64: Buffer.from("png-bytes").toString("base64") }, alt: "New hero" });
    expect(result.ok).toBe(true);
    expect(project.exists("src/assets/new-photo.png")).toBe(true);
    const code = project.read("src/pages/Index.tsx") ?? "";
    expect(code).toContain('import heroImage from "@/assets/new-photo.png";');
    expect(code).toContain('alt="New hero"');
    const publicRef = refTo(project, "src/pages/Index.tsx", '<img src="/images/photo.jpg"', { tag: "img" });
    session.apply({ op: "image", target: publicRef, upload: { name: "photo.jpg", base64: Buffer.from("jpg").toString("base64") } });
    expect(project.exists("public/images/photo-2.jpg")).toBe(true);
    expect(project.read("src/pages/Index.tsx")).toContain('<img src="/images/photo-2.jpg" alt="A photo" />');
  });

  it("writes styles as Tailwind classes per device and merges conflicts", () => {
    const project = new Project(copyFixture("lovable-site"));
    const session = new EngineSession(project, tailwindStyle);
    const hero = () => refTo(project, "src/pages/Index.tsx", '<section className="hero-title', { tag: "section" });
    session.apply({ op: "style", target: hero(), device: "desktop", declarations: { "padding-top": "23px" } });
    expect(project.read("src/pages/Index.tsx")).toContain('className="hero-title px-6 py-16 md:py-24 lg:pt-[23px]"');
    session.apply({ op: "style", target: hero(), device: "phone", declarations: { "padding-left": "32px", "padding-right": "32px" } });
    // px-6 covered the phone value; it is replaced and carried to md: so tablet and desktop keep 24px.
    expect(project.read("src/pages/Index.tsx")).toContain('className="hero-title py-16 md:py-24 lg:pt-[23px] px-8 md:px-6"');
    const heading = () => refTo(project, "src/pages/Index.tsx", "<h1", { tag: "h1" });
    session.apply({ op: "style", target: heading(), device: "phone", declarations: { "font-size": "30px" } });
    expect(project.read("src/pages/Index.tsx")).toContain('className="font-bold md:text-6xl text-3xl"');
    session.apply({ op: "style", target: heading(), device: "tablet", declarations: { color: "#1d3770" } });
    expect(project.read("src/pages/Index.tsx")).toContain("md:max-lg:text-primary");
    // cn() calls keep their dynamic parts.
    const button = refTo(project, "src/components/ui/button.tsx", "<button", { tag: "button" });
    session.apply({ op: "style", target: button, device: "desktop", declarations: { "border-radius": "12px" } });
    expect(project.read("src/components/ui/button.tsx")).toContain('className={cn("inline-flex items-center rounded-md px-4 py-2 text-sm font-medium lg:rounded-xl", variant === "outline" && "border", className)}');
  });

  it("adds the important modifier when the site's own CSS sets the same property", () => {
    const project = new Project(copyFixture("lovable-site"));
    const index = indexSiteCss(project);
    expect(siteCssSets(index, ["hero-title"], "letter-spacing")).toBe(true);
    expect(siteCssSets(index, ["hero-title"], "padding-top")).toBe(false);
    const session = new EngineSession(project, tailwindStyle);
    session.apply({ op: "style", target: refTo(project, "src/pages/Index.tsx", '<section className="hero-title', { tag: "section" }), device: "desktop", declarations: { "letter-spacing": "0.1em" } });
    expect(project.read("src/pages/Index.tsx")).toContain("lg:tracking-[0.1em]!");
  });

  it("reorders, moves, duplicates, deletes and inserts with clean JSX and reports the new location", () => {
    const project = new Project(copyFixture("lovable-site"));
    const session = new EngineSession(project, tailwindStyle);
    const file = "src/pages/Index.tsx";
    const paragraph = refTo(project, file, '<p className="mt-4', { tag: "p" });
    const hero = refTo(project, file, '<section className="hero-title', { tag: "section" });
    const moved = session.apply({ op: "move", target: paragraph, parent: hero, index: 0 });
    expect(moved.ok).toBe(true);
    let code = project.read(file) ?? "";
    expect(code.indexOf('<p className="mt-4')).toBeLessThan(code.indexOf("<h1"));
    // The moved element takes the indentation of its new siblings.
    expect(code).toContain('\n        <p className="mt-4 text-lg text-gray-600">{tagline}</p>\n        <h1');
    expect(moved.ok && moved.select).toEqual(locOf(project, file, '<p className="mt-4'));
    const inserted = session.apply({ op: "insert", parent: refTo(project, file, '<section className="hero-title', { tag: "section" }), index: 1, kind: "heading" });
    expect(inserted.ok).toBe(true);
    code = project.read(file) ?? "";
    expect(code).toContain('<h2 className="text-3xl font-bold">New heading</h2>');
    expect(inserted.ok && inserted.select).toEqual(locOf(project, file, "<h2 className=\"text-3xl font-bold\">New heading"));
    const duplicated = session.apply({ op: "duplicate", target: refTo(project, file, '<a href="/about"', { tag: "a" }) });
    expect(duplicated.ok).toBe(true);
    code = project.read(file) ?? "";
    expect(code.match(/<a href="\/about" className="button mt-2">Learn more<\/a>/g)).toHaveLength(2);
    const deleted = session.apply({ op: "delete", target: refTo(project, file, '<img src="/images/photo.jpg"', { tag: "img" }) });
    expect(deleted.ok).toBe(true);
    code = project.read(file) ?? "";
    expect(code).not.toContain("/images/photo.jpg");
    expect(code).not.toMatch(/\n\s*\n\s*<Button/);
    // Undo everything, in order, back to the original file.
    const original = new Project(copyFixture("lovable-site")).read(file);
    expect(session.history()).toMatchObject({ canUndo: true, length: 4 });
    session.undo();
    session.undo();
    session.undo();
    session.undo();
    expect(project.read(file)).toBe(original);
    session.redo();
    expect(project.read(file)).toContain("<h1");
    expect(session.history()).toMatchObject({ canUndo: true, canRedo: true });
    expect(session.apply({ op: "insert", parent: refTo(project, file, "<h1", { tag: "h1" }), index: 0, kind: "text" }).ok).toBe(true);
    expect(session.history().canRedo).toBe(false);
  });
});

describe("tracing on the real site's pattern (TanStack Start, usePageCopy, plain CSS)", () => {
  it("follows copy.text() through the hook to the defaults table and notes the database", () => {
    const project = new Project(copyFixture("copy-site"));
    const session = new EngineSession(project, plainStyle, "src/pages/Home.tsx");
    const heading = session.resolve(refTo(project, "src/pages/Home.tsx", '<h1 id="hero-title"', { tag: "h1" }));
    expect(heading.text).toMatchObject({ editable: true, kind: "literal", value: "Become An ISA Certified Arborist", inData: "PAGE_DEFAULTS" });
    expect(heading.text && heading.text.editable && heading.text.dbNote).toMatch(/database/);
    expect(heading.text && heading.text.editable && heading.text.where.file).toBe("src/lib/pageDefaults.ts");
    session.apply({ op: "text", target: refTo(project, "src/pages/Home.tsx", '<h1 id="hero-title"', { tag: "h1" }), value: "Become a Certified Arborist" });
    expect(project.read("src/lib/pageDefaults.ts")).toContain('title: "Become a Certified Arborist",');
    expect(project.read("src/pages/Home.tsx")).toContain('<h1 id="hero-title">{copy.text("hero", "title")}</h1>');
  });

  it("reads a link's label through copy.link(), a list item through copy.list(), and a picture through copy.text()", () => {
    const project = new Project(copyFixture("copy-site"));
    const session = new EngineSession(project, plainStyle, "src/pages/Home.tsx");
    const cta = session.resolve({ loc: null, usage: locOf(project, "src/pages/Home.tsx", '<Link className="button hero-button"'), indices: [], ancestors: [], component: "Home", tag: "a" });
    expect(cta.text).toMatchObject({ editable: true, value: "Register for the course" });
    expect(cta.link).toMatchObject({ editable: true, href: "/class-registration-page/" });
    expect(cta.kind).toBe("button");
    const week = session.resolve(refTo(project, "src/pages/Home.tsx", "<li key={week.text}", { tag: "li", indices: [1] }));
    expect(week.text).toMatchObject({ editable: true, value: "Week 2: Soil Science" });
    const badge = session.resolve(refTo(project, "src/pages/Home.tsx", '<img className="credential"', { tag: "img" }));
    expect(badge.image).toMatchObject({ editable: true, src: "/assets/badge.webp", alt: "ISA badge", pattern: "public", altEditable: true });
    session.apply({ op: "image", target: refTo(project, "src/pages/Home.tsx", '<img className="credential"', { tag: "img" }), alt: "The ISA credential badge" });
    expect(project.read("src/lib/pageDefaults.ts")).toContain('badge_alt: "The ISA credential badge"');
    const schedule = session.resolve(refTo(project, "src/pages/Home.tsx", "<strong>{copy.text(\"hero\", \"schedule\")", { tag: "strong" }));
    expect(schedule.text).toMatchObject({ editable: false });
  });

  it("edits the header menu through a prop, a map and the shared defaults, and says it is shared", () => {
    const project = new Project(copyFixture("copy-site"));
    const session = new EngineSession(project, plainStyle, "src/pages/Home.tsx");
    const link: NodeRef = {
      loc: null,
      usage: locOf(project, "src/components/SiteChrome.tsx", "<Link to={item.href}"),
      indices: [1],
      ancestors: [locOf(project, "src/components/SiteChrome.tsx", '<nav className="nav-links"')],
      component: "NavLinks",
      tag: "a",
    };
    const node = session.resolve(link);
    expect(node.text).toMatchObject({ editable: true, value: "Course Overview", inData: "PAGE_DEFAULTS" });
    expect(node.shared).toMatchObject({ component: "NavLinks" });
    expect(node.link).toMatchObject({ editable: true, href: "/events/location/" });
    session.apply({ op: "text", target: link, value: "The Course" });
    expect(project.read("src/lib/pageDefaults.ts")).toContain('{ label: "The Course", href: "/events/location/" }');
    const footer = session.resolve(refTo(project, "src/components/SiteChrome.tsx", '<p>{copy.text("footer"', { tag: "p", component: "SiteFooter" }));
    expect(footer.text).toMatchObject({ editable: true, value: "© 2026 Tree Test Prep. All Rights Reserved." });
    expect(footer.shared?.usedIn).toEqual(["src/pages/Home.tsx", "src/pages/Instructors.tsx"]);
  });

  it("follows a prop into InnerHero from the page that used it", () => {
    const project = new Project(copyFixture("copy-site"));
    const session = new EngineSession(project, plainStyle, "src/pages/Instructors.tsx");
    const title = session.resolve({ loc: locOf(project, "src/components/SiteChrome.tsx", "<h1>{title}</h1>"), usage: null, indices: [], ancestors: [locOf(project, "src/pages/Instructors.tsx", "<main>")], component: "InnerHero", tag: "h1" });
    expect(title.text).toMatchObject({ editable: true, value: "Meet the instructors" });
  });

  it("reports the instructors list as live data", () => {
    const project = new Project(copyFixture("copy-site"));
    const session = new EngineSession(project, plainStyle, "src/pages/Instructors.tsx");
    const list = session.resolve(refTo(project, "src/pages/Instructors.tsx", '<div className="instructor-list"', { tag: "div" }));
    expect(list.childrenNote).toMatchObject({ kind: "live-data" });
    expect(list.childrenNote?.message).toMatch(/live data/);
    const name = session.resolve(refTo(project, "src/pages/Instructors.tsx", "<h2>{instructor.name}", { tag: "h2", indices: [0] }));
    expect(name.text).toMatchObject({ editable: false, reason: { kind: "live-data" } });
    const role = session.resolve(refTo(project, "src/pages/Instructors.tsx", '<p className="instructor-role"', { tag: "p", indices: [0] }));
    expect(role.text).toMatchObject({ editable: true, value: "Instructor" });
  });

  it("writes styles into the site's stylesheet when Tailwind is not active", () => {
    const project = new Project(copyFixture("copy-site"));
    const session = new EngineSession(project, plainStyle, "src/pages/Home.tsx");
    const hero = () => refTo(project, "src/pages/Home.tsx", '<div className="wrap hero-inner', { tag: "div" });
    const first = session.apply({ op: "style", target: hero(), device: "desktop", declarations: { "padding-top": "23px" } });
    expect(first.ok).toBe(true);
    const code = project.read("src/pages/Home.tsx") ?? "";
    const className = /className="wrap hero-inner (ae-[a-f0-9]{6})"/.exec(code)?.[1];
    expect(className).toBeTruthy();
    const css = project.read("src/styles/globals.css") ?? "";
    expect(css).toContain(`@media (min-width: 1024px) { .${className}.${className}.${className} { padding-top: 23px; } }`);
    session.apply({ op: "style", target: hero(), device: "desktop", declarations: { "padding-bottom": "40px" } });
    session.apply({ op: "style", target: refTo(project, "src/pages/Home.tsx", '<h1 id="hero-title"', { tag: "h1" }), device: "phone", declarations: { "font-size": "24px" } });
    const after = project.read("src/styles/globals.css") ?? "";
    expect(after).toContain(`{ padding-top: 23px; padding-bottom: 40px; } }`);
    expect(after).toMatch(/@media \(max-width: 767px\) \{ \.ae-[a-f0-9]{6}\.ae-[a-f0-9]{6}\.ae-[a-f0-9]{6} \{ font-size: 24px; \} \}/);
    expect(after.match(/armature:start/g)).toHaveLength(1);
    expect(after.startsWith(":root { --navy")).toBe(true);
  });
});

describe("tailwind mapping", () => {
  it("uses the scale when exact and arbitrary values otherwise", () => {
    const options = { version: 4 as const, colors: { primary: "#1d3770" } };
    expect(declarationToClass("padding", "16px", options)).toBe("p-4");
    expect(declarationToClass("padding-left", "1.5rem", options)).toBe("pl-6");
    expect(declarationToClass("padding-top", "23px", options)).toBe("pt-[23px]");
    expect(declarationToClass("margin-top", "-8px", options)).toBe("-mt-2");
    expect(declarationToClass("font-size", "18px", options)).toBe("text-lg");
    expect(declarationToClass("font-size", "17px", options)).toBe("text-[17px]");
    expect(declarationToClass("font-weight", "650", options)).toBe("font-[650]");
    expect(declarationToClass("line-height", "1.5", options)).toBe("leading-normal");
    expect(declarationToClass("color", "#1d3770", options)).toBe("text-primary");
    expect(declarationToClass("background-color", "#ffffff", options)).toBe("bg-[#ffffff]");
    expect(declarationToClass("border-radius", "8px", options)).toBe("rounded-lg");
    expect(declarationToClass("border-radius", "8px", { version: 3 })).toBe("rounded-lg");
    expect(declarationToClass("border-radius", "4px", { version: 3 })).toBe("rounded");
    expect(declarationToClass("width", "50%", options)).toBe("w-1/2");
    expect(declarationToClass("width", "320px", options)).toBe("w-80");
    expect(declarationToClass("text-align", "center", options)).toBe("text-center");
    expect(declarationToClass("gap", "24px", options)).toBe("gap-6");
    expect(declarationToClass("display", "none", options)).toBe("hidden");
    expect(declarationToClass("float", "left", options)).toBeNull();
    expect(groupOf("lg:pt-[23px]")).toBe("padding");
    expect(groupOf("text-primary")).toBe("color");
    expect(groupOf("text-lg")).toBe("font-size");
    expect(groupOf("text-center")).toBe("text-align");
  });

  it("keeps other devices unchanged", () => {
    const options = { version: 4 as const };
    expect(applyDeclarations("p-4", { padding: "24px" }, "desktop", options).className).toBe("p-4 lg:p-6");
    expect(applyDeclarations("p-4", { padding: "24px" }, "tablet", options).className).toBe("p-4 md:max-lg:p-6");
    expect(applyDeclarations("p-4 lg:p-8", { padding: "24px" }, "tablet", options).className).toBe("p-4 lg:p-8 md:p-6");
    expect(applyDeclarations("", { padding: "24px" }, "phone", options).className).toBe("max-md:p-6");
    expect(applyDeclarations("p-4", { padding: "24px" }, "phone", options).className).toBe("p-6 md:p-4");
    expect(applyDeclarations("p-4 md:p-8", { padding: "24px" }, "phone", options).className).toBe("md:p-8 p-6");
    expect(applyDeclarations("text-lg", { "font-size": "20px" }, "desktop", { version: 3, important: true }).className).toBe("text-lg lg:!text-xl");
  });
});

describe("plain css helpers", () => {
  it("reads breakpoints from the site's media queries", () => {
    expect(detectBreakpoints("@media (max-width: 767px) {} @media (max-width: 1023px) {} @media (max-width: 767px) {}")).toEqual({ tablet: 768, desktop: 1024 });
    expect(detectBreakpoints("")).toEqual({ tablet: 768, desktop: 1024 });
  });
  it("keeps one block and merges declarations", () => {
    let css = applyCssRule("body { margin: 0; }\n", "ae-abc123", "desktop", { "padding-top": "23px" }, { tablet: 768, desktop: 1024 });
    css = applyCssRule(css, "ae-abc123", "desktop", { "padding-top": "24px", color: "red" }, { tablet: 768, desktop: 1024 });
    css = applyCssRule(css, "ae-abc123", "phone", { color: "blue" }, { tablet: 768, desktop: 1024 });
    expect(css).toBe(
      "body { margin: 0; }\n\n/* armature:start — rules written by the Armature editor; edit freely */\n@media (min-width: 1024px) { .ae-abc123.ae-abc123.ae-abc123 { padding-top: 24px; color: red; } }\n@media (max-width: 767px) { .ae-abc123.ae-abc123.ae-abc123 { color: blue; } }\n/* armature:end */\n",
    );
  });
  it("collapses JSX whitespace like the browser", () => {
    expect(collapseJsxText("\n          Welcome to\n          ")).toBe("Welcome to");
    expect(collapseJsxText("Hello ")).toBe("Hello ");
  });
});
