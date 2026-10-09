import { createLiveStarterWorkspace } from "./starter";
import { legacyTreasuryWorkspaceSchema, stage2TreasuryWorkspaceSchema, stage4TreasuryWorkspaceSchema, treasuryWorkspaceSchema, type TreasuryWorkspace } from "./models";

export const WORKSPACE_STORAGE_KEY = "hodd.stage5.workspace.v4";
export const STAGE4_WORKSPACE_STORAGE_KEY = "hodd.stage4.workspace.v3";
export const STAGE3_WORKSPACE_STORAGE_KEY = "hodd.stage3.workspace.v2";
export const LEGACY_WORKSPACE_STORAGE_KEY = "hodd.stage2.workspace.v1";
export type WorkspaceLoadResult = { status: "EMPTY" | "READY" | "MIGRATED"; workspace: TreasuryWorkspace } | { status: "CORRUPT"; workspace: TreasuryWorkspace; message: string };
export interface TreasuryRepository { load(): WorkspaceLoadResult; save(workspace: TreasuryWorkspace): void; reset(): TreasuryWorkspace; }

export function migrateLegacyWorkspace(input: unknown): TreasuryWorkspace | null {
  const parsed = legacyTreasuryWorkspaceSchema.safeParse(input);
  if (!parsed.success) return null;
  return treasuryWorkspaceSchema.parse({ ...parsed.data, schemaVersion: 4, treasuryMode: "LOCAL_DEMO", walletConnection: null });
}
export function migrateStage3Workspace(input: unknown): TreasuryWorkspace | null {
  const parsed = stage2TreasuryWorkspaceSchema.safeParse(input);
  if (!parsed.success) return null;
  return treasuryWorkspaceSchema.parse({ ...parsed.data, schemaVersion: 4, treasuryMode: "LOCAL_DEMO", walletConnection: null });
}

export function migrateStage4Workspace(input: unknown): TreasuryWorkspace | null {
  const parsed = stage4TreasuryWorkspaceSchema.safeParse(input);
  if (!parsed.success) return null;
  return treasuryWorkspaceSchema.parse({ ...parsed.data, schemaVersion: 4, treasuryMode: "LOCAL_DEMO", walletConnection: null });
}

export class LocalTreasuryRepository implements TreasuryRepository {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, private readonly userId?: string) {}
  private get key() { return this.userId ? `${WORKSPACE_STORAGE_KEY}:${this.userId}` : WORKSPACE_STORAGE_KEY; }
  load(): WorkspaceLoadResult {
    const raw = this.storage.getItem(this.key);
    if (raw) {
      try { const parsed = treasuryWorkspaceSchema.safeParse(JSON.parse(raw)); return parsed.success ? { status: "READY", workspace: parsed.data } : { status: "CORRUPT", workspace: createLiveStarterWorkspace(), message: "The saved Stage 4 workspace failed schema validation." }; }
      catch { return { status: "CORRUPT", workspace: createLiveStarterWorkspace(), message: "The saved Stage 4 workspace is not valid JSON." }; }
    }
    if (this.userId) return { status: "EMPTY", workspace: createLiveStarterWorkspace() };
    const stage4Raw = this.storage.getItem(STAGE4_WORKSPACE_STORAGE_KEY);
    if (stage4Raw) {
      try { const migrated = migrateStage4Workspace(JSON.parse(stage4Raw)); return migrated ? { status: "MIGRATED", workspace: migrated } : { status: "CORRUPT", workspace: createLiveStarterWorkspace(), message: "The saved Stage 4 workspace could not be migrated safely." }; }
      catch { return { status: "CORRUPT", workspace: createLiveStarterWorkspace(), message: "The saved Stage 4 workspace is not valid JSON." }; }
    }
    const stage3Raw = this.storage.getItem(STAGE3_WORKSPACE_STORAGE_KEY);
    if (stage3Raw) {
      try { const migrated = migrateStage3Workspace(JSON.parse(stage3Raw)); return migrated ? { status: "MIGRATED", workspace: migrated } : { status: "CORRUPT", workspace: createLiveStarterWorkspace(), message: "The saved Stage 3 workspace could not be migrated safely." }; }
      catch { return { status: "CORRUPT", workspace: createLiveStarterWorkspace(), message: "The saved Stage 3 workspace is not valid JSON." }; }
    }
    const legacyRaw = this.storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);
    if (!legacyRaw) return { status: "EMPTY", workspace: createLiveStarterWorkspace() };
    try {
      const migrated = migrateLegacyWorkspace(JSON.parse(legacyRaw));
      return migrated ? { status: "MIGRATED", workspace: migrated } : { status: "CORRUPT", workspace: createLiveStarterWorkspace(), message: "The saved Stage 2 workspace could not be migrated safely." };
    } catch {
      return { status: "CORRUPT", workspace: createLiveStarterWorkspace(), message: "The saved Stage 2 workspace is not valid JSON." };
    }
  }
  save(workspace: TreasuryWorkspace) { this.storage.setItem(this.key, JSON.stringify(treasuryWorkspaceSchema.parse(workspace))); if (!this.userId) { this.storage.removeItem(STAGE4_WORKSPACE_STORAGE_KEY); this.storage.removeItem(STAGE3_WORKSPACE_STORAGE_KEY); this.storage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY); } }
  reset() { this.storage.removeItem(this.key); if (!this.userId) { this.storage.removeItem(STAGE4_WORKSPACE_STORAGE_KEY); this.storage.removeItem(STAGE3_WORKSPACE_STORAGE_KEY); this.storage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY); } return createLiveStarterWorkspace(); }
}
