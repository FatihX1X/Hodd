import { describe, expect, it } from "vitest";
import { initialWorkspace } from "./fixtures";
import { LEGACY_WORKSPACE_STORAGE_KEY, LocalTreasuryRepository, WORKSPACE_STORAGE_KEY } from "./repository";

function memoryStorage(seed?: string, key = WORKSPACE_STORAGE_KEY) { const data = new Map<string, string>(); if (seed !== undefined) data.set(key, seed); return { getItem: (item: string) => data.get(item) ?? null, setItem: (item: string, value: string) => { data.set(item, value); }, removeItem: (item: string) => { data.delete(item); } }; }
describe("LocalTreasuryRepository", () => {
  it("returns a validated seed for an empty workspace", () => { expect(new LocalTreasuryRepository(memoryStorage()).load().status).toBe("EMPTY"); });
  it("round-trips a saved workspace", () => { const storage = memoryStorage(); const repository = new LocalTreasuryRepository(storage); repository.save(initialWorkspace); expect(repository.load()).toMatchObject({ status: "READY", workspace: { schemaVersion: 2, treasuryMode: "LOCAL_DEMO" } }); });
  it("migrates a valid Stage 2 workspace without losing treasury data", () => { const legacy = structuredClone(initialWorkspace) as unknown as Record<string, unknown>; legacy.schemaVersion = 1; delete legacy.treasuryMode; delete legacy.walletConnection; const storage = memoryStorage(JSON.stringify(legacy), LEGACY_WORKSPACE_STORAGE_KEY); const result = new LocalTreasuryRepository(storage).load(); expect(result).toMatchObject({ status: "MIGRATED", workspace: { schemaVersion: 2, treasuryMode: "LOCAL_DEMO", walletConnection: null, totalTreasury: initialWorkspace.totalTreasury } }); });
  it("fails closed for corrupt storage", () => { const result = new LocalTreasuryRepository(memoryStorage("not-json")).load(); expect(result.status).toBe("CORRUPT"); expect(result.workspace).toEqual(initialWorkspace); });
  it("rejects unsupported schemas", () => { const result = new LocalTreasuryRepository(memoryStorage(JSON.stringify({ ...initialWorkspace, schemaVersion: 3 }))).load(); expect(result.status).toBe("CORRUPT"); });
});
