"use client";

import { treasuryWorkspaceSchema, type TreasuryWorkspace } from "@/lib/treasury/models";
import { createSupabaseBrowserClient } from "./client";
import type { WorkspaceScope } from "@/lib/treasury/smoke-workspace";

// Last workspace revision this tab saw, per user and scope. Writes send it back so the
// database can refuse an update based on a stale copy (for example after Claude changed it).
const knownRevisions = new Map<string, number>();
const tableFor = (scope: WorkspaceScope) => scope === "SMOKE_TEST" ? "earn_smoke_workspaces" : "treasury_workspaces";

export function isRevisionConflict(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null;
  // 40001 is the legacy code; the database now raises PT409 (HTTP 409), which PostgREST never retries.
  return value?.code === "40001" || value?.code === "PT409" || (typeof value?.message === "string" && value.message.includes("workspace revision conflict"));
}

export function knownWorkspaceRevision(userId: string, scope: WorkspaceScope) { return knownRevisions.get(`${userId}:${scope}`); }

/** Cheap check used on focus: has the cloud copy moved past what this tab saw? */
export async function cloudWorkspaceRevision(userId: string, scope: WorkspaceScope): Promise<number | null> {
  const client = createSupabaseBrowserClient();
  if (!client) return null;
  const { data, error } = await client.from(tableFor(scope)).select("revision").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return Number(data.revision);
}

export async function loadCloudWorkspace(userId: string, scope: WorkspaceScope = "TREASURY"): Promise<TreasuryWorkspace | null> {
  const client = createSupabaseBrowserClient();
  if (!client) return null;
  const { data: auth } = await client.auth.getUser();
  if (auth.user?.id !== userId) throw new Error("Workspace session changed.");
  const { data, error } = await client.from(tableFor(scope)).select("workspace, revision").eq("user_id", auth.user.id).maybeSingle();
  const { data: current } = await client.auth.getUser();
  if (current.user?.id !== userId) throw new Error("Workspace session changed.");
  if (error) throw new Error("Cloud workspace could not be loaded.");
  if (!data) return null;
  const parsed = treasuryWorkspaceSchema.safeParse(data.workspace);
  if (!parsed.success) throw new Error("Cloud workspace failed validation.");
  const key = `${userId}:${scope}`;
  knownRevisions.set(key, Number(data.revision));
  lastContent.set(key, stable(parsed.data)); staleKeys.delete(key);
  return parsed.data;
}

// Writes are coalesced per user and scope: one in flight plus at most one pending write that holds only the newest
// workspace. Older callers settle together with the write that superseded them.
const MAX_WRITES_PER_WINDOW = 6, RATE_WINDOW_MS = 60_000, MAX_ATTEMPTS = 4, BACKOFF_BASE_MS = 1_000, BACKOFF_CAP_MS = 30_000;
type Waiter = { resolve(): void; reject(error: unknown): void };
type Job = { workspace: TreasuryWorkspace; content: string; waiters: Waiter[]; stored: boolean };
type Slot = { userId: string; scope: WorkspaceScope; pending: Job | null; runner: Promise<void> | null };
const slots = new Map<string, Slot>();
const lastContent = new Map<string, string>(); // what the cloud is known to hold, per key
const staleKeys = new Set<string>(); // a conflict was seen: nothing is written until the cloud copy is loaded again
const writeLog = new Map<string, number[]>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => a < b ? -1 : a > b ? 1 : 0;
const stable = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(byKey)) : item);
const settleAll = (job: Job, error?: unknown) => { for (const waiter of job.waiters.splice(0)) { if (error === undefined) waiter.resolve(); else waiter.reject(error); } };
const conflictError = () => Object.assign(new Error("workspace revision conflict"), { code: "PT409" });
// Rule violations and auth problems fail the same way every time; only transport trouble is worth retrying.
function isRetryable(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = typeof value?.code === "string" ? value.code : "", message = typeof value?.message === "string" ? value.message : "";
  if (message === "Workspace session changed." || /not supported|permission denied|row-level security|violates|invalid input/i.test(message)) return false;
  return !/^(P0001|PT4\d\d|PGRST[123]\d\d|(22|23|28|2D|42)\w{3})$/.test(code);
}
function rateLimitWait(key: string) {
  const now = Date.now(), log = (writeLog.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  writeLog.set(key, log);
  return log.length >= MAX_WRITES_PER_WINDOW ? log[0] + RATE_WINDOW_MS - now : 0;
}

/** Drain queued writes before a canonical read; never upload the stale read. */
export async function refreshCloudLedger(userId: string, scope: WorkspaceScope) {
  await slots.get(`${userId}:${scope}`)?.runner;
  const workspace = await loadCloudWorkspace(userId, scope);
  if (!workspace) throw new Error("The canonical payment workspace is unavailable.");
  return workspace;
}

export function syncWorkspaceToCloud(workspace: TreasuryWorkspace, userId?: string, scope: WorkspaceScope = "TREASURY"): Promise<void> {
  if (!userId) return Promise.resolve();
  const key = `${userId}:${scope}`;
  let parsed: TreasuryWorkspace;
  try { parsed = treasuryWorkspaceSchema.parse(workspace); } catch (error) { return Promise.reject(error); }
  const content = stable(parsed);
  let slot = slots.get(key);
  if (!slot) { slot = { userId, scope, pending: null, runner: null }; slots.set(key, slot); }
  const target = slot;
  // Nothing new to say: the cloud already holds exactly this.
  if (!target.pending && !target.runner && lastContent.get(key) === content) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const waiter = { resolve, reject };
    if (target.pending?.content === content) { target.pending.waiters.push(waiter); return; }
    // Replace the older pending copy; its callers now wait for this newer one.
    target.pending = { workspace: parsed, content, waiters: [...(target.pending?.waiters ?? []), waiter], stored: false };
    target.runner ??= runWrites(key, target);
  });
}

async function runWrites(key: string, slot: Slot): Promise<void> {
  try {
    while (slot.pending) {
      const job = slot.pending; slot.pending = null;
      await writeJob(key, slot, job);
    }
  } finally { slot.runner = null; }
}

async function writeJob(key: string, slot: Slot, job: Job): Promise<void> {
  let failures = 0;
  for (;;) {
    // A newer copy arrived while this one waited: it takes over, together with this one's callers.
    if (slot.pending) { slot.pending.waiters.unshift(...job.waiters.splice(0)); return; }
    if (lastContent.get(key) === job.content) return settleAll(job);
    if (staleKeys.has(key)) return settleAll(job, conflictError());
    const wait = rateLimitWait(key);
    if (wait > 0) { await sleep(wait); continue; }
    writeLog.set(key, [...(writeLog.get(key) ?? []), Date.now()]);
    try { await writeCloudWorkspace(job, slot.userId, slot.scope); lastContent.set(key, job.content); return settleAll(job); }
    catch (error) {
      if (isRevisionConflict(error)) return failConflict(key, slot, job, error);
      if (!isRetryable(error) || ++failures >= MAX_ATTEMPTS) return settleAll(job, error);
      await sleep(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)));
    }
  }
}

// Another writer moved the row. Drop everything queued on the old base, learn the new revision, and let the
// caller adopt the cloud copy instead of repeating the same content.
async function failConflict(key: string, slot: Slot, job: Job, error: unknown) {
  staleKeys.add(key);
  const revision = await cloudWorkspaceRevision(slot.userId, slot.scope).catch(() => null);
  if (revision !== null) knownRevisions.set(key, revision);
  const queued = slot.pending; slot.pending = null;
  settleAll(job, error);
  if (queued) settleAll(queued, error);
}

/** Test-only: forget all module state. */
export function __resetWorkspaceSyncForTests() { knownRevisions.clear(); slots.clear(); lastContent.clear(); staleKeys.clear(); writeLog.clear(); }

async function writeCloudWorkspace(job: Job, userId: string, scope: WorkspaceScope): Promise<void> {
  const workspace = job.workspace;
  const client = createSupabaseBrowserClient();
  if (!client || !userId) return;
  const { data: auth } = await client.auth.getUser();
  if (auth.user?.id !== userId) throw new Error("Workspace session changed.");

  const key = `${userId}:${scope}`;
  // A retry after a failed wallet-metadata write must not bump the workspace revision a second time.
  if (!job.stored) {
    const base = knownRevisions.get(key);
    const { data: written, error: workspaceError } = await client.from(tableFor(scope)).upsert({
      user_id: auth.user.id,
      schema_version: workspace.schemaVersion,
      workspace,
      updated_at: workspace.updatedAt,
      // Without a known base (first write of a new row) the row starts at revision 0.
      revision: base ?? 0,
    }, { onConflict: "user_id" }).select("revision").single();
    if (workspaceError) throw workspaceError;
    knownRevisions.set(key, Number(written.revision)); job.stored = true;
  }
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
