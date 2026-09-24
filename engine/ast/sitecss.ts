/**
 * A light index of the site's own stylesheets: which class names set which properties.
 * Used to decide when a Tailwind class needs the important modifier to beat a site
 * rule for the same property, and to read the site's breakpoints and CSS variables.
 */
import type { Project } from "./project.ts";

export type CssIndex = { classProperties: Map<string, Set<string>>; variables: Record<string, string>; files: string[] };

export function listCssFiles(project: Project): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of project.readdir(rel)) {
      if (name === "node_modules" || name.startsWith(".") || name === "dist" || name === "build") continue;
      const child = rel ? `${rel}/${name}` : name;
      if (project.isDirectory(child)) walk(child);
      else if (/\.css$/.test(name)) out.push(child);
    }
  };
  walk("src");
  walk("app");
  walk("styles");
  for (const name of ["index.css", "app.css", "global.css", "globals.css"]) if (project.exists(name)) out.push(name);
  return out;
}

export function indexSiteCss(project: Project): CssIndex {
  const classProperties = new Map<string, Set<string>>();
  const variables: Record<string, string> = {};
  const files = listCssFiles(project);
  for (const file of files) {
    const css = project.read(file) ?? "";
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1] ?? "";
      const body = match[2] ?? "";
      if (selectors.trim().startsWith("@")) continue;
      const properties = new Set<string>();
      for (const declaration of body.split(";")) {
        const index = declaration.indexOf(":");
        if (index === -1) continue;
        const property = declaration.slice(0, index).trim();
        const value = declaration.slice(index + 1).trim();
        if (property.startsWith("--") && /:root|html|body/.test(selectors)) variables[property] = value;
        properties.add(property);
      }
      for (const selector of selectors.split(",")) {
        // The last class in the selector is the element the rule styles.
        const classes = selector.match(/\.([a-zA-Z_][\w-]*)/g);
        const last = classes?.[classes.length - 1]?.slice(1);
        if (!last) continue;
        const set = classProperties.get(last) ?? new Set<string>();
        for (const property of properties) set.add(property);
        classProperties.set(last, set);
      }
    }
  }
  return { classProperties, variables, files };
}

const SHORTHANDS: Record<string, string[]> = {
  "padding-top": ["padding"],
  "padding-right": ["padding"],
  "padding-bottom": ["padding"],
  "padding-left": ["padding"],
  "padding-x": ["padding", "padding-left", "padding-right"],
  "padding-y": ["padding", "padding-top", "padding-bottom"],
  "margin-x": ["margin", "margin-left", "margin-right"],
  "margin-y": ["margin", "margin-top", "margin-bottom"],
  "margin-top": ["margin"],
  "margin-right": ["margin"],
  "margin-bottom": ["margin"],
  "margin-left": ["margin"],
  "background-color": ["background"],
  "border-width": ["border"],
  "border-color": ["border"],
  "border-style": ["border"],
  "column-gap": ["gap"],
  "row-gap": ["gap"],
  "font-size": ["font"],
  "font-weight": ["font"],
  "line-height": ["font"],
  "font-family": ["font"],
};

/** Does one of the element's own (non-Tailwind) classes set this property in the site's CSS? */
export function siteCssSets(index: CssIndex, classes: string[], property: string): boolean {
  const candidates = [property, ...(SHORTHANDS[property] ?? [])];
  return classes.some((className) => {
    const properties = index.classProperties.get(className);
    return !!properties && candidates.some((candidate) => properties.has(candidate));
  });
}
