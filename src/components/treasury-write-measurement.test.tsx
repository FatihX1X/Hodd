import { StrictMode, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreasuryWorkspaceProvider, useTreasuryWorkspace } from "./treasury-workspace-provider";
import { sampleWorkspace, usdc } from "@/test/fixtures";
import { createLiveStarterWorkspace } from "@/lib/treasury/starter";
import type { ObligationInput, TreasuryWorkspace, WalletConnection } from "@/lib/treasury/models";
import { __resetWorkspaceSyncForTests } from "@/lib/supabase/workspace-sync";

// One signed-in session, five minutes, real workspace-sync and real provider; only Supabase and the network are faked.
// The counter is the number of upserts the browser sent to the workspace table.
const cloud = vi.hoisted(() => ({ row: null as null | { workspace: unknown; revision: number }, workspaceUpserts: 0, walletWrites: 0, conflicts: 0, selects: 0 }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({
  auth: {
    getUser: async () => ({ data: { user: { id: "alice" } } }),
    onAuthStateChange: (callback: (event: string, session: { user: { id: string } } | null) => void) => { queueMicrotask(() => callback("INITIAL_SESSION", { user: { id: "alice" } })); return { data: { subscription: { unsubscribe: () => undefined } } }; },
  },
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => { cloud.selects++; return { data: table === "treasury_workspaces" ? cloud.row : null, error: null }; } }) }),
    upsert: (row: { workspace?: unknown; revision?: number }) => {
      if (table !== "treasury_workspaces") { cloud.walletWrites++; return Promise.resolve({ error: null }); }
      return { select: () => ({ single: async () => {
        cloud.workspaceUpserts++;
        if (cloud.row && row.revision !== cloud.row.revision) { cloud.conflicts++; return { data: null, error: { code: "PT409", message: "workspace revision conflict" } }; }
        cloud.row = { workspace: row.workspace, revision: (cloud.row?.revision ?? 0) + 1 };
        return { data: { revision: cloud.row.revision }, error: null };
      } }) };
    },
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}) }));

const wallet: WalletConnection = { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address: "0x0000000000000000000000000000000000000001", label: "My wallet", connectedAt: "2026-10-09T12:00:00.000Z" };
const net = { balance: 10_000_000, autopilot: false, calls: { wallet: 0, earn: 0, usyc: 0, autopilot: 0 } };
let current: ReturnType<typeof useTreasuryWorkspace>;
function Probe() { const value = useTreasuryWorkspace(); useEffect(() => { current = value; }, [value]); return null; }
const bill = (title: string, days: number): ObligationInput => ({ ...sampleWorkspace.obligations[1], title, status: "UPCOMING", amount: usdc("500000"), dueAt: new Date(Date.now() + days * 86_400_000).toISOString() });

beforeEach(() => {
  __resetWorkspaceSyncForTests(); window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/");
  Object.assign(cloud, { row: { workspace: { ...createLiveStarterWorkspace(), treasuryMode: "ARC_TESTNET_WALLET", walletConnection: wallet } satisfies TreasuryWorkspace, revision: 1 }, workspaceUpserts: 0, walletWrites: 0, conflicts: 0, selects: 0 });
  Object.assign(net, { balance: 10_000_000, autopilot: false, calls: { wallet: 0, earn: 0, usyc: 0, autopilot: 0 } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const observedAt = new Date().toISOString();
    if (url === "/api/autopilot/active") { net.calls.autopilot++; return { ok: true, json: async () => ({ active: net.autopilot }) }; }
    if (url === "/api/usyc") { net.calls.usyc++; return { ok: false, json: async () => ({ message: "USYC data is temporarily unavailable." }) }; }
    if (url.includes("/api/arc/")) { net.calls.wallet++; return { json: async () => ({ status: "READY", snapshot: { address: wallet.address, chain: "ARC-TESTNET", chainId: 5042002, balance: usdc(String(net.balance)), blockNumber: String(net.balance), observedAt } }) }; }
    net.calls.earn++;
    return { json: async () => ({ status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "READ_ONLY", configuredWalletAddress: wallet.address, message: "Fixture" }, positions: [], vaults: [], observedAt }) };
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("workspace write measurement", () => {
  it("sends one upsert per real change, not per poll, over a five minute session with a server-side writer (StrictMode on)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    current = undefined as unknown as typeof current;
    render(<StrictMode><TreasuryWorkspaceProvider><Probe /></TreasuryWorkspaceProvider></StrictMode>);
    for (let attempt = 0; attempt < 20 && !current?.hydrated; attempt++) await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(current.hydrated).toBe(true);
    const afterHydration = cloud.workspaceUpserts;
    const targets = (liquid: number) => ({ LIQUID: liquid, MORPHO: 10_000 - liquid, USYC: 0, BTC_RESERVE: 0 });
    const policy = () => ({ ...current.workspace.policy, safetyBuffer: usdc("3000000"), protectionLeadDays: 5 });
    const actions = new Map<number, () => void>([
      [20, () => current.createObligation(bill("Hosting", 6))],
      [70, () => current.updatePolicy(policy())],
      [120, () => current.updateTargets(targets(6000))],
      // The Claude connector approves a change at 150s; the tab edits again at 155s, before its next 30s check.
      [155, () => current.updateTargets(targets(7000))],
      // One Earn deposit: review the quote (syncs first), confirm it, then four progress events in the same tick.
      [200, () => { void current.syncForEarn(); current.recordEarnActivity("Earn quote reviewed", "Deposit quote prepared.", "Quote shown."); current.recordEarnActivity("Earn user confirmation", "Deposit confirmed.", "User confirmed."); for (const stage of ["USER_OPERATION_SUBMITTED", "TRANSACTION_SUBMITTED", "APPROVAL_CONFIRMED", "EARN_CONFIRMED"]) current.recordEarnEvent(stage); }],
      [250, () => current.createObligation(bill("Insurance", 20))],
    ]);
    const changedByServer: number[] = [];
    for (let second = 5; second <= 300; second += 5) {
      net.balance += 1_000 * (second % 7 + 1); net.autopilot = second % 60 < 30;
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); if (second % 60 === 0) window.dispatchEvent(new Event("focus")); });
      if (second === 150) { // just after the 150s check, Claude / Autopilot bumps the cloud copy
        const row = cloud.row!; const moved = { ...(row.workspace as TreasuryWorkspace), updatedAt: new Date().toISOString(), targetAllocationsBps: targets(9000) };
        cloud.row = { workspace: moved, revision: row.revision + 1 }; changedByServer.push(second);
      }
      const action = actions.get(second); if (action) await act(async () => { action(); await vi.advanceTimersByTimeAsync(10); });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    const upserts = cloud.workspaceUpserts - afterHydration;
    console.log(`[write-measurement] 5 minutes, StrictMode, 5 edits + 1 Earn deposit + 1 server change: ${upserts} workspace upserts (${cloud.conflicts} conflicts), ${cloud.walletWrites} wallet_connections writes; polls: ${JSON.stringify(net.calls)}`);
    expect(net.calls.wallet).toBeGreaterThanOrEqual(9); expect(net.calls.earn).toBeGreaterThanOrEqual(6); expect(net.calls.usyc).toBeGreaterThanOrEqual(4); expect(net.calls.autopilot).toBeGreaterThanOrEqual(9);
    expect(cloud.conflicts).toBeLessThanOrEqual(changedByServer.length);
    expect(upserts).toBeLessThanOrEqual(7); // 5 edits (one hit the server change) + the whole Earn deposit coalesced into at most 2
    expect(afterHydration).toBe(0);
  });
});
