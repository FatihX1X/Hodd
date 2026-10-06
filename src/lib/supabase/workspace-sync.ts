"use client";

import { treasuryWorkspaceSchema, type TreasuryWorkspace } from "@/lib/treasury/models";
import { createSupabaseBrowserClient } from "./client";
import type { WorkspaceScope } from "@/lib/treasury/smoke-workspace";

export async function loadCloudWorkspace(userId: string, scope: WorkspaceScope = "TREASURY"): Promise<TreasuryWorkspace | null> {
  const client = createSupabaseBrowserClient();
  if (!client) return null;
  const { data: auth } = await client.auth.getUser();
  if (auth.user?.id !== userId) throw new Error("Workspace session changed.");
  const { data, error } = await client.from(scope === "SMOKE_TEST" ? "earn_smoke_workspaces" : "treasury_workspaces").select("workspace").eq("user_id", auth.user.id).maybeSingle();
  const { data: current } = await client.auth.getUser();
  if (current.user?.id !== userId) throw new Error("Workspace session changed.");
  if (error) throw new Error("Cloud workspace could not be loaded.");
  if (!data) return null;
  const parsed = treasuryWorkspaceSchema.safeParse(data.workspace);
  if (!parsed.success) throw new Error("Cloud workspace failed validation.");
  return parsed.data;
}

const pendingSyncs = new Map<string, Promise<void>>();

/** Drain queued writes before a canonical read; never upload the stale read. */
export async function refreshCloudLedger(userId: string, scope: WorkspaceScope) {
  await pendingSyncs.get(`${userId}:${scope}`)?.catch(() => undefined);
  const workspace = await loadCloudWorkspace(userId, scope);
  if (!workspace) throw new Error("The canonical payment workspace is unavailable.");
  return workspace;
}

export function syncWorkspaceToCloud(workspace: TreasuryWorkspace, userId?: string, scope: WorkspaceScope = "TREASURY"): Promise<void> {
  if (!userId) return Promise.resolve();
  const key = `${userId}:${scope}`;
  const previous = pendingSyncs.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeCloudWorkspace(treasuryWorkspaceSchema.parse(workspace), userId, scope));
  pendingSyncs.set(key, next);
  void next.finally(() => { if (pendingSyncs.get(key) === next) pendingSyncs.delete(key); }).catch(() => undefined);
  return next;
}

async function writeCloudWorkspace(workspace: TreasuryWorkspace, userId: string, scope: WorkspaceScope): Promise<void> {
  const client = createSupabaseBrowserClient();
  if (!client || !userId) return;
  const { data: auth } = await client.auth.getUser();
  if (auth.user?.id !== userId) throw new Error("Workspace session changed.");

  const { error: workspaceError } = await client.from(scope === "SMOKE_TEST" ? "earn_smoke_workspaces" : "treasury_workspaces").upsert({
    user_id: auth.user.id,
    schema_version: workspace.schemaVersion,
    workspace,
    updated_at: workspace.updatedAt,
  }, { onConflict: "user_id" });
  if (workspaceError) throw workspaceError;
  if (scope === "SMOKE_TEST") return;

  if (!workspace.walletConnection) {
    const { error } = await client.from("wallet_connections").delete().eq("user_id", auth.user.id).eq("chain", "ARC-TESTNET");
    if (error) throw error;
    return;
  }

  const wallet = workspace.walletConnection;
  const { error } = await client.from("wallet_connections").upsert({
    user_id: auth.user.id,
    provider: wallet.provider,
    chain: wallet.chain,
    chain_id: wallet.chainId,
    address: wallet.address,
    account_type: wallet.accountType,
    circle_wallet_id: wallet.walletId ?? null,
    label: wallet.label,
    is_authoritative: true,
    updated_at: workspace.updatedAt,
  }, { onConflict: "user_id,chain" });
  if (error) throw error;
}
