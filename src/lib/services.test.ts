import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, inputToCents } from "./money.ts";
import { daysUntil, emptyServices, renewalState, siteStatusLabel, yearlyTotalCents, yearlyTotalSummary } from "./services.ts";

describe("money", () => {
  it("formats whole dollars without cents and odd amounts with them", () => {
    expect(formatCents(32000)).toBe("$320");
    expect(formatCents(1850)).toBe("$18.50");
    expect(formatCents(null)).toBe("—");
  });

  it("round-trips a dollars input", () => {
    expect(inputToCents("320")).toBe(32000);
    expect(inputToCents("$1,200.50")).toBe(120050);
    expect(inputToCents("")).toBeNull();
    expect(inputToCents("abc")).toBeUndefined();
    expect(centsToInput(32000)).toBe("320");
    expect(centsToInput(1850)).toBe("18.50");
    expect(centsToInput(null)).toBe("");
  });
});

describe("yearly total", () => {
  const base = emptyServices("s1");

  it("adds hosting, domain and flat email", () => {
    expect(yearlyTotalCents({ ...base, hosting_annual_fee_cents: 20000, domain_annual_fee_cents: 1800, email_pricing: "flat", email_annual_fee_cents: 6000 })).toBe(27800);
  });

  it("multiplies a per-mailbox price by the mailbox count", () => {
    const services = { ...base, hosting_annual_fee_cents: 20000, email_pricing: "per_mailbox" as const, email_annual_fee_cents: 3000, email_mailboxes: 4 };
    expect(yearlyTotalCents(services)).toBe(32000);
    expect(yearlyTotalSummary(services)).toBe("$200 hosting + 4 mailboxes × $30 = $320 / year");
  });

  it("says so when nothing is billed", () => {
    expect(yearlyTotalSummary(base)).toBe("Nothing billed yet: $0 / year");
  });
});

describe("renewals", () => {
  const today = new Date(2026, 8, 22);

  it("counts whole days", () => {
    expect(daysUntil("2026-09-22", today)).toBe(0);
    expect(daysUntil("2026-10-02", today)).toBe(10);
    expect(daysUntil("2026-09-19", today)).toBe(-3);
  });

  it("prefers the next future renewal and flags soon or past", () => {
    expect(renewalState("2026-10-02", null, today)).toEqual({ date: "2026-10-02", days: 10, state: "soon" });
    expect(renewalState("2027-01-15", null, today)?.state).toBe("later");
    expect(renewalState(null, "2026-09-19", today)).toEqual({ date: "2026-09-19", days: -3, state: "past" });
    expect(renewalState(null, null, today)).toBeNull();
  });
});

describe("site status label", () => {
  it("maps hosting-only, attention, onboarding and live", () => {
    expect(siteStatusLabel({ status: "hosting_only", last_published_at: null })).toBe("Hosting only");
    expect(siteStatusLabel({ status: "needs_attention", last_published_at: "2026-09-01" })).toBe("Needs attention");
    expect(siteStatusLabel({ status: "connected", last_published_at: null })).toBe("Onboarding");
    expect(siteStatusLabel({ status: "connected", last_published_at: "2026-09-01" })).toBe("Live");
  });
});
