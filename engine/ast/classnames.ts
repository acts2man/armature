/**
 * Writing a className back onto a JSX element: a string literal is replaced, a template
 * literal keeps its dynamic parts and gets the static classes rewritten, a cn()/clsx()
 * call keeps its arguments and gets the new static classes as its literal arguments, and
 * anything else is wrapped in a template literal so the original expression survives.
 */
import * as t from "@babel/types";
import { getAttribute, literalString, type Node } from "./parse.ts";
import { setStringLiteral } from "./text.ts";
import type { ParsedFile } from "./parse.ts";

/** The static classes currently written on the element (dynamic parts ignored). */
export function staticClassName(element: t.JSXElement): string {
  const attribute = getAttribute(element, "className") ?? getAttribute(element, "class");
  if (!attribute?.value) return "";
  const literal = literalString(attribute.value);
  if (literal !== null) return literal;
  if (t.isJSXExpressionContainer(attribute.value)) {
    const expression = attribute.value.expression;
    if (t.isTemplateLiteral(expression)) return expression.quasis.map((quasi) => quasi.value.cooked ?? "").join(" ").replace(/\s+/g, " ").trim();
    if (t.isCallExpression(expression)) return expression.arguments.map((argument) => literalString(argument as Node) ?? "").join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * Replace the static classes with `className` (the merged result), keeping any dynamic
 * parts of the attribute's expression.
 */
export function writeClassName(parsed: ParsedFile, element: t.JSXElement, className: string): void {
  const attribute = getAttribute(element, "className") ?? getAttribute(element, "class");
  const trimmed = className.trim();
  if (!attribute) {
    if (!trimmed) return;
    element.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier("className"), t.stringLiteral(trimmed)));
    return;
  }
  const value = attribute.value;
  if (!value || t.isStringLiteral(value)) {
    if (value) setStringLiteral(parsed, value, trimmed);
    else attribute.value = t.stringLiteral(trimmed);
    return;
  }
  if (t.isJSXExpressionContainer(value)) {
    const expression = value.expression;
    if (t.isStringLiteral(expression) || (t.isTemplateLiteral(expression) && expression.expressions.length === 0)) {
      setStringLiteral(parsed, expression, trimmed);
      return;
    }
    if (t.isTemplateLiteral(expression)) {
      // All static text moves into the first quasi; the others keep single spaces around the expressions.
      const quasis = expression.quasis;
      quasis.forEach((quasi, index) => {
        const raw = index === 0 ? `${trimmed} ` : index === quasis.length - 1 ? "" : " ";
        quasi.value = { raw, cooked: raw };
        (quasi as unknown as { original?: unknown }).original = undefined;
      });
      (expression as unknown as { original?: unknown }).original = undefined;
      return;
    }
    if (t.isCallExpression(expression)) {
      const dynamic = expression.arguments.filter((argument) => literalString(argument as Node) === null);
      expression.arguments = trimmed ? [t.stringLiteral(trimmed), ...dynamic] : dynamic;
      return;
    }
    // An identifier, a conditional, a member expression: keep it and add the classes around it.
    value.expression = t.templateLiteral([t.templateElement({ raw: `${trimmed} `, cooked: `${trimmed} ` }, false), t.templateElement({ raw: "", cooked: "" }, true)], [expression]);
  }
}
