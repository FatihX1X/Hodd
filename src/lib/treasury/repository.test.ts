import { describe, expect, it } from "vitest";
import { initialWorkspace } from "./fixtures";
import { LocalTreasuryRepository, WORKSPACE_STORAGE_KEY } from "./repository";

function memoryStorage(seed?: string) { const data = new Map<string, string>(); if (seed !== undefined) data.set(WORKSPACE_STORAGE_KEY, seed); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; }
describe("LocalTreasuryRepository", () => {
  it("returns a validated seed for an empty workspace", () => { expect(new LocalTreasuryRepository(memoryStorage()).load().status).toBe("EMPTY"); });
  it("round-trips a saved workspace", () => { const storage = memoryStorage(); const repository = new LocalTreasuryRepository(storage); repository.save(initialWorkspace); expect(repository.load()).toMatchObject({ status: "READY", workspace: { schemaVersion: 1 } }); });
  it("fails closed for corrupt storage", () => { const result = new LocalTreasuryRepository(memoryStorage("not-json")).load(); expect(result.status).toBe("CORRUPT"); expect(result.workspace).toEqual(initialWorkspace); });
  it("rejects unsupported schemas", () => { const result = new LocalTreasuryRepository(memoryStorage(JSON.stringify({ ...initialWorkspace, schemaVersion: 2 }))).load(); expect(result.status).toBe("CORRUPT"); });
});
