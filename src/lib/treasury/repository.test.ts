import { describe, expect, it } from "vitest";
import { createLiveStarterWorkspace } from "./starter";
import { initialWorkspace } from "./fixtures";
import { LEGACY_WORKSPACE_STORAGE_KEY, LocalTreasuryRepository, STAGE3_WORKSPACE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "./repository";

function memoryStorage(seed?: string, key = WORKSPACE_STORAGE_KEY) { const data = new Map<string, string>(); if (seed !== undefined) data.set(key, seed); return { getItem: (item: string) => data.get(item) ?? null, setItem: (item: string, value: string) => { data.set(item, value); }, removeItem: (item: string) => { data.delete(item); } }; }
describe("LocalTreasuryRepository", () => {
  it("returns an empty live starter for a new account", () => { const result = new LocalTreasuryRepository(memoryStorage()).load(); expect(result.status).toBe("EMPTY"); expect(result.workspace).toMatchObject({ ...createLiveStarterWorkspace(result.workspace.updatedAt) }); });
  it("round-trips a saved workspace", () => { const storage = memoryStorage(); const repository = new LocalTreasuryRepository(storage); repository.save(initialWorkspace); expect(repository.load()).toMatchObject({ status: "READY", workspace: { schemaVersion: 4, treasuryMode: "LOCAL_DEMO" } }); });
  it("migrates a valid Stage 2 workspace without losing treasury data", () => { const legacy = structuredClone(initialWorkspace) as unknown as Record<string, unknown>; legacy.schemaVersion = 1; delete legacy.treasuryMode; delete legacy.walletConnection; const storage = memoryStorage(JSON.stringify(legacy), LEGACY_WORKSPACE_STORAGE_KEY); const result = new LocalTreasuryRepository(storage).load(); expect(result).toMatchObject({ status: "MIGRATED", workspace: { schemaVersion: 4, treasuryMode: "LOCAL_DEMO", walletConnection: null, totalTreasury: initialWorkspace.totalTreasury } }); });
  it("migrates a Stage 3 wallet without losing obligations or policy", () => { const prior = structuredClone(initialWorkspace) as unknown as Record<string, unknown>; prior.schemaVersion = 2; prior.treasuryMode = "ARC_TESTNET_WALLET"; prior.walletConnection = { provider: "CIRCLE_AGENT_WALLET", chain: "ARC-TESTNET", chainId: 5_042_002, address: "0x0000000000000000000000000000000000000001", label: "Prior wallet", connectedAt: "2026-09-27T12:00:00.000Z" }; const storage = memoryStorage(JSON.stringify(prior), STAGE3_WORKSPACE_STORAGE_KEY); const result = new LocalTreasuryRepository(storage).load(); expect(result).toMatchObject({ status: "MIGRATED", workspace: { schemaVersion: 4, treasuryMode: "LOCAL_DEMO", walletConnection: null, obligations: initialWorkspace.obligations, policy: initialWorkspace.policy } }); });
  it("fails closed for corrupt storage", () => { const result = new LocalTreasuryRepository(memoryStorage("not-json")).load(); expect(result.status).toBe("CORRUPT"); expect(result.workspace.totalTreasury.minorUnits).toBe("0"); expect(result.workspace.obligations).toEqual([]); });
  it("isolates guest and different signed-in accounts including reset", () => {
    const storage = memoryStorage();
    const guest = new LocalTreasuryRepository(storage);
    const alice = new LocalTreasuryRepository(storage, "alice");
    const bob = new LocalTreasuryRepository(storage, "bob");
    guest.save({ ...initialWorkspace, obligations: [] });
    alice.save({ ...initialWorkspace, activities: [] });
    expect(bob.load().status).toBe("EMPTY");
    expect(alice.load().workspace.obligations).toEqual(initialWorkspace.obligations);
    bob.reset();
    expect(guest.load().workspace.obligations).toEqual([]);
    expect(alice.load().workspace.activities).toEqual([]);
  });
  it("rejects unsupported schemas", () => { const result = new LocalTreasuryRepository(memoryStorage(JSON.stringify({ ...initialWorkspace, schemaVersion: 99 }))).load(); expect(result.status).toBe("CORRUPT"); });
});
