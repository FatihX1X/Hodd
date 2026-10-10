import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/test/fixtures";

const fake = vi.hoisted(() => ({ revision: 4, upserts: [] as Record<string, unknown>[], conflict: false }));
vi.mock("./client", () => ({ createSupabaseBrowserClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table.includes("workspaces") ? { workspace: initialWorkspace, revision: fake.revision } : null, error: null }) }) }),
    upsert: (row: Record<string, unknown>) => { fake.upserts.push(row); return { select: () => ({ single: async () => fake.conflict ? { data: null, error: { code: "40001", message: "workspace revision conflict" } } : { data: { revision: Number(row.revision) + 1 }, error: null } }) }; },
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}) }));
import { cloudWorkspaceRevision, isRevisionConflict, knownWorkspaceRevision, loadCloudWorkspace, syncWorkspaceToCloud } from "./workspace-sync";

beforeEach(() => { fake.revision = 4; fake.upserts = []; fake.conflict = false; });

describe("workspace revision tracking", () => {
  it("sends the revision it last saw and advances after a successful write", async () => {
    await loadCloudWorkspace("user-1", "TREASURY");
    expect(knownWorkspaceRevision("user-1", "TREASURY")).toBe(4);
    await syncWorkspaceToCloud(initialWorkspace, "user-1", "TREASURY");
    expect(fake.upserts[0]).toMatchObject({ user_id: "user-1", revision: 4 });
    expect(knownWorkspaceRevision("user-1", "TREASURY")).toBe(5);
    expect(await cloudWorkspaceRevision("user-1", "TREASURY")).toBe(4);
  });
  it("surfaces a stale-copy conflict instead of overwriting", async () => {
    await loadCloudWorkspace("user-1", "SMOKE_TEST");
    fake.conflict = true;
    const error = await syncWorkspaceToCloud(initialWorkspace, "user-1", "SMOKE_TEST").catch((caught: unknown) => caught);
    expect(isRevisionConflict(error)).toBe(true);
    expect(isRevisionConflict(new Error("network"))).toBe(false);
  });
});
