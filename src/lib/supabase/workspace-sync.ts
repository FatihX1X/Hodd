"use client";

import { treasuryWorkspaceSchema, type TreasuryWorkspace } from "@/lib/treasury/models";
import { createSupabaseBrowserClient } from "./client";

export async function loadCloudWorkspace(userId: string): Promise<TreasuryWorkspace | null> {
  const client = createSupabaseBrowserClient();
  if (!client) return null;
  const { data: auth } = await client.auth.getUser();
  if (auth.user?.id !== userId) throw new Error("Workspace session changed.");
  const { data, error } = await client.from("treasury_workspaces").select("workspace").eq("user_id", auth.user.id).maybeSingle();
  if (error) throw new Error("Cloud workspace could not be loaded.");
  if (!data) return null;
  const parsed = treasuryWorkspaceSchema.safeParse(data.workspace);
  if (!parsed.success) throw new Error("Cloud workspace failed validation.");
  return parsed.data;
}

const pendingSyncs = new Map<string, Promise<void>>();

export function syncWorkspaceToCloud(workspace: TreasuryWorkspace, userId?: string): Promise<void> {
  if (!userId) return Promise.resolve();
  const previous = pendingSyncs.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeCloudWorkspace(treasuryWorkspaceSchema.parse(workspace), userId));
  pendingSyncs.set(userId, next);
  void next.finally(() => { if (pendingSyncs.get(userId) === next) pendingSyncs.delete(userId); }).catch(() => undefined);
  return next;
}

async function writeCloudWorkspace(workspace: TreasuryWorkspace, userId: string): Promise<void> {
  const client = createSupabaseBrowserClient();
  if (!client || !userId) return;
  const { data: auth } = await client.auth.getUser();
  if (auth.user?.id !== userId) throw new Error("Workspace session changed.");

  const { error: workspaceError } = await client.from("treasury_workspaces").upsert({
    user_id: auth.user.id,
    schema_version: workspace.schemaVersion,
    workspace,
    updated_at: workspace.updatedAt,
  }, { onConflict: "user_id" });
  if (workspaceError) throw workspaceError;

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
