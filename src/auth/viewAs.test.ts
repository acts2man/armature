import { describe, expect, it } from "vitest";
import type { Site, SiteRole } from "@/lib/types.ts";
import { applyViewAs, readOnlyReason, readStoredViewAs, storeViewAs, type ViewAsClient } from "./viewAs.ts";

const site = (id: string): Site => ({ id, agency_id: "agency-1", name: `Site ${id}`, repo_owner: null, repo_name: null, branch: null, live_url: null, github_installation_id: null, status: "hosting_only", last_published_at: null, created_at: "2026-09-01T00:00:00Z" });

const staff = {
  agencies: [{ role: "owner" as const, agency: { id: "agency-1" } }],
  sites: [] as { site: Site; role: SiteRole }[],
  agencyRole: "owner" as const,
  isStaff: true,
  user: { id: "staff-1" },
};

const sam: ViewAsClient = { userId: "client-1", name: "Sam Alder", email: "sam@alderstone.example", sites: [{ site: site("a"), role: "client_owner" }, { site: site("b"), role: "client_editor" }] };

describe("applyViewAs", () => {
  it("leaves the state alone when no view is on", () => {
    expect(applyViewAs(staff, null)).toBe(staff);
  });

  it("reports the client's standing and sites, and nothing of the agency, while keeping everything else", () => {
    const viewed = applyViewAs(staff, sam);
    expect(viewed.isStaff).toBe(false);
    expect(viewed.agencies).toEqual([]);
    expect(viewed.agencyRole).toBeNull();
    expect(viewed.sites.map((entry) => entry.site.id)).toEqual(["a", "b"]);
    // The session itself is untouched: the staff member is still the signed-in person.
    expect(viewed.user).toBe(staff.user);
    expect(staff.isStaff).toBe(true);
  });
});

describe("the stored view", () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key), map };
  };

  it("round-trips through the tab's storage and forgets on null", () => {
    const storage = memory();
    storeViewAs({ staffId: "staff-1", client: sam }, storage);
    expect(readStoredViewAs(storage)).toEqual({ staffId: "staff-1", client: sam });
    storeViewAs(null, storage);
    expect(readStoredViewAs(storage)).toBeNull();
  });

  it("ignores what does not read back as a view, and storage that is missing or throws", () => {
    const storage = memory();
    storage.map.set("armature:view-as", "not json");
    expect(readStoredViewAs(storage)).toBeNull();
    storage.map.set("armature:view-as", JSON.stringify({ staffId: "staff-1", client: { ...sam, sites: [] } }));
    expect(readStoredViewAs(storage)).toBeNull();
    storage.map.set("armature:view-as", JSON.stringify({ client: sam }));
    expect(readStoredViewAs(storage)).toBeNull();
    expect(readStoredViewAs(null)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
    expect(readStoredViewAs(broken)).toBeNull();
    expect(() => storeViewAs({ staffId: "staff-1", client: sam }, broken)).not.toThrow();
  });
});

describe("readOnlyReason", () => {
  it("names the client and says how to leave", () => {
    const reason = readOnlyReason(sam);
    expect(reason).toContain("Sam Alder");
    expect(reason).toContain("Exit");
  });
});
