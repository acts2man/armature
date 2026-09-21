/**
 * Validation for content/pages.json, in two layers.
 *
 * 1. `validateContentTree` — the whole-file shape check against a site's schema. The
 *    site-connect check runs it on the repo's file, and the publish path re-runs it on
 *    the merged result before committing, so a publish can never write a file the
 *    check would reject.
 * 2. `validateFieldUpdate` — the stricter per-field check applied to values coming
 *    from the editor: the field must be declared in the schema, its type must match,
 *    text has length limits, link targets are restricted to a safe set of schemes, and
 *    image fields must point inside /assets/.
 *
 * Pure module: no filesystem, no network, no secrets. Ported from the pilot; the only
 * change is that the schema is passed in instead of being a module-level constant,
 * because every site has its own.
 */
import { getPageDefinition, type PageDefinition, type PageField } from "./schema.ts";
import { isPlainObject, type ContentValue } from "./contentFile.ts";

/**
 * Length and count ceilings for values arriving from the editor. Set well above what
 * real site copy needs, while still bounding what a compromised or buggy client can
 * commit.
 */
export const LIMITS = {
  text: 300,
  textarea: 5000,
  url: 2000,
  listItems: 100,
} as const;

/** Schemes an editable link or URL may use, besides a site-relative path. */
const ALLOWED_SCHEMES = ["https://", "http://", "mailto:", "tel:"] as const;

/**
 * True for a site-relative path or one of the allowed schemes. Empty is allowed so a
 * field can be cleared. Protocol-relative `//host` is rejected, as is `javascript:`
 * and anything else not on the list.
 */
export function isAllowedLinkTarget(value: string): boolean {
  if (value === "") return true;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  const lowered = value.toLowerCase();
  return ALLOWED_SCHEMES.some((scheme) => lowered.startsWith(scheme));
}

/** Image fields must reference a file inside the site's own /assets/ directory. */
export function isAllowedImagePath(value: string): boolean {
  if (value === "") return true;
  if (!value.startsWith("/assets/")) return false;
  return !value.includes("..");
}

const describe = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
};

// ---------------------------------------------------------------------------
// Layer 1: whole-file shape check
// ---------------------------------------------------------------------------

export type ContentTreeReport = {
  errors: string[];
  warnings: string[];
  /** Number of schema-declared fields inspected. */
  checked: number;
};

/** Check one field's value against its declared type, collecting messages. */
function checkFieldShape(
  where: string,
  field: PageField,
  value: unknown,
  errors: string[],
  warnings: string[],
): void {
  switch (field.type) {
    case "text":
    case "textarea":
    case "image":
    case "video":
    case "url": {
      if (typeof value !== "string") {
        errors.push(`${where}: expected a string for type "${field.type}", got ${describe(value)}`);
      }
      return;
    }
    case "link": {
      if (!isPlainObject(value)) {
        errors.push(`${where}: expected { label, href } for type "link", got ${describe(value)}`);
        return;
      }
      for (const key of ["label", "href"]) {
        if (!(key in value)) errors.push(`${where}: link is missing "${key}"`);
        else if (typeof value[key] !== "string") {
          errors.push(`${where}: link "${key}" must be a string, got ${describe(value[key])}`);
        }
      }
      return;
    }
    case "list": {
      if (!Array.isArray(value)) {
        errors.push(`${where}: expected an array for type "list", got ${describe(value)}`);
        return;
      }
      const itemFields = field.itemFields ?? [];
      const declared = new Set(itemFields.map((itemField) => itemField.key));
      value.forEach((item, index) => {
        const at = `${where}[${index}]`;
        if (!isPlainObject(item)) {
          errors.push(`${at}: list items must be objects, got ${describe(item)}`);
          return;
        }
        for (const itemField of itemFields) {
          if (!(itemField.key in item)) {
            errors.push(`${at}: missing "${itemField.key}"`);
          } else if (typeof item[itemField.key] !== "string") {
            errors.push(
              `${at}."${itemField.key}": must be a string, got ${describe(item[itemField.key])}`,
            );
          }
        }
        for (const key of Object.keys(item)) {
          if (!declared.has(key)) warnings.push(`${at}: "${key}" is not declared in the schema`);
        }
      });
      return;
    }
  }
}

/**
 * Validate a whole content tree against the schema. Errors mean a field the schema
 * declares is missing or misshapen; warnings mean content the schema does not declare,
 * which renders fine but the editor cannot reach.
 */
export function validateContentTree(
  content: unknown,
  pages: readonly PageDefinition[],
): ContentTreeReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let checked = 0;

  if (!isPlainObject(content)) {
    return { errors: ["content must be a JSON object"], warnings, checked };
  }

  const seen = new Set<string>();

  for (const page of pages) {
    const pageContent = content[page.slug];
    if (!isPlainObject(pageContent)) {
      errors.push(`${page.slug}: missing from the content file (or not an object)`);
      continue;
    }
    for (const section of page.sections) {
      const sectionContent = pageContent[section.key];
      if (!isPlainObject(sectionContent)) {
        errors.push(`${page.slug}.${section.key}: missing section (or not an object)`);
        continue;
      }
      for (const field of section.fields) {
        const where = `${page.slug}.${section.key}.${field.key}`;
        seen.add(where);
        checked += 1;
        if (!(field.key in sectionContent)) {
          errors.push(`${where}: missing from the content file`);
          continue;
        }
        checkFieldShape(where, field, sectionContent[field.key], errors, warnings);
      }
    }
  }

  // Reverse direction: content the schema does not declare.
  for (const [slug, sections] of Object.entries(content)) {
    if (!isPlainObject(sections)) continue;
    for (const [sectionKey, fields] of Object.entries(sections)) {
      if (!isPlainObject(fields)) continue;
      for (const fieldKey of Object.keys(fields)) {
        const where = `${slug}.${sectionKey}.${fieldKey}`;
        if (!seen.has(where)) {
          warnings.push(`${where}: present in the content file but not declared in the schema`);
        }
      }
    }
  }

  return { errors, warnings, checked };
}

// ---------------------------------------------------------------------------
// Layer 2: per-field check for values arriving from the editor
// ---------------------------------------------------------------------------

/** Apply the string rules for one declared field type. */
function checkStringValue(
  where: string,
  type: PageField["type"] | "text" | "textarea" | "image" | "url",
  value: string,
  errors: string[],
): void {
  if (type === "textarea") {
    if (value.length > LIMITS.textarea) {
      errors.push(`${where}: too long (${value.length} characters, limit ${LIMITS.textarea})`);
    }
    return;
  }

  if (type === "image") {
    if (value.length > LIMITS.url) {
      errors.push(`${where}: too long (${value.length} characters, limit ${LIMITS.url})`);
    } else if (!isAllowedImagePath(value)) {
      errors.push(`${where}: images must be a path under /assets/ — got "${value}"`);
    }
    return;
  }

  if (type === "url" || type === "video") {
    if (value.length > LIMITS.url) {
      errors.push(`${where}: too long (${value.length} characters, limit ${LIMITS.url})`);
    } else if (!isAllowedLinkTarget(value)) {
      errors.push(
        `${where}: must start with https://, http://, mailto:, tel: or "/" — got "${value}"`,
      );
    }
    return;
  }

  // "text"
  if (value.length > LIMITS.text) {
    errors.push(`${where}: too long (${value.length} characters, limit ${LIMITS.text})`);
  }
}

/**
 * Validate a single field update from the editor. Returns the declared field on
 * success so the caller can act on its type.
 */
export function validateFieldUpdate(
  pages: readonly PageDefinition[],
  slug: string,
  sectionKey: string,
  fieldKey: string,
  value: unknown,
): { errors: string[]; field?: PageField } {
  const errors: string[] = [];
  const where = `${slug}.${sectionKey}.${fieldKey}`;

  const page = getPageDefinition(pages, slug);
  if (!page) return { errors: [`${where}: "${slug}" is not a known page`] };

  const section = page.sections.find((item) => item.key === sectionKey);
  if (!section) return { errors: [`${where}: "${sectionKey}" is not a section of "${slug}"`] };

  const field = section.fields.find((item) => item.key === fieldKey);
  if (!field) return { errors: [`${where}: not a field declared in the site's schema`] };

  // Shape first — everything below assumes the shape holds.
  const warnings: string[] = [];
  checkFieldShape(where, field, value, errors, warnings);
  for (const warning of warnings) errors.push(`${warning} (unknown fields are not accepted)`);
  if (errors.length > 0) return { errors, field };

  switch (field.type) {
    case "text":
    case "textarea":
    case "image":
    case "video":
    case "url": {
      checkStringValue(where, field.type, value as string, errors);
      break;
    }
    case "link": {
      const link = value as { label: string; href: string };
      if (link.label.length > LIMITS.text) {
        errors.push(
          `${where}: label too long (${link.label.length} characters, limit ${LIMITS.text})`,
        );
      }
      if (link.href.length > LIMITS.url) {
        errors.push(`${where}: destination too long (limit ${LIMITS.url})`);
      } else if (!isAllowedLinkTarget(link.href)) {
        errors.push(
          `${where}: destination must start with https://, http://, mailto:, tel: or "/" — got "${link.href}"`,
        );
      }
      break;
    }
    case "list": {
      const list = value as Record<string, string>[];
      if (list.length > LIMITS.listItems) {
        errors.push(`${where}: too many items (${list.length}, limit ${LIMITS.listItems})`);
        break;
      }
      const itemFields = field.itemFields ?? [];
      list.forEach((item, index) => {
        for (const itemField of itemFields) {
          checkStringValue(
            `${where}[${index}]."${itemField.key}"`,
            itemField.type,
            item[itemField.key] ?? "",
            errors,
          );
        }
      });
      break;
    }
  }

  return { errors, field };
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Field keys ("section.field") of one page whose value differs between two content
 * trees. Used to tell whether a concurrent publish touched the same fields.
 */
export function changedFieldsForPage(
  pages: readonly PageDefinition[],
  slug: string,
  before: unknown,
  after: unknown,
): Set<string> {
  const changed = new Set<string>();
  const page = getPageDefinition(pages, slug);
  if (!page) return changed;

  const beforePage = isPlainObject(before) ? before[slug] : undefined;
  const afterPage = isPlainObject(after) ? after[slug] : undefined;

  for (const section of page.sections) {
    const beforeSection = isPlainObject(beforePage) ? beforePage[section.key] : undefined;
    const afterSection = isPlainObject(afterPage) ? afterPage[section.key] : undefined;
    for (const field of section.fields) {
      const a = isPlainObject(beforeSection) ? beforeSection[field.key] : undefined;
      const b = isPlainObject(afterSection) ? afterSection[field.key] : undefined;
      if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
        changed.add(`${section.key}.${field.key}`);
      }
    }
  }
  return changed;
}

/** Human label for a `section.field` key, for error messages shown to an editor. */
export function fieldLabel(
  pages: readonly PageDefinition[],
  slug: string,
  sectionKey: string,
  fieldKey: string,
): string {
  const page = getPageDefinition(pages, slug);
  const section = page?.sections.find((item) => item.key === sectionKey);
  const field = section?.fields.find((item) => item.key === fieldKey);
  if (!section || !field) return `${sectionKey}.${fieldKey}`;
  return `${section.label} → ${field.label}`;
}

export type { ContentValue };
