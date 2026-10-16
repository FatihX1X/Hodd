import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/test/fixtures";
import type { TreasuryWorkspace } from "@/lib/treasury/models";

// A tiny cloud: one row per user, a revision that every accepted write bumps, and the same conflict the trigger raises.
const cloud = vi.hoisted(() => ({ revision: 0, hasRow: false, upserts: [] as { revision: number; workspace: { updatedAt: string } }[], conflicts: 0, selects: 0, failNext: [] as unknown[], hold: Promise.resolve() as Promise<void> }));
vi.mock("./client", () => ({ createSupabaseBrowserClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => { cloud.selects++; return { data: cloud.hasRow ? { workspace: initialWorkspace, revision: cloud.revision } : null, error: null }; } }) }),
    upsert: (row: { revision: number; workspace: { updatedAt: string } }) => ({ select: () => ({ single: async () => {
      await cloud.hold;
      const failure = cloud.failNext.shift();
      if (failure) return { data: null, error: failure };
      cloud.upserts.push(row);
      if (row.revision !== cloud.revision) { cloud.conflicts++; return { data: null, error: { code: "PT409", message: "workspace revision conflict" } }; }
      cloud.revision++; cloud.hasRow = true;
      return { data: { revision: cloud.revision }, error: null };
    } }) }),
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}) }));
import { __resetWorkspaceSyncForTests, cloudWorkspaceRevision, isRevisionConflict, knownWorkspaceRevision, loadCloudWorkspace, refreshCloudLedger, syncWorkspaceToCloud } from "./workspace-sync";

const ws = (n: number): TreasuryWorkspace => ({ ...initialWorkspace, updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + n * 1000).toISOString() });
const settled = (promise: Promise<void>) => promise.then(() => "ok" as const, (error: unknown) => error);
beforeEach(() => { __resetWorkspaceSyncForTests(); Object.assign(cloud, { revision: 0, hasRow: false, upserts: [], conflicts: 0, selects: 0, failNext: [], hold: Promise.resolve() }); });
afterEach(() => { vi.useRealTimers(); });

describe("write coalescing", () => {
  it("sends at most two upserts for 50 rapid writes, the last content wins, and every caller settles", async () => {
    const calls = Array.from({ length: 50 }, (_, index) => syncWorkspaceToCloud(ws(index), "user-1"));
    expect(await Promise.all(calls.map(settled))).toEqual(Array(50).fill("ok"));
    expect(cloud.upserts.length).toBeLessThanOrEqual(2);
    expect(cloud.upserts.at(-1)?.workspace.updatedAt).toBe(ws(49).updatedAt);
    expect(cloud.conflicts).toBe(0);
  });
  it("rejects every superseded caller with the error of the write that replaced it", async () => {
    cloud.failNext = [{ code: "23505", message: "boom" }, { code: "23505", message: "boom" }];
    const calls = Array.from({ length: 5 }, (_, index) => syncWorkspaceToCloud(ws(index), "user-1"));
    const results = await Promise.all(calls.map(settled));
    expect(results.every((result) => result !== "ok")).toBe(true);
    expect(cloud.upserts).toHaveLength(0);
  });
  it("skips content identical to what was loaded or last written", async () => {
    cloud.hasRow = true; cloud.revision = 3;
    await loadCloudWorkspace("user-1");
    await syncWorkspaceToCloud(initialWorkspace, "user-1");
    expect(cloud.upserts).toHaveLength(0);
    await syncWorkspaceToCloud(ws(1), "user-1"); await syncWorkspaceToCloud(ws(1), "user-1"); await syncWorkspaceToCloud({ ...ws(1) }, "user-1");
    expect(cloud.upserts).toHaveLength(1);
    await syncWorkspaceToCloud(ws(2), "user-1");
    expect(cloud.upserts).toHaveLength(2);
  });
  it("does not re-send a copy that equals the one already in flight", async () => {
    let release = () => undefined as void; cloud.hold = new Promise<void>((resolve) => { release = resolve; });
    const first = syncWorkspaceToCloud(ws(1), "user-1"); const again = syncWorkspaceToCloud(ws(1), "user-1");
    release(); await Promise.all([first, again]);
    expect(cloud.upserts).toHaveLength(1);
  });
  it("makes refreshCloudLedger wait for in-flight and pending writes before reading", async () => {
    let release = () => undefined as void; cloud.hold = new Promise<void>((resolve) => { release = resolve; });
    const writes = [syncWorkspaceToCloud(ws(1), "user-1"), syncWorkspaceToCloud(ws(2), "user-1")];
    cloud.hasRow = true;
    const read = refreshCloudLedger("user-1", "TREASURY");
    await Promise.resolve(); expect(cloud.selects).toBe(0);
    release(); await Promise.all([...writes, read]);
    expect(cloud.upserts.length).toBe(2); expect(cloud.selects).toBe(1);
  });
});

describe("revision conflicts", () => {
  it("rejects all pending writes, sends nothing more on the stale base, refreshes the revision, and recovers after a reload", async () => {
    cloud.hasRow = true; cloud.revision = 1;
    await loadCloudWorkspace("user-1");
    cloud.revision = 7; // Claude or Autopilot moved the row
    const calls = Array.from({ length: 6 }, (_, index) => syncWorkspaceToCloud(ws(index + 1), "user-1"));
    const results = await Promise.all(calls.map(settled));
    expect(results.every((result) => result !== "ok" && isRevisionConflict(result))).toBe(true);
    expect(cloud.upserts).toHaveLength(1); expect(cloud.conflicts).toBe(1);
    expect(knownWorkspaceRevision("user-1", "TREASURY")).toBe(7);
    // The stale tab cannot write over the newer cloud copy before it has loaded it.
    expect(isRevisionConflict(await settled(syncWorkspaceToCloud(ws(9), "user-1")))).toBe(true);
    expect(cloud.upserts).toHaveLength(1);
    await loadCloudWorkspace("user-1");
    await syncWorkspaceToCloud(ws(9), "user-1");
    expect(cloud.upserts).toHaveLength(2); expect(cloud.upserts[1].revision).toBe(7); expect(cloud.conflicts).toBe(1);
  });
  it("accepts the PT409 and legacy 40001 codes and the message", () => {
    expect(isRevisionConflict({ code: "PT409" })).toBe(true); expect(isRevisionConflict({ code: "40001" })).toBe(true);
    expect(isRevisionConflict({ message: "workspace revision conflict" })).toBe(true); expect(isRevisionConflict({ code: "23505" })).toBe(false);
  });
  it("stays bounded while a server-side writer keeps bumping the revision under an open tab", async () => {
    cloud.hasRow = true; cloud.revision = 1;
    await loadCloudWorkspace("user-1");
    const serverChanges = 6; let sent = 0, changes = 0;
    for (let round = 0; round < serverChanges; round++) {
      cloud.revision += 1; // the Claude connector approves a change
      // The tab makes a burst of edits before it notices; the first conflict must be the only one of the round.
      const burst = Array.from({ length: 8 }, () => { changes++; return syncWorkspaceToCloud(ws(changes), "user-1"); });
      const results = await Promise.all(burst.map(settled));
      sent += results.length;
      if (results.some((result) => isRevisionConflict(result))) await refreshCloudLedger("user-1", "TREASURY"); // the provider adopts the cloud copy
      cloud.revision = Math.max(cloud.revision, Number(knownWorkspaceRevision("user-1", "TREASURY")));
    }
    expect(sent).toBe(48);
    expect(cloud.conflicts).toBeLessThanOrEqual(serverChanges);
    expect(cloud.upserts.length).toBeLessThanOrEqual(serverChanges * 2 + 1);
    expect(await cloudWorkspaceRevision("user-1", "TREASURY")).toBe(cloud.revision);
  });
});

describe("retry and rate limit", () => {
  it("retries transient failures with exponential backoff and then succeeds", async () => {
    vi.useFakeTimers();
    cloud.failNext = [new TypeError("Failed to fetch"), new TypeError("Failed to fetch")];
    const result = settled(syncWorkspaceToCloud(ws(1), "user-1"));
    await vi.advanceTimersByTimeAsync(0); expect(cloud.upserts).toHaveLength(0); // attempt 1 failed
    await vi.advanceTimersByTimeAsync(999); expect(cloud.upserts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(cloud.upserts).toHaveLength(0); // attempt 2 failed after 1s
    await vi.advanceTimersByTimeAsync(1999); expect(cloud.upserts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); // attempt 3 after 2 more seconds
    expect(await result).toBe("ok"); expect(cloud.upserts).toHaveLength(1);
  });
  it("gives up after a few attempts, and does not retry rule violations", async () => {
    vi.useFakeTimers();
    cloud.failNext = Array(10).fill(new TypeError("Failed to fetch"));
    const result = settled(syncWorkspaceToCloud(ws(1), "user-1"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBeInstanceOf(TypeError); expect(10 - cloud.failNext.length).toBe(4);
    cloud.failNext = [{ code: "P0001", message: "obligation deletion is not supported" }];
    const rule = settled(syncWorkspaceToCloud(ws(2), "user-1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await rule).toMatchObject({ code: "P0001" }); expect(cloud.failNext).toHaveLength(0);
  });
  it("defers writes beyond six per minute, still coalesced to the latest, and never drops them", async () => {
    vi.useFakeTimers();
    for (let index = 1; index <= 6; index++) await syncWorkspaceToCloud(ws(index), "user-1");
    expect(cloud.upserts).toHaveLength(6);
    const queued = [7, 8, 9].map((index) => syncWorkspaceToCloud(ws(index), "user-1"));
    await vi.advanceTimersByTimeAsync(30_000); expect(cloud.upserts).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await Promise.all(queued.map(settled))).toEqual(["ok", "ok", "ok"]);
    expect(cloud.upserts).toHaveLength(7); expect(cloud.upserts[6].workspace.updatedAt).toBe(ws(9).updatedAt);
  });
});
