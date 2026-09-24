/**
 * One editing session on a site's working copy: resolves clicked elements, applies
 * edits (each one a named, undoable step that writes whole files), and keeps the
 * undo/redo history as file snapshots. The preview's dev server sees every write and
 * hot-reloads, so the page follows each step, including undo.
 */
import * as t from "@babel/types";
import type { Declarations, Device, EditOp, EditResult, HistoryState, Loc, NodeRef, ResolvedNode } from "../shared/types.ts";
import { addClasses, applyDeclarations, type TailwindOptions } from "./tailwind.ts";
import { applyCssRule, fallbackClassFor, type Breakpoints } from "./css.ts";
import { staticClassName, writeClassName } from "./classnames.ts";
import { placeUpload } from "./images.ts";
import { locate } from "./locate.ts";
import { getAttribute, printSource, type ParsedFile } from "./parse.ts";
import type { Project } from "./project.ts";
import { resolveNode, ResolveError } from "./resolve.ts";
import { indexSiteCss, siteCssSets, type CssIndex } from "./sitecss.ts";
import { deleteElement, duplicateElement, insertElement, moveElement, printWithLocation } from "./structure.ts";
import { findStringAt, setJsxChildren, setStringLiteral } from "./text.ts";

export type SiteStyle = {
  tailwind: boolean;
  tailwindVersion: 3 | 4;
  /** The stylesheet the plain-CSS fallback writes into (repo-relative). */
  stylesheet: string | null;
  breakpoints: Breakpoints;
  colors: Record<string, string>;
};

type Snapshot = { path: string; before: Buffer | null; after: Buffer | null };
type Entry = { label: string; files: Snapshot[]; select: Loc | null };

export class EditError extends Error {}

export class EngineSession {
  readonly project: Project;
  readonly style: SiteStyle;
  pageFile: string | null;
  private entries: Entry[] = [];
  private cursor = 0;
  private cssIndex: CssIndex | null = null;
  private readonly touched = new Set<string>();

  constructor(project: Project, style: SiteStyle, pageFile: string | null = null) {
    this.project = project;
    this.style = style;
    this.pageFile = pageFile;
  }

  resolve(ref: NodeRef): ResolvedNode {
    return resolveNode({ project: this.project, ref, pageFile: this.pageFile, tailwind: this.style.tailwind });
  }

  history(): HistoryState {
    return {
      canUndo: this.cursor > 0,
      canRedo: this.cursor < this.entries.length,
      undoLabel: this.cursor > 0 ? (this.entries[this.cursor - 1]?.label ?? null) : null,
      redoLabel: this.cursor < this.entries.length ? (this.entries[this.cursor]?.label ?? null) : null,
      length: this.entries.length,
    };
  }

  touchedFiles(): string[] {
    return Array.from(this.touched).sort();
  }

  /** Every change in one undo step: `writes` produces the new contents from a scratch view of the project. */
  private commit(label: string, writes: { path: string; content: string | Buffer | null }[], select: Loc | null): EditResult {
    const files: Snapshot[] = [];
    for (const write of writes) {
      const before = this.project.exists(write.path) ? this.project.readBinary(write.path) : null;
      const after = write.content === null ? null : Buffer.isBuffer(write.content) ? write.content : Buffer.from(write.content, "utf8");
      if (before && after && before.equals(after)) continue;
      files.push({ path: write.path, before, after });
    }
    if (files.length === 0) return { ok: true, label, changed: [], select, history: this.history() };
    this.entries = this.entries.slice(0, this.cursor);
    this.entries.push({ label, files, select });
    this.cursor = this.entries.length;
    this.applySnapshots(files, "after");
    return { ok: true, label, changed: files.map((file) => file.path), select, history: this.history() };
  }

  private applySnapshots(files: Snapshot[], side: "before" | "after"): void {
    for (const file of files) {
      const content = file[side];
      if (content === null) this.project.remove(file.path);
      else if (/\.(tsx|jsx|ts|js|css|html|json|md|txt|svg)$/.test(file.path)) this.project.write(file.path, content.toString("utf8"));
      else this.project.writeBinary(file.path, content);
      this.touched.add(file.path);
    }
    this.cssIndex = null;
  }

  undo(): EditResult {
    if (this.cursor === 0) return { ok: false, message: "Nothing to undo." };
    const entry = this.entries[this.cursor - 1]!;
    this.cursor -= 1;
    this.applySnapshots(entry.files, "before");
    return { ok: true, label: `Undo ${entry.label}`, changed: entry.files.map((file) => file.path), select: null, history: this.history() };
  }

  redo(): EditResult {
    if (this.cursor >= this.entries.length) return { ok: false, message: "Nothing to redo." };
    const entry = this.entries[this.cursor]!;
    this.cursor += 1;
    this.applySnapshots(entry.files, "after");
    return { ok: true, label: `Redo ${entry.label}`, changed: entry.files.map((file) => file.path), select: entry.select, history: this.history() };
  }

  apply(op: EditOp): EditResult {
    try {
      switch (op.op) {
        case "text":
          return this.setText(op.target, op.value);
        case "richText":
          return this.setRichText(op.target, op.runs);
        case "style":
          return this.setStyle(op.target, op.device, op.declarations);
        case "className":
          return this.setClassName(op.target, op.className);
        case "image":
          return this.setImage(op.target, op);
        case "link":
          return this.setLink(op.target, op.href);
        case "move":
          return this.move(op.target, op.parent, op.index);
        case "delete":
          return this.remove(op.target);
        case "duplicate":
          return this.duplicate(op.target);
        case "insert":
          return this.insert(op.parent, op.index, op.kind);
      }
    } catch (error) {
      if (error instanceof EditError || error instanceof ResolveError) return { ok: false, message: error.message };
      throw error;
    }
    return { ok: false, message: "Unknown edit." };
  }

  private parsedOrFail(file: string): ParsedFile {
    const parsed = this.project.parsed(file);
    if (!parsed) throw new EditError(`${file} could not be read.`);
    return parsed;
  }

  private writeLiteral(where: Loc, value: string): { path: string; content: string } {
    const parsed = this.parsedOrFail(where.file);
    const literal = findStringAt(parsed, where);
    if (!literal) throw new EditError("The text moved in the code since the page was drawn. Click it again.");
    setStringLiteral(parsed, literal, value);
    return { path: where.file, content: printSource(parsed.ast) };
  }

  private setText(target: NodeRef, value: string): EditResult {
    const node = this.resolve(target);
    if (!node.text) throw new EditError("This element has no text of its own.");
    if (!node.text.editable) throw new EditError(node.text.reason.message);
    if (node.text.kind === "literal") {
      const write = this.writeLiteral(node.text.where, value);
      return this.commit("Edit text", [write], target.loc ?? target.usage);
    }
    const parsed = this.parsedOrFail(node.text.where.file);
    if (!setJsxChildren(parsed, node.text.where, [{ text: value }])) throw new EditError("The text moved in the code. Click it again.");
    const element = locate(parsed, node.text.where.file, node.text.where)?.element ?? null;
    const printed = printWithLocation(parsed, node.text.where.file, element);
    return this.commit("Edit text", [{ path: node.text.where.file, content: printed.code }], printed.loc ?? node.text.where);
  }

  private setRichText(target: NodeRef, runs: EditOp extends { op: "richText"; runs: infer R } ? R : never): EditResult {
    const node = this.resolve(target);
    if (!node.text) throw new EditError("This element has no text of its own.");
    if (!node.text.editable) throw new EditError(node.text.reason.message);
    const formatted = runs.some((run) => run.bold || run.italic || run.href || run.br);
    if (!node.text.rich) {
      if (formatted) throw new EditError("This text is stored as plain words in the code, so bold, italic and links cannot be kept. The words themselves were saved.");
      return this.setText(target, runs.map((run) => run.text).join(""));
    }
    const parsed = this.parsedOrFail(node.text.where.file);
    if (!setJsxChildren(parsed, node.text.where, runs)) throw new EditError("The text moved in the code. Click it again.");
    const element = locate(parsed, node.text.where.file, node.text.where)?.element ?? null;
    const printed = printWithLocation(parsed, node.text.where.file, element);
    return this.commit("Edit text", [{ path: node.text.where.file, content: printed.code }], printed.loc ?? node.text.where);
  }

  private primaryElement(node: ResolvedNode): { parsed: ParsedFile; element: t.JSXElement; loc: Loc } {
    if (!node.classes.editable) throw new EditError(node.classes.reason.message);
    const loc = node.classes.where;
    const parsed = this.parsedOrFail(loc.file);
    const located = locate(parsed, loc.file, loc);
    if (!located) throw new EditError("The element moved in the code since the page was drawn. Click it again.");
    return { parsed, element: located.element, loc };
  }

  private setStyle(target: NodeRef, device: Device, declarations: Declarations): EditResult {
    const node = this.resolve(target);
    const { parsed, element, loc } = this.primaryElement(node);
    const current = staticClassName(element);
    const label = `Style ${Object.keys(declarations).join(", ")}`;
    if (this.style.tailwind) {
      const index = this.cssIndex ?? (this.cssIndex = indexSiteCss(this.project));
      const ownClasses = current.split(/\s+/).filter(Boolean);
      const important = Object.keys(declarations).some((property) => siteCssSets(index, ownClasses, property));
      const options: TailwindOptions = { version: this.style.tailwindVersion, colors: this.style.colors, important };
      const result = applyDeclarations(current, declarations, device, options);
      if (result.unsupported.length === Object.keys(declarations).length) throw new EditError(`${result.unsupported.join(", ")} cannot be written as Tailwind classes yet.`);
      writeClassName(parsed, element, result.className);
      const printed = printWithLocation(parsed, loc.file, element);
      return this.commit(label, [{ path: loc.file, content: printed.code }], printed.loc ?? loc);
    }
    if (!this.style.stylesheet) throw new EditError("This site does not run Tailwind and no stylesheet was found to write into.");
    const className = fallbackClassFor(loc);
    const writes: { path: string; content: string }[] = [];
    if (!current.split(/\s+/).includes(className)) {
      writeClassName(parsed, element, addClasses(current, [className]));
    }
    const printed = printWithLocation(parsed, loc.file, element);
    writes.push({ path: loc.file, content: printed.code });
    const stylesheet = this.project.read(this.style.stylesheet) ?? "";
    writes.push({ path: this.style.stylesheet, content: applyCssRule(stylesheet, className, device, declarations, this.style.breakpoints) });
    return this.commit(label, writes, printed.loc ?? loc);
  }

  private setClassName(target: NodeRef, className: string): EditResult {
    const node = this.resolve(target);
    const { parsed, element, loc } = this.primaryElement(node);
    writeClassName(parsed, element, className);
    const printed = printWithLocation(parsed, loc.file, element);
    return this.commit("Edit classes", [{ path: loc.file, content: printed.code }], printed.loc ?? loc);
  }

  private setImage(target: NodeRef, op: Extract<EditOp, { op: "image" }>): EditResult {
    const node = this.resolve(target);
    if (!node.image) throw new EditError("This element is not a picture.");
    if (!node.image.editable) throw new EditError(node.image.reason.message);
    const writes: { path: string; content: string | Buffer }[] = [];
    let src = op.src;
    if (op.upload) {
      const placed = placeUpload(this.project, node.image, op.upload.name);
      writes.push({ path: placed.repoPath, content: Buffer.from(op.upload.base64, "base64") });
      src = placed.reference;
    }
    // Several literal edits may land in the same file: apply them on one parsed tree.
    const files = new Map<string, ParsedFile>();
    const parsedFor = (file: string) => {
      const cached = files.get(file);
      if (cached) return cached;
      const parsed = this.parsedOrFail(file);
      files.set(file, parsed);
      return parsed;
    };
    if (src !== undefined) {
      const parsed = parsedFor(node.image.where.file);
      const literal = findStringAt(parsed, node.image.where);
      if (!literal) throw new EditError("The picture's address moved in the code. Click it again.");
      setStringLiteral(parsed, literal, src);
    }
    if (op.alt !== undefined) {
      if (node.image.altWhere) {
        const parsed = parsedFor(node.image.altWhere.file);
        const literal = findStringAt(parsed, node.image.altWhere);
        if (!literal) throw new EditError("The alt text moved in the code. Click it again.");
        setStringLiteral(parsed, literal, op.alt);
      } else if (node.image.altEditable) {
        const origin = target.loc ?? target.usage;
        if (!origin) throw new EditError("The picture has no source location.");
        const parsed = parsedFor(origin.file);
        const located = locate(parsed, origin.file, origin);
        if (!located) throw new EditError("The picture moved in the code. Click it again.");
        const existing = getAttribute(located.element, "alt");
        if (existing) existing.value = t.stringLiteral(op.alt);
        else located.element.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier("alt"), t.stringLiteral(op.alt)));
      } else {
        throw new EditError("This picture's description is worked out by code, so it cannot be changed here.");
      }
    }
    for (const [file, parsed] of files) writes.push({ path: file, content: printSource(parsed.ast) });
    return this.commit(op.upload ? "Replace picture" : op.alt !== undefined && src === undefined ? "Edit picture description" : "Edit picture", writes, target.loc ?? target.usage);
  }

  private setLink(target: NodeRef, href: string): EditResult {
    const node = this.resolve(target);
    if (!node.link) throw new EditError("This element is not a link.");
    if (!node.link.editable) throw new EditError(node.link.reason.message);
    return this.commit("Edit link", [this.writeLiteral(node.link.where, href)], target.loc ?? target.usage);
  }

  private structural(target: NodeRef): { node: ResolvedNode; loc: Loc } {
    const node = this.resolve(target);
    if (!node.structure.editable) throw new EditError(node.structure.reason?.message ?? "This element cannot be moved here.");
    if (!node.classes.editable) throw new EditError(node.classes.reason.message);
    return { node, loc: node.classes.where };
  }

  private move(target: NodeRef, parentRef: NodeRef, index: number): EditResult {
    const { loc } = this.structural(target);
    const parentNode = this.resolve(parentRef);
    if (!parentNode.classes.editable) throw new EditError(parentNode.classes.reason.message);
    const parentLoc = parentNode.classes.where;
    if (parentLoc.file !== loc.file) throw new EditError("Elements can only be moved within the same file for now. This box lives in another file.");
    if (!parentNode.structure.canReceiveChildren) throw new EditError(`${parentNode.label} cannot take elements dropped into it.`);
    const parsed = this.parsedOrFail(loc.file);
    const result = moveElement(parsed, loc.file, loc, parentLoc, index);
    if (!result) throw new EditError("This element cannot be moved there.");
    return this.commit("Move element", [{ path: loc.file, content: result.code }], result.loc);
  }

  private remove(target: NodeRef): EditResult {
    const { loc } = this.structural(target);
    const parsed = this.parsedOrFail(loc.file);
    const result = deleteElement(parsed, loc.file, loc);
    if (!result) throw new EditError("This element cannot be deleted here.");
    return this.commit("Delete element", [{ path: loc.file, content: result.code }], null);
  }

  private duplicate(target: NodeRef): EditResult {
    const { loc } = this.structural(target);
    const parsed = this.parsedOrFail(loc.file);
    const result = duplicateElement(parsed, loc.file, loc);
    if (!result) throw new EditError("This element cannot be duplicated here.");
    return this.commit("Duplicate element", [{ path: loc.file, content: result.code }], result.loc);
  }

  private insert(parentRef: NodeRef, index: number, kind: Extract<EditOp, { op: "insert" }>["kind"]): EditResult {
    const parentNode = this.resolve(parentRef);
    if (!parentNode.classes.editable) throw new EditError(parentNode.classes.reason.message);
    if (!parentNode.structure.canReceiveChildren) throw new EditError(`New elements cannot go inside ${parentNode.label}: its contents are drawn by code.`);
    const loc = parentNode.classes.where;
    const parsed = this.parsedOrFail(loc.file);
    const result = insertElement(parsed, loc.file, loc, index, kind, this.style.tailwind);
    if (!result) throw new EditError("The element could not be added there.");
    return this.commit(`Add ${kind}`, [{ path: loc.file, content: result.code }], result.loc);
  }
}
