/**
 * Tracing: from an expression in JSX back to the literal it comes from, if any.
 *
 *   <h1>{title}</h1>                       → const title = "..."           (same file)
 *   {items.map((item) => <li>{item.label}</li>)}  → the array literal, element [i]
 *   <Button>Save</Button> → button.tsx renders {children} → the usage's children
 *   {copy.text("hero", "title")} with copy = usePageCopy("home")
 *                                          → PAGE_DEFAULTS.home.hero.title in another file
 *
 * Anything else (a database query, a fetch, computed strings, props passed from far
 * away) comes back as a plain-English reason instead of a guess.
 */
import * as t from "@babel/types";
import type { Loc, Reason } from "../shared/types.ts";
import { contains, findUsages, locate } from "./locate.ts";
import { componentName, enclosingFunction, literalString, mapCallOf, memberName, resolveBinding, walk, type Node, type Path } from "./parse.ts";
import type { Project } from "./project.ts";

export type TraceContext = {
  project: Project;
  /** Indices from `.map` callbacks, outermost first; consumed from the end as callbacks are crossed. */
  indices: number[];
  /** The component usage that rendered the DOM element (data-ae-p), for prop lookups. */
  usage: Loc | null;
  /** Source locations of the tagged DOM ancestors, nearest first, to pick the right usage. */
  ancestorLocs: Loc[];
  depth: number;
  /** Filled while tracing: the site can also load the value from a database at runtime. */
  dbNote?: string;
};

export type Traced =
  | { kind: "string"; file: string; node: t.StringLiteral | t.TemplateLiteral; inData?: string; dbNote?: string }
  | { kind: "object"; file: string; node: t.ObjectExpression; inData?: string; dbNote?: string }
  | { kind: "array"; file: string; node: t.ArrayExpression; inData?: string; dbNote?: string }
  | { kind: "jsx"; file: string; node: t.JSXElement | t.JSXFragment; ancestors: Path }
  /** The children of a component usage (`<Button>Save</Button>` seen from inside Button). */
  | { kind: "children"; file: string; element: t.JSXElement; ancestors: Path }
  /** The props object of a component, before a property is read from it. */
  | { kind: "props"; file: string; component: string }
  /** The result of calling a function defined in the site (a content hook, say). */
  | { kind: "call"; file: string; fn: t.Function; fnFile: string; args: t.CallExpression["arguments"]; ancestors: Path }
  | { kind: "blocked"; reason: Reason };

const MAX_DEPTH = 40;

const blocked = (kind: Reason["kind"], message: string): Traced => ({ kind: "blocked", reason: { kind, message } });

const LIVE_DATA_CALLEES = /^(use(Query|Queries|InfiniteQuery|SWR|Fetch|Loader|LoaderData|RouteLoaderData|Suspense.*Query|Data|Collection|Store)|fetch|useState|useReducer|useContext|useSyncExternalStore)$/;

export const LIVE_DATA_MESSAGE = "This comes from live data: the site loads it when the page opens (from a database or an API), so it is not written in the code.";
export const CODE_MESSAGE = "This is controlled by code.";

function unwrap(node: Node): Node {
  let current = node;
  while (t.isTSAsExpression(current) || t.isTSNonNullExpression(current) || t.isParenthesizedExpression(current) || t.isTSSatisfiesExpression(current) || t.isTSTypeAssertion(current)) {
    current = current.expression;
  }
  return current;
}

function isLiveDataCall(node: t.CallExpression, ancestors: Path): boolean {
  const callee = unwrap(node.callee);
  if (t.isIdentifier(callee)) {
    if (LIVE_DATA_CALLEES.test(callee.name)) return true;
    const binding = resolveBinding(callee.name, ancestors);
    if (binding?.kind === "import" && /query|swr|supabase|firebase|apollo|axios|graphql/i.test(binding.source)) return true;
    return false;
  }
  if (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) {
    const name = memberName(callee);
    if (name && /^(from|select|rpc|get|post|query|fetch|then|json)$/.test(name)) return true;
    const root = rootIdentifier(callee);
    if (root && /^(supabase|db|client|api|fetch|axios|firebase|prisma)$/i.test(root)) return true;
  }
  return false;
}

function rootIdentifier(node: Node): string | null {
  let current: Node = unwrap(node);
  while (t.isMemberExpression(current) || t.isOptionalMemberExpression(current) || t.isCallExpression(current) || t.isOptionalCallExpression(current)) {
    current = t.isCallExpression(current) || t.isOptionalCallExpression(current) ? unwrap(current.callee) : unwrap(current.object);
  }
  return t.isIdentifier(current) ? current.name : null;
}

/** The module-level ancestors for a node in another file: [Program, ...] down to the export. */
function findExport(project: Project, file: string, name: string): { node: Node; ancestors: Path } | null {
  const parsed = project.parsed(file);
  if (!parsed) return null;
  const program = parsed.ast.program;
  for (const statement of program.body) {
    if (name === "default" && t.isExportDefaultDeclaration(statement)) {
      const declaration = statement.declaration;
      if (t.isIdentifier(declaration)) return findExport(project, file, declaration.name);
      return { node: declaration, ancestors: [parsed.ast, program, statement] };
    }
    const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : null;
    if (t.isVariableDeclaration(declaration)) {
      for (const declarator of declaration.declarations) {
        if (t.isIdentifier(declarator.id) && declarator.id.name === name && declarator.init) return { node: declarator.init, ancestors: [parsed.ast, program, statement, declaration, declarator] };
      }
    } else if (t.isFunctionDeclaration(declaration) && declaration.id?.name === name) {
      return { node: declaration, ancestors: [parsed.ast, program, statement] };
    }
    if (t.isExportNamedDeclaration(statement) && !statement.declaration) {
      for (const specifier of statement.specifiers) {
        if (t.isExportSpecifier(specifier) && (t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value) === name) {
          if (statement.source) {
            const target = project.resolveImport(file, statement.source.value);
            return target ? findExport(project, target, specifier.local.name) : null;
          }
          // export { x } — declared elsewhere in the file
          for (const other of program.body) {
            if (t.isVariableDeclaration(other)) {
              for (const declarator of other.declarations) {
                if (t.isIdentifier(declarator.id) && declarator.id.name === specifier.local.name && declarator.init) return { node: declarator.init, ancestors: [parsed.ast, program, other, declarator] };
              }
            }
            if (t.isFunctionDeclaration(other) && other.id?.name === specifier.local.name) return { node: other, ancestors: [parsed.ast, program] };
          }
        }
      }
    }
  }
  return null;
}

/** Does the module use a database or network client anywhere? Then values it returns may be overridden at runtime. */
function moduleTouchesLiveData(project: Project, file: string): boolean {
  const code = project.read(file) ?? "";
  return /supabase|useQuery|fetch\(|axios|firebase|graphql|prisma|\.from\(/.test(code);
}

export function trace(node: Node, ancestors: Path, file: string, ctx: TraceContext): Traced {
  if (ctx.depth > MAX_DEPTH) return blocked("code", CODE_MESSAGE);
  const inner = { ...ctx, depth: ctx.depth + 1 };
  const expr = unwrap(node);

  if (t.isStringLiteral(expr)) return { kind: "string", file, node: expr };
  if (t.isTemplateLiteral(expr)) {
    if (expr.expressions.length === 0) return { kind: "string", file, node: expr };
    return blocked("code", "This text is put together by code (a template with values inserted into it).");
  }
  if (t.isJSXExpressionContainer(expr)) {
    if (t.isJSXEmptyExpression(expr.expression)) return blocked("code", CODE_MESSAGE);
    return trace(expr.expression, [...ancestors, expr], file, inner);
  }
  if (t.isJSXElement(expr) || t.isJSXFragment(expr)) return { kind: "jsx", file, node: expr, ancestors };
  if (t.isObjectExpression(expr)) return { kind: "object", file, node: expr };
  if (t.isArrayExpression(expr)) return { kind: "array", file, node: expr };
  if (t.isNumericLiteral(expr) || t.isBooleanLiteral(expr) || t.isNullLiteral(expr)) return blocked("code", "This is a number or a flag set in code, not text.");

  if (t.isIdentifier(expr)) return traceIdentifier(expr, ancestors, file, inner);

  if (t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr)) {
    const name = memberName(expr);
    const base = trace(expr.object, [...ancestors, expr], file, inner);
    if (base.kind === "blocked") return base;
    if (base.kind === "props" && name) return resolveProp(base.component, name, base.file, inner);
    if (base.kind === "object" && name) {
      const property = objectProperty(base.node, name);
      if (!property) return blocked("code", `"${name}" is not set in the data this comes from.`);
      const result = trace(property, [], base.file, inner);
      return carry(result, base);
    }
    if (base.kind === "array" && expr.computed && t.isNumericLiteral(expr.property)) {
      const element = base.node.elements[expr.property.value];
      if (!element || t.isSpreadElement(element)) return blocked("code", CODE_MESSAGE);
      return carry(trace(element, [], base.file, inner), base);
    }
    if (base.kind === "string") return blocked("code", "This is a piece of a longer text, worked out by code.");
    return blocked("code", CODE_MESSAGE);
  }

  if (t.isCallExpression(expr) || t.isOptionalCallExpression(expr)) {
    if (isLiveDataCall(expr, ancestors)) return blocked("live-data", LIVE_DATA_MESSAGE);
    const callee = unwrap(expr.callee);
    if (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) {
      const method = memberName(callee);
      const base = trace(callee.object, [...ancestors, expr, callee], file, inner);
      if (base.kind === "blocked") return base;
      if (base.kind === "call" && method) return lookupThroughCall(base, method, expr.arguments, inner);
      if (base.kind === "string") return blocked("code", `This text is changed by code before it is shown (.${method ?? "…"}).`);
      if (base.kind === "array" && method && /^(map|filter|slice|sort|flatMap)$/.test(method)) return base;
      return blocked("code", CODE_MESSAGE);
    }
    if (t.isIdentifier(callee)) {
      const binding = resolveBinding(callee.name, ancestors);
      const fn = binding ? functionOf(binding, file, ctx.project) : null;
      if (fn) return { kind: "call", file, fn: fn.fn, fnFile: fn.file, args: expr.arguments, ancestors };
      return blocked("code", `This is worked out by code (${callee.name}).`);
    }
    return blocked("code", CODE_MESSAGE);
  }

  if (t.isLogicalExpression(expr)) {
    const left = trace(expr.left, [...ancestors, expr], file, inner);
    if (left.kind === "blocked" && left.reason.kind === "live-data") return left;
    if (left.kind !== "blocked") return left;
    return trace(expr.right, [...ancestors, expr], file, inner);
  }
  if (t.isConditionalExpression(expr)) return blocked("code", "This depends on a condition in the code, so it can show different things.");
  if (t.isAwaitExpression(expr)) return blocked("live-data", LIVE_DATA_MESSAGE);
  if (t.isBinaryExpression(expr)) return blocked("code", "This text is put together by code.");
  return blocked("code", CODE_MESSAGE);
}

/** Keep the data-origin notes when descending into a data object. */
function carry(result: Traced, base: Traced): Traced {
  if ((result.kind === "string" || result.kind === "object" || result.kind === "array") && (base.kind === "string" || base.kind === "object" || base.kind === "array")) {
    if (base.inData && !result.inData) result.inData = base.inData;
    if (base.dbNote && !result.dbNote) result.dbNote = base.dbNote;
  }
  return result;
}

function objectProperty(node: t.ObjectExpression, name: string): Node | null {
  for (const property of node.properties) {
    if (!t.isObjectProperty(property)) continue;
    const key = t.isIdentifier(property.key) && !property.computed ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : t.isNumericLiteral(property.key) ? String(property.key.value) : null;
    if (key === name) return property.value;
  }
  return null;
}

function functionOf(binding: ReturnType<typeof resolveBinding>, file: string, project: Project): { fn: t.Function; file: string } | null {
  if (!binding) return null;
  if (binding.kind === "function") return { fn: binding.declaration, file };
  if (binding.kind === "const" && binding.init && t.isFunction(unwrap(binding.init))) return { fn: unwrap(binding.init) as t.Function, file };
  if (binding.kind === "import") {
    const target = project.resolveImport(file, binding.source);
    if (!target) return null;
    const exported = findExport(project, target, binding.imported);
    if (!exported) return null;
    const node = unwrap(exported.node);
    if (t.isFunction(node)) return { fn: node, file: target };
  }
  return null;
}

function traceIdentifier(expr: t.Identifier, ancestors: Path, file: string, ctx: TraceContext): Traced {
  if (expr.name === "undefined") return blocked("code", "Nothing is set here.");
  const binding = resolveBinding(expr.name, ancestors);
  if (!binding) return blocked("code", `"${expr.name}" comes from outside this file's code.`);
  if (binding.kind === "function") return blocked("code", CODE_MESSAGE);
  if (binding.kind === "const") {
    if (!binding.init) return blocked("code", `"${expr.name}" is filled in by code later.`);
    const init = unwrap(binding.init);
    if (t.isCallExpression(init) && isLiveDataCall(init, binding.ancestors)) {
      if (t.isIdentifier(unwrap(init.callee)) && (unwrap(init.callee) as t.Identifier).name === "useState") return blocked("code", "This changes while the page is used (it is kept in the page's state), so it is controlled by code.");
      return blocked("live-data", LIVE_DATA_MESSAGE);
    }
    const result = trace(init, binding.ancestors, file, ctx);
    if ((result.kind === "array" || result.kind === "object") && !result.inData && t.isIdentifier(binding.declarator.id)) result.inData = binding.declarator.id.name;
    return result;
  }
  if (binding.kind === "import") {
    const target = ctx.project.resolveImport(file, binding.source);
    if (!target) {
      if (/\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(binding.source)) return blocked("code", `This picture is imported from ${binding.source}.`);
      return blocked("code", `This comes from the package "${binding.source}".`);
    }
    if (/\.(png|jpe?g|webp|gif|svg|avif|mp4|webm)(\?.*)?$/i.test(target)) return { kind: "string", file, node: binding.declaration.source };
    const exported = findExport(ctx.project, target, binding.imported);
    if (!exported) return blocked("code", `"${binding.imported}" could not be found in ${target}.`);
    const result = trace(exported.node, exported.ancestors, target, ctx);
    if (result.kind === "object" || result.kind === "array" || result.kind === "string") {
      if (!result.inData) result.inData = binding.imported;
    }
    return result;
  }
  // A parameter.
  const { fn, index } = binding;
  const mapArray = mapCallOf(fn, binding.ancestors);
  if (mapArray) {
    if (index === 0) {
      const position = ctx.indices.length > 0 ? ctx.indices[ctx.indices.length - 1] : undefined;
      const remaining = ctx.indices.slice(0, -1);
      const arrayResult = trace(mapArray, binding.ancestors, file, { ...ctx, indices: remaining });
      if (arrayResult.kind === "blocked") return arrayResult;
      if (arrayResult.kind === "call") return functionTouchesLiveData(arrayResult.fn, arrayResult.ancestors) ? blocked("live-data", LIVE_DATA_MESSAGE) : blocked("code", "This list is built by code.");
      if (arrayResult.kind !== "array") return blocked("code", "This list is built by code.");
      if (position === undefined) return blocked("code", "This is one item of a list; which one could not be worked out.");
      const element = arrayResult.node.elements[position];
      if (!element || t.isSpreadElement(element)) return blocked("code", "This item of the list is built by code.");
      const value = binding.property ? (t.isObjectExpression(unwrap(element)) ? objectProperty(unwrap(element) as t.ObjectExpression, binding.property) : null) : element;
      if (!value) return blocked("code", `"${binding.property ?? expr.name}" is not set for this item.`);
      return carry(trace(value, [], arrayResult.file, ctx), arrayResult);
    }
    return blocked("code", "This is the position of an item in a list.");
  }
  const component = componentName([...binding.ancestors, fn]);
  if (component && /^[A-Z]/.test(component) && index === 0) {
    if (binding.property) return resolveProp(component, binding.property, file, ctx);
    return { kind: "props", file, component };
  }
  return blocked("code", `"${expr.name}" is a value handed to this code when it runs.`);
}

/** Resolve a component prop from the usage that rendered this DOM element. */
export function resolveProp(component: string, prop: string, file: string, ctx: TraceContext): Traced {
  const usage = findUsage(component, file, ctx);
  if (!usage) return blocked("prop", `This is "${prop}", passed into ${component} from another part of the code that could not be found from here.`);
  const usageAncestors = usage.ancestors;
  if (prop === "children") {
    const meaningful = usage.element.children.filter((child) => !(t.isJSXText(child) && child.value.trim() === "") && !(t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression)));
    if (meaningful.length === 1 && t.isJSXExpressionContainer(meaningful[0]!)) return trace(meaningful[0]!, [...usageAncestors, usage.element], usage.file, ctx);
    return { kind: "children", file: usage.file, element: usage.element, ancestors: usageAncestors };
  }
  for (const attribute of usage.element.openingElement.attributes) {
    if (t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name) && attribute.name.name === prop) {
      if (!attribute.value) return blocked("code", `"${prop}" is switched on without a value.`);
      return trace(attribute.value, [...usageAncestors, usage.element, usage.element.openingElement, attribute], usage.file, ctx);
    }
  }
  return blocked("code", `"${prop}" is not set where ${component} is used, so the component shows its own default.`);
}

function findUsage(component: string, file: string, ctx: TraceContext): { element: t.JSXElement; ancestors: Path; file: string } | null {
  // 1. The usage the preview reported, if it is a usage of this component.
  if (ctx.usage) {
    const parsed = ctx.project.parsed(ctx.usage.file);
    const located = parsed ? locate(parsed, ctx.usage.file, ctx.usage) : null;
    if (located && usageName(located.element) === component) return { element: located.element, ancestors: located.ancestors, file: ctx.usage.file };
  }
  // 2. A usage lexically inside one of the DOM ancestors' JSX (nearest ancestor first).
  for (const ancestor of ctx.ancestorLocs) {
    const parsed = ctx.project.parsed(ancestor.file);
    if (!parsed) continue;
    const container = locate(parsed, ancestor.file, ancestor);
    if (!container) continue;
    const candidates = findUsages(parsed, component).filter((usage) => contains(container.element, usage.element));
    if (candidates.length >= 1) return { ...candidates[0]!, file: ancestor.file };
  }
  // 3. Usages in the same file, then anywhere in src/ when there is exactly one.
  const own = ctx.project.parsed(file);
  if (own) {
    const candidates = findUsages(own, component);
    if (candidates.length >= 1) return { ...candidates[0]!, file };
  }
  const everywhere: { element: t.JSXElement; ancestors: Path; file: string }[] = [];
  for (const other of ctx.project.listSourceFiles()) {
    if (other === file) continue;
    const text = ctx.project.read(other) ?? "";
    if (!text.includes(`<${component}`)) continue;
    const parsed = ctx.project.parsed(other);
    if (!parsed) continue;
    for (const usage of findUsages(parsed, component)) everywhere.push({ ...usage, file: other });
  }
  return everywhere.length === 1 ? everywhere[0]! : null;
}

function usageName(element: t.JSXElement): string | null {
  const name = element.openingElement.name;
  return t.isJSXIdentifier(name) ? name.name : null;
}

/**
 * `copy.text("hero", "title")` where `copy = usePageCopy("home")`: look through the hook
 * for the object literal its methods read from, and index it by the call's strings.
 */
function lookupThroughCall(base: Extract<Traced, { kind: "call" }>, method: string, args: t.CallExpression["arguments"], ctx: TraceContext): Traced {
  const stringArgs = args.map((argument) => literalString(argument as Node));
  if (stringArgs.some((value) => value === null)) return blocked("code", `The "${method}" lookup uses values worked out by code, so what it shows could not be traced.`);
  const hookArgs = base.args.map((argument) => literalString(argument as Node)).filter((value): value is string => value !== null);
  const methodBody = findMethod(base.fn, method);
  const bodyStrings = new Set<string>();
  if (methodBody) {
    walk(methodBody, (node) => {
      if (t.isStringLiteral(node)) bodyStrings.add(node.value);
    });
  }
  const keyPaths: string[][] = [[...hookArgs, ...(stringArgs as string[])], ...Array.from(bodyStrings).map((key) => [key, ...(stringArgs as string[])])];
  const dbNote = moduleTouchesLiveData(ctx.project, base.fnFile) ? "The site can also load this from its database when the page opens; what you edit here is the version written in the code, which the site shows until a database entry replaces it." : undefined;

  for (const candidate of dataObjectsOf(base.fnFile, ctx.project)) {
    for (const keys of keyPaths) {
      const found = indexInto(candidate.node, keys);
      if (found) {
        const result = trace(found, [], candidate.file, ctx);
        if (result.kind === "string" || result.kind === "object" || result.kind === "array") {
          result.inData = candidate.name;
          if (dbNote) result.dbNote = dbNote;
        }
        return result;
      }
    }
  }
  if (functionTouchesLiveData(base.fn, base.ancestors)) return blocked("live-data", LIVE_DATA_MESSAGE);
  return blocked("code", `This comes from "${method}" in ${base.fnFile.split("/").pop() ?? base.fnFile}, and the value it returns could not be traced to a literal in the code.`);
}

/** Does the function fetch, query or keep state? Then what it returns is live data. */
export function functionTouchesLiveData(fn: t.Function, ancestors: Path): boolean {
  let found = false;
  walk(fn, (node, inner) => {
    if (found) return false;
    if (t.isCallExpression(node) && isLiveDataCall(node, [...ancestors, ...inner])) found = true;
    return !found;
  });
  return found;
}

function findMethod(fn: t.Function, method: string): Node | null {
  let returned: t.ObjectExpression | null = null;
  const body = fn.body;
  if (t.isObjectExpression(body)) returned = body;
  else if (t.isBlockStatement(body)) {
    for (const statement of body.body) {
      if (t.isReturnStatement(statement) && statement.argument && t.isObjectExpression(unwrap(statement.argument))) returned = unwrap(statement.argument) as t.ObjectExpression;
    }
  }
  if (!returned) return null;
  for (const property of returned.properties) {
    if (t.isObjectProperty(property) && t.isIdentifier(property.key) && property.key.name === method) return property.value;
    if (t.isObjectMethod(property) && t.isIdentifier(property.key) && property.key.name === method) return property.body;
  }
  return null;
}

/** Object literals a module can read from: its own top-level consts and the ones it imports. */
function dataObjectsOf(file: string, project: Project): { name: string; node: t.ObjectExpression; file: string }[] {
  const parsed = project.parsed(file);
  if (!parsed) return [];
  const out: { name: string; node: t.ObjectExpression; file: string }[] = [];
  for (const statement of parsed.ast.program.body) {
    const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (t.isVariableDeclaration(declaration)) {
      for (const declarator of declaration.declarations) {
        const init = declarator.init ? unwrap(declarator.init) : null;
        if (t.isIdentifier(declarator.id) && init && t.isObjectExpression(init)) out.push({ name: declarator.id.name, node: init, file });
      }
    }
    if (t.isImportDeclaration(statement)) {
      const target = project.resolveImport(file, statement.source.value);
      if (!target) continue;
      for (const specifier of statement.specifiers) {
        const imported = t.isImportSpecifier(specifier) ? (t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value) : t.isImportDefaultSpecifier(specifier) ? "default" : null;
        if (!imported) continue;
        const exported = findExport(project, target, imported);
        const node = exported ? unwrap(exported.node) : null;
        if (node && t.isObjectExpression(node)) out.push({ name: specifier.local.name, node, file: target });
      }
    }
  }
  return out;
}

function indexInto(node: Node, keys: string[]): Node | null {
  let current: Node = unwrap(node);
  for (const key of keys) {
    if (t.isObjectExpression(current)) {
      const next = objectProperty(current, key);
      if (!next) return null;
      current = unwrap(next);
    } else if (t.isArrayExpression(current) && /^\d+$/.test(key)) {
      const next = current.elements[Number(key)];
      if (!next || t.isSpreadElement(next)) return null;
      current = unwrap(next);
    } else {
      return null;
    }
  }
  return current;
}

/** The nearest enclosing `.map` callback's array, for "the items inside come from…" notes. */
export function mapSourceOf(expression: Node, ancestors: Path, file: string, ctx: TraceContext): Traced | null {
  const call = unwrap(expression);
  if (!t.isCallExpression(call)) return null;
  const callee = unwrap(call.callee);
  if (!(t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee))) return null;
  const name = memberName(callee);
  if (name !== "map" && name !== "flatMap") return null;
  return trace(callee.object, [...ancestors, call, callee], file, ctx);
}

export { enclosingFunction };
