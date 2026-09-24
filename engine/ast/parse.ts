/**
 * Parsing and printing with recast (formatting-preserving) over Babel's TypeScript+JSX
 * parser, plus a small walker with ancestor tracking and the binding lookups the tracer
 * needs. No @babel/traverse: its scope machinery expects a full program transform and
 * its CommonJS interop differs between Node, Vite and Vitest.
 */
import * as t from "@babel/types";
import * as recast from "recast";
import * as babelTs from "recast/parsers/babel-ts.js";

export type Node = t.Node;

export type ParsedFile = { ast: t.File; code: string };

export function parseSource(code: string): ParsedFile {
  const ast = recast.parse(code, { parser: babelTs }) as t.File;
  return { ast, code };
}

export function printSource(ast: t.File): string {
  return recast.print(ast, { quote: "double", wrapColumn: 400 }).code;
}

/** Ancestors of the current node, nearest last. */
export type Path = Node[];

/** Visit every node with its ancestor chain. Return false from the visitor to skip the subtree. */
export function walk(root: Node, visitor: (node: Node, ancestors: Path) => boolean | void, ancestors: Path = []): void {
  const keys = (t.VISITOR_KEYS as Record<string, string[] | undefined>)[root.type] ?? [];
  const next = [...ancestors, root];
  for (const key of keys) {
    const value = (root as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof (child as Node).type === "string") {
          if (visitor(child as Node, next) !== false) walk(child as Node, visitor, next);
        }
      }
    } else if (value && typeof (value as Node).type === "string") {
      if (visitor(value as Node, next) !== false) walk(value as Node, visitor, next);
    }
  }
}

export function line(node: Node): number {
  return node.loc?.start.line ?? 0;
}
export function col(node: Node): number {
  return node.loc?.start.column ?? 0;
}

/** The name of a JSX element ("div", "Button", "Foo.Bar"), or null for fragments. */
export function jsxName(node: t.JSXElement): string | null {
  const name = node.openingElement.name;
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    const parts: string[] = [];
    let current: t.JSXMemberExpression | t.JSXIdentifier = name;
    while (t.isJSXMemberExpression(current)) {
      parts.unshift(current.property.name);
      current = current.object;
    }
    parts.unshift(current.name);
    return parts.join(".");
  }
  return null;
}

/** An intrinsic element renders a DOM node itself: its name starts lower-case and has no dot. */
export function isIntrinsic(name: string | null): boolean {
  return !!name && /^[a-z]/.test(name) && !name.includes(".");
}

export function getAttribute(node: t.JSXElement, name: string): t.JSXAttribute | undefined {
  for (const attribute of node.openingElement.attributes) {
    if (t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name) && attribute.name.name === name) return attribute;
  }
  return undefined;
}

export function hasSpreadAttribute(node: t.JSXElement): boolean {
  return node.openingElement.attributes.some((attribute) => t.isJSXSpreadAttribute(attribute));
}

/** The nearest enclosing function (component, callback) of a node. */
export function enclosingFunction(ancestors: Path): t.Function | undefined {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (node && t.isFunction(node)) return node;
  }
  return undefined;
}

/** The name of the React component a node belongs to: the enclosing function's name, or the variable it is assigned to. */
export function componentName(ancestors: Path): string | null {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (!node) continue;
    if (t.isFunctionDeclaration(node) && node.id) return node.id.name;
    if ((t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) && index > 0) {
      const parent = ancestors[index - 1];
      if (parent && t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) return parent.id.name;
      if (parent && t.isCallExpression(parent)) {
        // forwardRef(function Name...) / memo(() => ...) assigned to a const.
        const grand = ancestors[index - 2];
        if (grand && t.isVariableDeclarator(grand) && t.isIdentifier(grand.id)) return grand.id.name;
      }
      if (t.isFunctionExpression(node) && node.id) return node.id.name;
    }
    if (t.isExportDefaultDeclaration(node) && t.isFunctionDeclaration(node.declaration) && node.declaration.id) return node.declaration.id.name;
  }
  return null;
}

/** The function is the first argument of `something.map(...)`. Returns the array expression. */
export function mapCallOf(fn: t.Function, ancestors: Path): t.Expression | null {
  const parent = ancestors[ancestors.length - 1];
  if (!parent || !t.isCallExpression(parent) || parent.arguments[0] !== fn) return null;
  const callee = parent.callee;
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property) && (callee.property.name === "map" || callee.property.name === "flatMap")) {
    return callee.object;
  }
  return null;
}

export type Binding =
  | { kind: "const"; declarator: t.VariableDeclarator; init: t.Expression | null; ancestors: Path }
  | { kind: "param"; fn: t.Function; index: number; ancestors: Path; /** Destructured object property name when the param is a pattern. */ property?: string }
  | { kind: "import"; source: string; imported: string; declaration: t.ImportDeclaration }
  | { kind: "function"; declaration: t.FunctionDeclaration; ancestors: Path };

function bindingInPattern(pattern: t.LVal | t.PatternLike, name: string): { found: boolean; property?: string } {
  if (t.isIdentifier(pattern)) return { found: pattern.name === name };
  if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (t.isRestElement(property)) {
        if (t.isIdentifier(property.argument) && property.argument.name === name) return { found: true };
        continue;
      }
      const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : undefined;
      const value = t.isAssignmentPattern(property.value) ? property.value.left : property.value;
      if (t.isIdentifier(value) && value.name === name) return { found: true, property: key };
      if (t.isObjectPattern(value) || t.isArrayPattern(value)) {
        const inner = bindingInPattern(value, name);
        if (inner.found) return { found: true, property: key };
      }
    }
    return { found: false };
  }
  if (t.isArrayPattern(pattern)) {
    for (const element of pattern.elements) {
      if (!element) continue;
      const target = t.isAssignmentPattern(element) ? element.left : element;
      if (t.isRestElement(target)) {
        if (t.isIdentifier(target.argument) && target.argument.name === name) return { found: true };
        continue;
      }
      const inner = bindingInPattern(target, name);
      if (inner.found) return { found: true };
    }
    return { found: false };
  }
  if (t.isAssignmentPattern(pattern)) return bindingInPattern(pattern.left, name);
  return { found: false };
}

/** Where `name`, used at the end of `ancestors`, is declared. Walks outwards through functions and blocks to the module. */
export function resolveBinding(name: string, ancestors: Path): Binding | null {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (!node) continue;
    if (t.isFunction(node)) {
      for (let p = 0; p < node.params.length; p += 1) {
        const param = node.params[p];
        if (!param) continue;
        const target = t.isTSParameterProperty(param) ? param.parameter : param;
        const match = bindingInPattern(target as t.LVal, name);
        if (match.found) {
          const result: Binding = { kind: "param", fn: node, index: p, ancestors: ancestors.slice(0, index) };
          if (match.property) result.property = match.property;
          return result;
        }
      }
      if (t.isFunctionDeclaration(node) && node.id?.name === name) return { kind: "function", declaration: node, ancestors: ancestors.slice(0, index) };
    }
    const body: Node[] | null = t.isProgram(node) ? node.body : t.isBlockStatement(node) ? node.body : null;
    if (body) {
      for (const statement of body) {
        const declaration = t.isExportNamedDeclaration(statement) || t.isExportDefaultDeclaration(statement) ? statement.declaration : statement;
        if (t.isVariableDeclaration(declaration)) {
          for (const declarator of declaration.declarations) {
            if (bindingInPattern(declarator.id, name).found) {
              return { kind: "const", declarator, init: declarator.init ?? null, ancestors: [...ancestors.slice(0, index + 1), declaration] };
            }
          }
        } else if (t.isFunctionDeclaration(declaration) && declaration.id?.name === name) {
          return { kind: "function", declaration, ancestors: ancestors.slice(0, index + 1) };
        } else if (t.isImportDeclaration(statement)) {
          for (const specifier of statement.specifiers) {
            if (specifier.local.name !== name) continue;
            const imported = t.isImportSpecifier(specifier) ? (t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value) : t.isImportDefaultSpecifier(specifier) ? "default" : "*";
            return { kind: "import", source: statement.source.value, imported, declaration: statement };
          }
        }
      }
    }
  }
  return null;
}

/** The property name of a non-computed member access, or the string of a computed literal one. */
export function memberName(node: t.MemberExpression | t.OptionalMemberExpression): string | null {
  if (!node.computed && t.isIdentifier(node.property)) return node.property.name;
  if (node.computed && t.isStringLiteral(node.property)) return node.property.value;
  return null;
}

/** A literal string value from a string literal or a template literal without expressions. */
export function literalString(node: Node | null | undefined): string | null {
  if (!node) return null;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
  if (t.isJSXExpressionContainer(node)) return literalString(node.expression);
  return null;
}

/** JSX element children only (text and expressions are not elements). */
export function elementChildren(node: t.JSXElement | t.JSXFragment): t.JSXElement[] {
  return node.children.filter((child): child is t.JSXElement => t.isJSXElement(child));
}
