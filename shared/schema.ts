/**
 * The editable-field map a site publishes as content/schema.json.
 *
 * Same shape as the pilot's PageDefinition[] (pages -> sections -> fields), wrapped in
 * an object that carries the contract version:
 *
 *   { "armatureContract": 1, "pages": [ ...PageDefinition ] }
 *
 * Pure module: types, lookups and the schema validator. No I/O.
 */

export const ARMATURE_CONTRACT_VERSION = 1 as const;

/** Repo-relative paths every connectable site must have. */
export const SCHEMA_PATH = "content/schema.json";

/** The slug reserved for site-wide header/footer content. */
export const SHARED_SLUG = "shared";

export type FieldType = "text" | "textarea" | "image" | "video" | "url" | "link" | "list";

/** The subset of field types allowed inside a list item. */
export type ItemFieldType = "text" | "textarea" | "image" | "url";

export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "textarea",
  "image",
  "video",
  "url",
  "link",
  "list",
];

export const ITEM_FIELD_TYPES: readonly ItemFieldType[] = ["text", "textarea", "image", "url"];

export type ItemField = {
  key: string;
  label: string;
  type: ItemFieldType;
};

export type PageField = {
  key: string;
  label: string;
  type: FieldType;
  /** For list fields: the shape of each repeatable item. */
  itemFields?: ItemField[];
  /** Optional one-line hint shown under the field in the editor. */
  help?: string;
};

export type PageSection = {
  key: string;
  label: string;
  fields: PageField[];
};

export type PageDefinition = {
  slug: string;
  label: string;
  /** Live path of the page on the site, used for the "View live page" link. */
  path: string;
  description?: string;
  sections: PageSection[];
};

export type SiteSchema = {
  armatureContract: typeof ARMATURE_CONTRACT_VERSION;
  pages: PageDefinition[];
};

export const getPageDefinition = (
  pages: readonly PageDefinition[],
  slug: string,
): PageDefinition | undefined => pages.find((page) => page.slug === slug);

/** Slugs: lowercase letters, digits and hyphens, starting with a letter or digit. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Section and field keys: lowercase letters, digits and underscores. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const describe = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
};

export type SchemaReport = {
  errors: string[];
  warnings: string[];
  /** The parsed schema, present only when there are no errors. */
  schema?: SiteSchema;
};

/**
 * Validate a parsed content/schema.json. Errors mean the site cannot be connected;
 * warnings are advice (for example, a missing "shared" page).
 */
export function validateSiteSchema(raw: unknown): SchemaReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(raw)) {
    return { errors: [`${SCHEMA_PATH} must be a JSON object, got ${describe(raw)}`], warnings };
  }

  if (raw["armatureContract"] !== ARMATURE_CONTRACT_VERSION) {
    errors.push(
      `${SCHEMA_PATH}: "armatureContract" must be the number ${ARMATURE_CONTRACT_VERSION}, got ${JSON.stringify(raw["armatureContract"])}`,
    );
  }

  const pages = raw["pages"];
  if (!Array.isArray(pages)) {
    errors.push(`${SCHEMA_PATH}: "pages" must be an array, got ${describe(pages)}`);
    return { errors, warnings };
  }
  if (pages.length === 0) {
    errors.push(`${SCHEMA_PATH}: "pages" is empty — declare at least one page`);
  }

  const slugs = new Set<string>();
  pages.forEach((page, pageIndex) => {
    const at = `pages[${pageIndex}]`;
    if (!isObject(page)) {
      errors.push(`${at}: must be an object, got ${describe(page)}`);
      return;
    }
    const slug = page["slug"];
    if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
      errors.push(
        `${at}: "slug" must be lowercase letters, digits and hyphens, got ${JSON.stringify(slug)}`,
      );
    } else if (slugs.has(slug)) {
      errors.push(`${at}: duplicate slug "${slug}"`);
    } else {
      slugs.add(slug);
    }
    const where = typeof slug === "string" ? slug : at;

    if (typeof page["label"] !== "string" || page["label"].trim() === "") {
      errors.push(`${where}: "label" must be a non-empty string`);
    }
    if (typeof page["path"] !== "string" || !page["path"].startsWith("/")) {
      errors.push(`${where}: "path" must be a string starting with "/"`);
    }
    if (page["description"] !== undefined && typeof page["description"] !== "string") {
      errors.push(`${where}: "description" must be a string when present`);
    }

    const sections = page["sections"];
    if (!Array.isArray(sections)) {
      errors.push(`${where}: "sections" must be an array, got ${describe(sections)}`);
      return;
    }
    if (sections.length === 0) warnings.push(`${where}: has no sections, so nothing is editable`);

    const sectionKeys = new Set<string>();
    sections.forEach((section, sectionIndex) => {
      const sectionAt = `${where}.sections[${sectionIndex}]`;
      if (!isObject(section)) {
        errors.push(`${sectionAt}: must be an object, got ${describe(section)}`);
        return;
      }
      const sectionKey = section["key"];
      if (typeof sectionKey !== "string" || !KEY_PATTERN.test(sectionKey)) {
        errors.push(
          `${sectionAt}: "key" must be lowercase letters, digits and underscores, got ${JSON.stringify(sectionKey)}`,
        );
      } else if (sectionKeys.has(sectionKey)) {
        errors.push(`${where}: duplicate section key "${sectionKey}"`);
      } else {
        sectionKeys.add(sectionKey);
      }
      const sectionWhere = typeof sectionKey === "string" ? `${where}.${sectionKey}` : sectionAt;

      if (typeof section["label"] !== "string" || section["label"].trim() === "") {
        errors.push(`${sectionWhere}: "label" must be a non-empty string`);
      }

      const fields = section["fields"];
      if (!Array.isArray(fields)) {
        errors.push(`${sectionWhere}: "fields" must be an array, got ${describe(fields)}`);
        return;
      }
      if (fields.length === 0) warnings.push(`${sectionWhere}: has no fields`);

      const fieldKeys = new Set<string>();
      fields.forEach((field, fieldIndex) => {
        const fieldAt = `${sectionWhere}.fields[${fieldIndex}]`;
        if (!isObject(field)) {
          errors.push(`${fieldAt}: must be an object, got ${describe(field)}`);
          return;
        }
        const fieldKey = field["key"];
        if (typeof fieldKey !== "string" || !KEY_PATTERN.test(fieldKey)) {
          errors.push(
            `${fieldAt}: "key" must be lowercase letters, digits and underscores, got ${JSON.stringify(fieldKey)}`,
          );
        } else if (fieldKeys.has(fieldKey)) {
          errors.push(`${sectionWhere}: duplicate field key "${fieldKey}"`);
        } else {
          fieldKeys.add(fieldKey);
        }
        const fieldWhere =
          typeof fieldKey === "string" ? `${sectionWhere}.${fieldKey}` : fieldAt;

        if (typeof field["label"] !== "string" || field["label"].trim() === "") {
          errors.push(`${fieldWhere}: "label" must be a non-empty string`);
        }
        const type = field["type"];
        if (typeof type !== "string" || !FIELD_TYPES.includes(type as FieldType)) {
          errors.push(
            `${fieldWhere}: "type" must be one of ${FIELD_TYPES.join(", ")}, got ${JSON.stringify(type)}`,
          );
          return;
        }
        if (field["help"] !== undefined && typeof field["help"] !== "string") {
          errors.push(`${fieldWhere}: "help" must be a string when present`);
        }

        const itemFields = field["itemFields"];
        if (type === "list") {
          if (!Array.isArray(itemFields) || itemFields.length === 0) {
            errors.push(`${fieldWhere}: a list field needs a non-empty "itemFields" array`);
            return;
          }
          const itemKeys = new Set<string>();
          itemFields.forEach((itemField, itemIndex) => {
            const itemAt = `${fieldWhere}.itemFields[${itemIndex}]`;
            if (!isObject(itemField)) {
              errors.push(`${itemAt}: must be an object, got ${describe(itemField)}`);
              return;
            }
            const itemKey = itemField["key"];
            if (typeof itemKey !== "string" || !KEY_PATTERN.test(itemKey)) {
              errors.push(`${itemAt}: "key" must be lowercase letters, digits and underscores`);
            } else if (itemKeys.has(itemKey)) {
              errors.push(`${fieldWhere}: duplicate item field key "${itemKey}"`);
            } else {
              itemKeys.add(itemKey);
            }
            if (typeof itemField["label"] !== "string" || itemField["label"].trim() === "") {
              errors.push(`${itemAt}: "label" must be a non-empty string`);
            }
            const itemType = itemField["type"];
            if (
              typeof itemType !== "string" ||
              !ITEM_FIELD_TYPES.includes(itemType as ItemFieldType)
            ) {
              errors.push(
                `${itemAt}: "type" must be one of ${ITEM_FIELD_TYPES.join(", ")}, got ${JSON.stringify(itemType)}`,
              );
            }
          });
        } else if (itemFields !== undefined) {
          errors.push(`${fieldWhere}: only list fields may declare "itemFields"`);
        }
      });
    });
  });

  if (!slugs.has(SHARED_SLUG)) {
    warnings.push(
      `${SCHEMA_PATH}: no "${SHARED_SLUG}" page — header and footer content will not be editable`,
    );
  }

  if (errors.length > 0) return { errors, warnings };
  return { errors, warnings, schema: raw as unknown as SiteSchema };
}
