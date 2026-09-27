import { initialWorkspace } from "./fixtures";
import { treasuryWorkspaceSchema, type TreasuryWorkspace } from "./models";

export const WORKSPACE_STORAGE_KEY = "hodd.stage2.workspace.v1";
export type WorkspaceLoadResult = { status: "EMPTY" | "READY"; workspace: TreasuryWorkspace } | { status: "CORRUPT"; workspace: TreasuryWorkspace; message: string };
export interface TreasuryRepository { load(): WorkspaceLoadResult; save(workspace: TreasuryWorkspace): void; reset(): TreasuryWorkspace; }

export class LocalTreasuryRepository implements TreasuryRepository {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}
  load(): WorkspaceLoadResult {
    const raw = this.storage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return { status: "EMPTY", workspace: structuredClone(initialWorkspace) };
    try { const parsed = treasuryWorkspaceSchema.safeParse(JSON.parse(raw)); return parsed.success ? { status: "READY", workspace: parsed.data } : { status: "CORRUPT", workspace: structuredClone(initialWorkspace), message: "The saved workspace failed schema validation." }; }
    catch { return { status: "CORRUPT", workspace: structuredClone(initialWorkspace), message: "The saved workspace is not valid JSON." }; }
  }
  save(workspace: TreasuryWorkspace) { this.storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(treasuryWorkspaceSchema.parse(workspace))); }
  reset() { this.storage.removeItem(WORKSPACE_STORAGE_KEY); return structuredClone(initialWorkspace); }
}
