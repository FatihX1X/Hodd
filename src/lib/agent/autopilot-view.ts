import "server-only";
import { agentDb, loadMandate, loadWallet } from "@/lib/autopilot/store";
import { autopilotIsActive } from "@/lib/autopilot/protection";
import { vaultView } from "@/lib/autopilot/vault-http";
import type { AgentWallet } from "@/lib/autopilot/models";
import type { TreasuryWorkspace } from "@/lib/treasury/models";
import { AgentError } from "./auth";

// Read-only Autopilot views for the Claude connector. The user id always comes from the verified connector token.

const text = (minor: string | number | bigint | null | undefined) => minor === null || minor === undefined ? null : `${(Number(BigInt(minor)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6, useGrouping: false })} USDC`;
const pct = (bps: number | null | undefined) => bps === null || bps === undefined ? null : `${(bps / 100).toFixed(2)}%`;

/** The stored Autopilot rows. Wallet and mandate are null for a user who never set Autopilot up. */
export async function autopilotRecords(userId: string) {
  try { const [wallet, mandate] = await Promise.all([loadWallet(userId), loadMandate(userId)]); return { wallet, mandate }; }
  catch { throw new AgentError("AUTOPILOT_UNAVAILABLE", "Autopilot data is unavailable right now."); }
}

/** Refuses Autopilot changes that cannot apply to this user's current Autopilot state. */
export function assertAutopilotChange(records: Awaited<ReturnType<typeof autopilotRecords>>, workspace: TreasuryWorkspace, kind: "PAUSE_AUTOPILOT" | "AUTOPILOT_REQUEST", operation?: string) {
  const { wallet, mandate } = records;
  const owner = workspace.walletConnection?.address.toLowerCase();
  if (wallet && owner && wallet.owner_address !== owner) throw new AgentError("AUTOPILOT_OWNER_CHANGED", "Your Autopilot belongs to another of your wallets. Connect that wallet in Hodd first.");
  if (kind === "PAUSE_AUTOPILOT") {
    if (!mandate) throw new AgentError("AUTOPILOT_NOT_SET_UP", "Autopilot is not set up, so there is nothing to pause.");
    if (mandate.mandate.paused) throw new AgentError("AUTOPILOT_ALREADY_PAUSED", "Autopilot is already paused.");
    return;
  }
  if (!workspace.walletConnection) throw new AgentError("WALLET_REQUIRED", "Connect a wallet in Hodd before using Autopilot.");
  if (operation === "INVEST") return;
  if (!wallet || !mandate) throw new AgentError("AUTOPILOT_NOT_SET_UP", "Autopilot is not set up yet. Ask for an INVEST request first.");
  if (["APPROVE_BILL", "WITHDRAW_ALL", "LIFT_LIMITS"].includes(operation ?? "") && !wallet.vault_address) throw new AgentError("AUTOPILOT_VAULT_REQUIRED", "Your Autopilot vault does not exist yet. Invest once to create it.");
}

/** Mandate, vault balances per strategy, who pays each bill, what needs the user, and recent runs. */
export async function autopilotView(userId: string, workspace: TreasuryWorkspace) {
  const { wallet, mandate } = await autopilotRecords(userId);
  if (!wallet && !mandate) return { setUp: false, active: false, message: "Autopilot is not set up. The user can start it in Hodd (Autopilot page) or ask for an AUTOPILOT_REQUEST with operation INVEST." };
  const active = autopilotIsActive({ mandate: mandate?.mandate, returnRequested: mandate?.return_requested });
  const [runs, vault] = await Promise.all([recentRuns(userId), wallet ? vaultSection(wallet) : Promise.resolve(null)]);
  return {
    setUp: true, active,
    state: !mandate ? "NOT_FUNDED" : mandate.return_requested ? "RETURNING" : !mandate.mandate.enabled ? "DISABLED" : mandate.mandate.paused ? "PAUSED" : "ACTIVE",
    agentWallet: wallet ? { address: wallet.address, owner: wallet.owner_address, ownerIsConnectedWallet: wallet.owner_address === workspace.walletConnection?.address.toLowerCase() } : null,
    mandate: mandate ? { enabled: mandate.mandate.enabled, paused: mandate.mandate.paused, budget: text(mandate.mandate.budgetMinor), counted: text(String(mandate.spent_minor)), returnRequested: mandate.return_requested } : null,
    protection: active ? "Autopilot is active, so Hodd protects bills in the shorter Autopilot window and pays approved bills on their payment day from the vault." : "Manual protection: bills are protected in the normal window.",
    ...vault,
    recentRuns: runs,
    howToChange: "Pause with hodd_prepare_change kind PAUSE_AUTOPILOT. Invest, approve a bill, return everything, withdraw all or lift limits with kind AUTOPILOT_REQUEST; the user finishes those on Hodd's Autopilot page.",
  };
}

async function vaultSection(wallet: AgentWallet) {
  try {
    const view = await vaultView(wallet);
    const b = view.balances;
    return {
      vault: view.vault,
      balances: b ? { cash: text(b.cashMinor), morpho: text(b.positionMinor), morphoRedeemable: text(b.redeemableMinor), usyc: text(b.usycMinor), usycRedeemable: text(b.usycRedeemableMinor), usycAvailable: b.usycAvailable, morphoApy: pct(b.morphoApyBps), usycApy: pct(b.usycApyBps), observedAt: b.observedAt } : null,
      bills: view.bills.map((bill) => ({ obligationId: bill.id, title: bill.title, amount: text(bill.amountMinor), dueDate: bill.dueAt.slice(0, 10), recipient: bill.recipient, approvedCap: text(bill.capMinor), plan: bill.plan, paysFrom: bill.payFrom })),
      needsYou: view.needsYou,
    };
  } catch { return { vault: null, balances: null, bills: [], needsYou: [], balanceNote: "Fresh vault balances are unavailable right now; try again shortly." }; }
}

async function recentRuns(userId: string) {
  const { data, error } = await agentDb().from("agent_runs").select("id,state,decision,created_at,failure,return_all").eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
  if (error) return [];
  return (data ?? []).map((run) => {
    const decision = (run.decision ?? {}) as { kind?: string; explanation?: string; depositMinor?: string; withdrawMinor?: string; transferMinor?: string };
    return { id: run.id, at: run.created_at, state: run.state, decision: decision.kind ?? null, explanation: decision.explanation ?? null, deposited: text(decision.depositMinor), withdrawn: text(decision.withdrawMinor), transferred: text(decision.transferMinor), returnAll: run.return_all, failure: run.failure };
  });
}
