/**
 * Vite plugin: tag every JSX element with where it came from, in the preview only.
 *
 *   <h1 className="x">            → <h1 className="x" data-ae="src/pages/Home.tsx:25:10" data-ae-c="Home">
 *   <Button size="lg">            → <Button size="lg" data-ae-p="src/pages/Home.tsx:40:8">
 *   items.map((item) => <li>…)    → items.map((item, __aeI) => <li data-ae-i={__aeI}>…)
 *
 * data-ae is the element's own JSX (file:line:col of the opening tag, 1-based line,
 * 0-based column, as Babel reports it); data-ae-c the React component it is written in;
 * data-ae-p the usage site of a component, which reaches the DOM when the component
 * forwards its props (shadcn's <Button {...props} />); data-ae-i the index inside the
 * nearest .map callback. The site's files on disk are never touched: this runs in
 * Vite's transform hook, with a source map so errors still point at the real lines.
 */
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import MagicString from "magic-string";
import { relative } from "node:path";

type Plugin = {
  name: string;
  enforce: "pre";
  transform: (code: string, id: string) => { code: string; map: unknown } | null;
};

const SKIP_COMPONENTS = new Set(["Fragment", "React.Fragment", "Suspense", "StrictMode", "React.StrictMode", "Outlet", "Scripts", "HeadContent", "ScrollRestoration", "Head", "Html", "Body", "Meta", "Links"]);

export function tagSource(code: string, relFile: string): { code: string; map: unknown } | null {
  if (!code.includes("<")) return null;
  let ast: t.File;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript", "decorators-legacy", "importAttributes"], errorRecovery: true, ranges: false });
  } catch {
    return null;
  }
  const s = new MagicString(code);
  let changed = false;
  const indexedCallbacks = new Map<t.Function, string>();

  const ensureIndexParam = (fn: t.Function): string | null => {
    const known = indexedCallbacks.get(fn);
    if (known) return known;
    const second = fn.params[1];
    if (second && t.isIdentifier(second)) {
      indexedCallbacks.set(fn, second.name);
      return second.name;
    }
    if (fn.params.length !== 1) return null;
    const first = fn.params[0]!;
    if (first.start == null || first.end == null || fn.start == null) return null;
    const head = code.slice(fn.start, first.start);
    const parenthesised = head.includes("(");
    if (parenthesised) {
      // (item) => … or (item: T) => … : the closing paren follows the param (and its type annotation).
      const paramEnd = (t.isIdentifier(first) && first.typeAnnotation?.end) || first.end;
      s.appendLeft(paramEnd, ", __aeI");
    } else {
      s.appendLeft(first.start, "(");
      s.appendLeft(first.end, ", __aeI)");
    }
    indexedCallbacks.set(fn, "__aeI");
    return "__aeI";
  };

  const visit = (node: t.Node, ancestors: t.Node[]) => {
    if (t.isJSXElement(node)) {
      const opening = node.openingElement;
      const nameNode = opening.name;
      let name: string | null = null;
      if (t.isJSXIdentifier(nameNode)) name = nameNode.name;
      else if (t.isJSXMemberExpression(nameNode)) {
        const parts: string[] = [];
        let current: t.JSXMemberExpression | t.JSXIdentifier = nameNode;
        while (t.isJSXMemberExpression(current)) {
          parts.unshift(current.property.name);
          current = current.object;
        }
        parts.unshift(current.name);
        name = parts.join(".");
      }
      if (name && opening.loc && opening.end != null && !SKIP_COMPONENTS.has(name)) {
        const intrinsic = /^[a-z]/.test(name) && !name.includes(".");
        const loc = `${relFile}:${opening.loc.start.line}:${opening.loc.start.column}`;
        const insertAt = opening.selfClosing ? findSelfClosingSlash(code, opening) : opening.end - 1;
        let attrs = intrinsic ? ` data-ae="${loc}"` : ` data-ae-p="${loc}"`;
        if (intrinsic) {
          const component = componentNameOf(ancestors);
          if (component) attrs += ` data-ae-c="${component}"`;
        }
        const fn = nearestFunction(ancestors);
        if (fn) {
          const fnIndex = ancestors.indexOf(fn);
          const parent = ancestors[fnIndex - 1];
          if (parent && t.isCallExpression(parent) && parent.arguments[0] === fn && t.isMemberExpression(parent.callee) && t.isIdentifier(parent.callee.property) && (parent.callee.property.name === "map" || parent.callee.property.name === "flatMap")) {
            const indexName = ensureIndexParam(fn);
            if (indexName) attrs += ` data-ae-i={${indexName}}`;
          }
        }
        if (insertAt !== null) {
          s.appendLeft(insertAt, attrs);
          changed = true;
        }
      }
    }
    const keys = (t.VISITOR_KEYS as Record<string, string[] | undefined>)[node.type] ?? [];
    const next = [...ancestors, node];
    for (const key of keys) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof (child as t.Node).type === "string") visit(child as t.Node, next);
      } else if (value && typeof (value as t.Node).type === "string") {
        visit(value as t.Node, next);
      }
    }
  };
  visit(ast, []);
  if (!changed) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true }) };
}

/** The position of the "/" in a self-closing tag's "/>" (there may be whitespace before it). */
function findSelfClosingSlash(code: string, opening: t.JSXOpeningElement): number | null {
  if (opening.end == null) return null;
  const slash = code.lastIndexOf("/", opening.end - 1);
  return slash === -1 ? null : slash;
}

function nearestFunction(ancestors: t.Node[]): t.Function | null {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (node && t.isFunction(node)) return node;
  }
  return null;
}

function componentNameOf(ancestors: t.Node[]): string | null {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (!node) continue;
    if (t.isFunctionDeclaration(node) && node.id) return node.id.name;
    if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
      const parent = ancestors[index - 1];
      if (parent && t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) return parent.id.name;
      if (parent && t.isCallExpression(parent)) {
        const grand = ancestors[index - 2];
        if (grand && t.isVariableDeclarator(grand) && t.isIdentifier(grand.id)) return grand.id.name;
      }
      if (t.isFunctionExpression(node) && node.id) return node.id.name;
    }
  }
  return null;
}

export function sourceTagsPlugin(options: { root: string }): Plugin {
  const root = options.root.replace(/\\/g, "/").replace(/\/+$/, "");
  return {
    name: "armature-engine:source-tags",
    enforce: "pre",
    transform(code, id) {
      const clean = id.split("?")[0] ?? id;
      if (id.includes("?tsr-split") || id.includes("?tsr-")) return null;
      if (!/\.[jt]sx$/.test(clean)) return null;
      const normalised = clean.replace(/\\/g, "/");
      if (!normalised.startsWith(`${root}/`) || normalised.includes("/node_modules/")) return null;
      return tagSource(code, relative(root, normalised).replace(/\\/g, "/"));
    },
  };
}
