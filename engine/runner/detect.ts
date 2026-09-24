/**
 * What kind of site this is and what the editor needs to know about it: the framework
 * and package manager, whether Tailwind is actually loaded, which stylesheet the
 * plain-CSS fallback may write into, the pages (from the site's routes), the theme
 * (Tailwind config or @theme, else the site's CSS variables) and the environment
 * variables the site expects.
 */
import * as t from "@babel/types";
import type { PageInfo, SiteTheme } from "../shared/types.ts";
import { detectBreakpoints } from "../ast/css.ts";
import { literalString, walk } from "../ast/parse.ts";
import { parseJsonc, type Project } from "../ast/project.ts";
import { indexSiteCss, listCssFiles } from "../ast/sitecss.ts";

export type Detected = {
  framework: "vite-react" | "tanstack-start" | "unknown";
  packageManager: "bun" | "npm" | "pnpm" | "yarn";
  tailwind: boolean;
  tailwindVersion: 3 | 4;
  stylesheet: string | null;
  pages: PageInfo[];
  theme: SiteTheme;
  breakpoints: { tablet: number; desktop: number };
  colors: Record<string, string>;
  envRequired: string[];
  envCommitted: string[];
};

function packageJson(project: Project): { dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> } {
  try {
    const parsed = JSON.parse(project.read("package.json") ?? "{}") as Record<string, unknown>;
    return {
      dependencies: (parsed["dependencies"] as Record<string, string>) ?? {},
      devDependencies: (parsed["devDependencies"] as Record<string, string>) ?? {},
      scripts: (parsed["scripts"] as Record<string, string>) ?? {},
    };
  } catch {
    return { dependencies: {}, devDependencies: {}, scripts: {} };
  }
}

/** CSS files a source file imports (including `?url` imports), repo-relative. */
function stylesheetsImportedBy(project: Project, file: string, css: Set<string>): string[] {
  const out: string[] = [];
  const code = project.read(file) ?? "";
  for (const match of code.matchAll(/import\s+(?:[\w$]+\s+from\s+)?["']([^"']+\.css)(?:\?[^"']*)?["']/g)) {
    const resolved = project.resolveImport(file, match[1] ?? "");
    if (resolved && css.has(resolved) && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/** Files every page loads: index.html links, the client entry, the root layout. */
const ROOT_FILES = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/App.tsx", "src/router.tsx", "src/routes/__root.tsx", "app/root.tsx", "src/styles.css"];

/** CSS files the site actually loads, split into the ones every page gets and the ones single routes import. */
function referencedStylesheets(project: Project): { root: string[]; all: string[]; byFile: Map<string, string[]> } {
  const css = new Set(listCssFiles(project));
  const root: string[] = [];
  const html = project.read("index.html") ?? "";
  for (const match of html.matchAll(/href="\/?([^"]+\.css)"/g)) {
    const path = (match[1] ?? "").replace(/^\.?\//, "");
    if (css.has(path)) root.push(path);
  }
  const byFile = new Map<string, string[]>();
  for (const file of project.listSourceFiles()) {
    const imported = stylesheetsImportedBy(project, file, css);
    if (imported.length > 0) byFile.set(file, imported);
    if (ROOT_FILES.includes(file)) for (const item of imported) if (!root.includes(item)) root.push(item);
  }
  const all = [...root];
  for (const list of byFile.values()) for (const item of list) if (!all.includes(item)) all.push(item);
  return { root, all, byFile };
}

const hasTailwind = (project: Project, file: string): boolean => /@import\s+["']tailwindcss|@tailwind\s+(base|utilities)/.test(project.read(file) ?? "");

function labelForPath(path: string): string {
  const clean = path.replace(/^\/|\/$/g, "");
  if (!clean) return "Home";
  const last = clean.split("/").pop() ?? clean;
  return last
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const PRIVATE_PATH = /^\/(admin|auth|dashboard|login|logout|signin|sign-in|signup|account|api|_)/;

function componentFileOf(project: Project, file: string, parsed: ReturnType<Project["parsed"]>, name: string | null): string | null {
  if (!parsed || !name) return null;
  for (const statement of parsed.ast.program.body) {
    if (!t.isImportDeclaration(statement)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.local.name === name) return project.resolveImport(file, statement.source.value);
    }
  }
  return null;
}

function tanstackPages(project: Project): PageInfo[] {
  const pages: PageInfo[] = [];
  const trailing = /trailingSlash:\s*["']always["']/.test(project.read("src/router.tsx") ?? project.read("src/router.ts") ?? "");
  for (const file of project.listSourceFiles("src/routes")) {
    if (/__root\.tsx?$/.test(file)) continue;
    const parsed = project.parsed(file);
    if (!parsed) continue;
    let path: string | null = null;
    let componentName: string | null = null;
    walk(parsed.ast, (node) => {
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "createFileRoute") {
        path = literalString(node.arguments[0] ?? null);
      }
      if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "component" && t.isIdentifier(node.value)) componentName = node.value.name;
    });
    if (!path) continue;
    const routePath: string = path;
    const fullPath = trailing && routePath !== "/" && !routePath.endsWith("/") ? `${routePath}/` : routePath;
    pages.push({ path: fullPath, label: labelForPath(routePath), file, component: componentFileOf(project, file, parsed, componentName), private: PRIVATE_PATH.test(routePath) || routePath.includes("$"), tailwind: false });
  }
  const unique = new Map<string, PageInfo>();
  for (const page of pages) if (!unique.has(page.path)) unique.set(page.path, page);
  return Array.from(unique.values()).sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
}

function reactRouterPages(project: Project): PageInfo[] {
  const pages: PageInfo[] = [];
  for (const file of project.listSourceFiles()) {
    const code = project.read(file) ?? "";
    if (!code.includes("<Route") && !code.includes("createBrowserRouter")) continue;
    const parsed = project.parsed(file);
    if (!parsed) continue;
    walk(parsed.ast, (node) => {
      if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name) && node.openingElement.name.name === "Route") {
        let path: string | null = null;
        let componentName: string | null = null;
        for (const attribute of node.openingElement.attributes) {
          if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name)) continue;
          if (attribute.name.name === "path") path = attribute.value ? literalString(attribute.value) : null;
          if ((attribute.name.name === "element" || attribute.name.name === "Component") && attribute.value && t.isJSXExpressionContainer(attribute.value)) {
            const expression = attribute.value.expression;
            if (t.isJSXElement(expression) && t.isJSXIdentifier(expression.openingElement.name)) componentName = expression.openingElement.name.name;
            if (t.isIdentifier(expression)) componentName = expression.name;
          }
        }
        if (path && !path.includes("*") && !path.includes(":")) pages.push({ path, label: labelForPath(path), file, component: componentFileOf(project, file, parsed, componentName), private: PRIVATE_PATH.test(path), tailwind: false });
      }
      if (t.isObjectExpression(node)) {
        let path: string | null = null;
        let componentName: string | null = null;
        for (const property of node.properties) {
          if (!t.isObjectProperty(property) || !t.isIdentifier(property.key)) continue;
          if (property.key.name === "path") path = literalString(property.value);
          if ((property.key.name === "element" || property.key.name === "Component") && t.isJSXElement(property.value) && t.isJSXIdentifier(property.value.openingElement.name)) componentName = property.value.openingElement.name.name;
          if (property.key.name === "Component" && t.isIdentifier(property.value)) componentName = property.value.name;
        }
        if (path && path.startsWith("/") && componentName && !path.includes("*") && !path.includes(":")) pages.push({ path, label: labelForPath(path), file, component: componentFileOf(project, file, parsed, componentName), private: PRIVATE_PATH.test(path), tailwind: false });
      }
    });
  }
  const unique = new Map<string, PageInfo>();
  for (const page of pages) if (!unique.has(page.path)) unique.set(page.path, page);
  return Array.from(unique.values()).sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
}

const REM = 16;
const cssLength = (value: string): number | null => {
  const match = /^(\d*\.?\d+)(px|rem)?$/.exec(value.trim());
  if (!match) return null;
  return match[2] === "rem" ? Number(match[1]) * REM : Number(match[1]);
};

function tailwindV4Theme(project: Project, stylesheets: string[]): { colors: Record<string, string>; fonts: Record<string, string>; breakpoints: Partial<{ tablet: number; desktop: number }> } {
  const colors: Record<string, string> = {};
  const fonts: Record<string, string> = {};
  const breakpoints: Partial<{ tablet: number; desktop: number }> = {};
  for (const file of stylesheets) {
    const css = project.read(file) ?? "";
    for (const block of css.matchAll(/@theme[^{]*\{([^}]*)\}/g)) {
      for (const declaration of (block[1] ?? "").split(";")) {
        const index = declaration.indexOf(":");
        if (index === -1) continue;
        const name = declaration.slice(0, index).trim();
        const value = declaration.slice(index + 1).trim();
        if (name.startsWith("--color-")) colors[name.slice("--color-".length)] = value;
        if (name.startsWith("--font-")) fonts[name.slice("--font-".length)] = value;
        if (name === "--breakpoint-md") breakpoints.tablet = cssLength(value) ?? undefined;
        if (name === "--breakpoint-lg") breakpoints.desktop = cssLength(value) ?? undefined;
      }
    }
  }
  return { colors, fonts, breakpoints };
}

function tailwindV3Theme(project: Project): { colors: Record<string, string>; fonts: Record<string, string> } {
  const colors: Record<string, string> = {};
  const fonts: Record<string, string> = {};
  for (const name of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"]) {
    const parsed = project.parsed(name);
    if (!parsed) continue;
    walk(parsed.ast, (node) => {
      if (!t.isObjectProperty(node) || !t.isIdentifier(node.key)) return;
      if (node.key.name === "colors" && t.isObjectExpression(node.value)) {
        for (const property of node.value.properties) {
          if (!t.isObjectProperty(property) || !t.isIdentifier(property.key)) continue;
          const value = literalString(property.value);
          if (value) colors[property.key.name] = value;
          if (t.isObjectExpression(property.value)) {
            const base = property.value.properties.find((item): item is t.ObjectProperty => t.isObjectProperty(item) && t.isIdentifier(item.key) && item.key.name === "DEFAULT");
            const value2 = base ? literalString(base.value) : null;
            if (value2) colors[property.key.name] = value2;
          }
        }
      }
      if (node.key.name === "fontFamily" && t.isObjectExpression(node.value)) {
        for (const property of node.value.properties) {
          if (!t.isObjectProperty(property) || !t.isIdentifier(property.key)) continue;
          if (t.isArrayExpression(property.value)) fonts[property.key.name] = property.value.elements.map((element) => literalString(element as t.Node) ?? "").filter(Boolean).join(", ");
        }
      }
    });
    break;
  }
  return { colors, fonts };
}

const looksLikeColor = (value: string) => /^(#|rgb|hsl|oklch|oklab)/.test(value.trim());

export function detectSite(project: Project): Detected {
  const pkg = packageJson(project);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework: Detected["framework"] = deps["@tanstack/react-start"] ? "tanstack-start" : deps["vite"] && deps["react"] ? "vite-react" : "unknown";
  const packageManager: Detected["packageManager"] = project.exists("bun.lock") || project.exists("bun.lockb") ? "bun" : project.exists("pnpm-lock.yaml") ? "pnpm" : project.exists("yarn.lock") ? "yarn" : "npm";
  const tailwindVersion: 3 | 4 = /^[\^~]?3/.test(deps["tailwindcss"] ?? "") ? 3 : 4;
  const referenced = referencedStylesheets(project);
  const stylesheets = referenced.all;
  // Tailwind counts as active when a stylesheet every page loads imports it.
  const tailwind = referenced.root.some((file) => hasTailwind(project, file));
  const stylesheet = referenced.root.find((file) => /global|index|app|main|styles/.test(file)) ?? referenced.root[0] ?? stylesheets[0] ?? null;

  const pages = (framework === "tanstack-start" ? tanstackPages(project) : reactRouterPages(project)).map((page) => {
    // A route that imports its own Tailwind stylesheet (an admin area, say) has Tailwind on that page only.
    const own = [...(referenced.byFile.get(page.file) ?? []), ...(page.component ? (referenced.byFile.get(page.component) ?? []) : [])];
    // File-based routes inherit their layouts: src/routes/admin.index.tsx sits under src/routes/admin.tsx.
    const parts = page.file.replace(/\.tsx?$/, "").split(".");
    for (let index = 1; index < parts.length; index += 1) own.push(...(referenced.byFile.get(`${parts.slice(0, index).join(".")}.tsx`) ?? []));
    return { ...page, tailwind: tailwind || own.some((file) => hasTailwind(project, file)) };
  });

  const cssIndex = indexSiteCss(project);
  let theme: SiteTheme;
  let breakpoints = { tablet: 768, desktop: 1024 };
  let colors: Record<string, string> = {};
  if (tailwind && tailwindVersion === 4) {
    const v4 = tailwindV4Theme(project, stylesheets);
    colors = v4.colors;
    breakpoints = { tablet: v4.breakpoints.tablet ?? 768, desktop: v4.breakpoints.desktop ?? 1024 };
    theme = { source: "css-theme", breakpoints, colors: Object.entries(colors).map(([name, value]) => ({ name, value })), fonts: Object.entries(v4.fonts).map(([name, value]) => ({ name, value })) };
  } else if (tailwind) {
    const v3 = tailwindV3Theme(project);
    colors = v3.colors;
    theme = { source: "tailwind-config", breakpoints, colors: Object.entries(colors).map(([name, value]) => ({ name, value })), fonts: Object.entries(v3.fonts).map(([name, value]) => ({ name, value })) };
  } else {
    const allCss = stylesheets.map((file) => project.read(file) ?? "").join("\n");
    breakpoints = detectBreakpoints(allCss);
    const variableColors = Object.entries(cssIndex.variables).filter(([, value]) => looksLikeColor(value));
    const fonts = Object.entries(cssIndex.variables).filter(([name]) => /font/.test(name));
    theme = { source: variableColors.length > 0 ? "css-variables" : "none", breakpoints, colors: variableColors.map(([name, value]) => ({ name: name.replace(/^--/, ""), value })), fonts: fonts.map(([name, value]) => ({ name: name.replace(/^--/, ""), value })) };
  }

  const envRequired = envKeys(project.read(".env.example") ?? project.read(".env.sample") ?? project.read(".env.template") ?? "");
  const envCommitted = envKeys(project.read(".env") ?? "").filter((key) => (project.read(".env") ?? "").match(new RegExp(`^${key}=.+`, "m")));

  return { framework, packageManager, tailwind, tailwindVersion, stylesheet, pages, theme, breakpoints, colors, envRequired, envCommitted };
}

export function envKeys(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match && match[1] && !keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

export { parseJsonc };
