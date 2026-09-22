/** The demo site must always be a valid, connectable site. */
import { describe, expect, it } from "vitest";
import { validateContentTree } from "../../shared/contentValidation.ts";
import { validateSiteSchema } from "../../shared/schema.ts";
import content from "./content/pages.json";
import schema from "./content/schema.json";

describe("examples/demo-site", () => {
  it("follows the site contract", () => {
    const report = validateSiteSchema(schema);
    expect(report.errors).toEqual([]);
    expect(report.schema).toBeDefined();
    const contentReport = validateContentTree(content, report.schema!.pages);
    expect(contentReport.errors).toEqual([]);
    expect(contentReport.warnings).toEqual([]);
  });
});
