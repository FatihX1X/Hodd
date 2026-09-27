import { initialWorkspace } from "./fixtures";
import { legacyTreasuryWorkspaceSchema, treasuryWorkspaceSchema, type TreasuryWorkspace } from "./models";

export const WORKSPACE_STORAGE_KEY = "hodd.stage3.workspace.v2";
export const LEGACY_WORKSPACE_STORAGE_KEY = "hodd.stage2.workspace.v1";
export type WorkspaceLoadResult = { status: "EMPTY" | "READY" | "MIGRATED"; workspace: TreasuryWorkspace } | { status: "CORRUPT"; workspace: TreasuryWorkspace; message: string };
export interface TreasuryRepository { load(): WorkspaceLoadResult; save(workspace: TreasuryWorkspace): void; reset(): TreasuryWorkspace; }

export function migrateLegacyWorkspace(input: unknown): TreasuryWorkspace | null {
  const parsed = legacyTreasuryWorkspaceSchema.safeParse(input);
  if (!parsed.success) return null;
  return treasuryWorkspaceSchema.parse({ ...parsed.data, schemaVersion: 2, treasuryMode: "LOCAL_DEMO", walletConnection: null });
}

export class LocalTreasuryRepository implements TreasuryRepository {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}
  load(): WorkspaceLoadResult {
    const raw = this.storage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw) {
      try { const parsed = treasuryWorkspaceSchema.safeParse(JSON.parse(raw)); return parsed.success ? { status: "READY", workspace: parsed.data } : { status: "CORRUPT", workspace: structuredClone(initialWorkspace), message: "The saved Stage 3 workspace failed schema validation." }; }
      catch { return { status: "CORRUPT", workspace: structuredClone(initialWorkspace), message: "The saved Stage 3 workspace is not valid JSON." }; }
    }
    const legacyRaw = this.storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);
    if (!legacyRaw) return { status: "EMPTY", workspace: structuredClone(initialWorkspace) };
    try {
      const migrated = migrateLegacyWorkspace(JSON.parse(legacyRaw));
      return migrated ? { status: "MIGRATED", workspace: migrated } : { status: "CORRUPT", workspace: structuredClone(initialWorkspace), message: "The saved Stage 2 workspace could not be migrated safely." };
    } catch {
      return { status: "CORRUPT", workspace: structuredClone(initialWorkspace), message: "The saved Stage 2 workspace is not valid JSON." };
    }
  }
  save(workspace: TreasuryWorkspace) { this.storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(treasuryWorkspaceSchema.parse(workspace))); this.storage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY); }
  reset() { this.storage.removeItem(WORKSPACE_STORAGE_KEY); this.storage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY); return structuredClone(initialWorkspace); }
}
