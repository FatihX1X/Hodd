import { effectiveProtectionLeadDays } from "@/lib/treasury/engine";
import type { EarnPosition } from "@/lib/earn/models";
import type { Obligation, TreasuryWorkspace } from "@/lib/treasury/models";
import { decideAutopilot } from "./decision";
import { VAULT_LIMITS } from "./vault";
import type { Decision, Mandate } from "./models";

const DAY_MS = 86_400_000;
const usdcText = (minor: bigint) => (Number(minor) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " USDC";
/** A bill the vault pays is paid no later than this before it falls due (or at once if it is overdue). */
export const VAULT_PAY_WINDOW_MS = DAY_MS;

/** A bill as the vault sees it: the owner's approval of its recipient on the contract, and whether a payment is open. */
export type VaultBill = Readonly<{ obligation: Obligation; approved: boolean; capMinor: bigint; busy: boolean }>;
export type VaultBillPlan = "PAYS" | "NEEDS_APPROVAL" | "CAP_TOO_LOW" | "NO_RECIPIENT" | "IN_FLIGHT" | "OVER_LIMIT";
export function vaultBillPlan(bill: VaultBill): VaultBillPlan {
  if (!bill.obligation.recipientAddress) return "NO_RECIPIENT";
  // The contract never pays more than this in one payment, whatever cap a recipient has.
  if (BigInt(bill.obligation.amount.minorUnits) > VAULT_LIMITS.maxPaymentPerTx) return "OVER_LIMIT";
  if (bill.busy) return "IN_FLIGHT";
  if (!bill.approved) return "NEEDS_APPROVAL";
  return bill.capMinor < BigInt(bill.obligation.amount.minorUnits) ? "CAP_TOO_LOW" : "PAYS";
}
const open = (o: Obligation) => (o.status === "UPCOMING" || o.status === "OVERDUE") && o.amount.currency === "USDC" && BigInt(o.amount.minorUnits) > 0n;

export interface VaultDecisionInputs {
  workspace: TreasuryWorkspace; ownerPositions: EarnPosition[]; vaultPosition: EarnPosition; mandate: Mandate;
  idleMinor: string; spentMinor: string; returnAll?: boolean; bills: readonly VaultBill[];
  depositRoomMinor: bigint; paymentRoomMinor: bigint; agentGasMinor: string; feeReserveMinor: string; now?: Date;
  /** Another payment of this user is still open in the ledger; a bill can only be marked PAID once it settles. */
  ledgerBusy?: boolean;
  /** What the agent wallet still holds from the custodial mode: Morpho shares, their value, and its USDC. */
  custodial?: { shares: bigint; positionMinor: bigint; cashMinor: bigint };
}
/** The agent keeps this much USDC for its own network fees; anything above it belongs in the vault. */
export const AGENT_FEE_FLOAT_MINOR = 500_000n;

/**
 * Autopilot in vault mode. Bills come first: a bill whose recipient the owner approved on the vault (within its cap
 * and the contract's 24-hour payment budget) is paid from the vault when it is due within a day or overdue, taking
 * the missing part out of Morpho first. Approved bills are the vault's job, so they leave the owner's own protection
 * and the vault keeps cash for those inside the protection window. Everything else is the same deterministic engine
 * over the vault's idle USDC and Morpho position; network fees are paid by the agent wallet, not the vault.
 */
export function decideVault(input: VaultDecisionInputs): Decision {
  const now = input.now ?? new Date();
  const idle = BigInt(input.idleMinor);
  const observed = Date.parse(input.vaultPosition.observedAt);
  const fresh = input.vaultPosition.liquidityStatus === "READY" && now.getTime() - observed <= 60_000 && observed <= now.getTime() + 5_000;
  const position = BigInt(input.vaultPosition.currentBalance.minorUnits);
  const redeemable = position < BigInt(input.vaultPosition.redeemable.minorUnits) ? position : BigInt(input.vaultPosition.redeemable.minorUnits);
  const vaultPays = input.bills.filter((bill) => open(bill.obligation) && vaultBillPlan(bill) === "PAYS");
  const managedIds = new Set(input.bills.filter((bill) => open(bill.obligation) && (vaultBillPlan(bill) === "PAYS" || vaultBillPlan(bill) === "IN_FLIGHT")).map((bill) => bill.obligation.id));
  const autopilotActive = input.mandate.enabled && !input.mandate.paused && !input.returnAll;
  const base: Decision = { kind: "NO_ACTION", depositMinor: "0", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: "0", protectedMinor: "0", explanation: "No safe movement is required." };
  const no = (explanation: string): Decision => ({ ...base, explanation });

  // Funds the agent still holds from the custodial mode go into the owner's vault first (a return then takes them too).
  const custodial = input.custodial;
  if (custodial && (autopilotActive || input.returnAll) && (custodial.shares > 0n || custodial.cashMinor > AGENT_FEE_FLOAT_MINOR * 2n) && BigInt(input.agentGasMinor) >= BigInt(input.feeReserveMinor)) {
    const cash = custodial.cashMinor > AGENT_FEE_FLOAT_MINOR * 2n ? custodial.cashMinor - AGENT_FEE_FLOAT_MINOR : 0n;
    return { ...base, kind: "MOVE_TO_VAULT", withdrawMinor: custodial.positionMinor.toString(), transferMinor: cash.toString(), explanation: `Your agent still holds ${usdcText(custodial.positionMinor + cash)} from before your vault. Move its Morpho shares and cash into your vault, keeping ${usdcText(AGENT_FEE_FLOAT_MINOR)} for network fees.` };
  }

  if (!input.returnAll) {
    if (!autopilotActive) return no("The mandate is disabled or paused.");
    if (BigInt(input.agentGasMinor) < BigInt(input.feeReserveMinor)) return no("The agent wallet needs a little USDC for network fees before it can act. Invest again or send it a few cents.");
    const due = vaultPays.filter((bill) => bill.obligation.status === "OVERDUE" || Date.parse(bill.obligation.dueAt) - now.getTime() <= VAULT_PAY_WINDOW_MS)
      .sort((a, b) => Date.parse(a.obligation.dueAt) - Date.parse(b.obligation.dueAt) || a.obligation.id.localeCompare(b.obligation.id));
    if (due.length && input.ledgerBusy) return no("A bill is due, but another payment is still being confirmed. Autopilot pays once it settles; if it stays open, resolve it on Obligations.");
    let stale = false;
    for (const bill of due) {
      const amount = BigInt(bill.obligation.amount.minorUnits);
      if (amount > input.paymentRoomMinor) continue;
      const bill_ = { obligationId: bill.obligation.id, recipient: bill.obligation.recipientAddress!, amountMinor: amount.toString(), dueAt: bill.obligation.dueAt };
      const when = bill.obligation.status === "OVERDUE" || Date.parse(bill.obligation.dueAt) <= now.getTime() ? "is due now" : "falls due within a day";
      if (idle >= amount) return { ...base, kind: "PAY_BILL", transferMinor: amount.toString(), bill: bill_, explanation: `A ${usdcText(amount)} bill ${when}. Pay it from the vault's cash to the recipient you approved.` };
      // A bill that needs Morpho waits for a fresh read; another bill that cash alone covers is still paid.
      if (!fresh) { stale = true; continue; }
      if (idle + redeemable >= amount) return { ...base, kind: "PAY_BILL", withdrawMinor: (amount - idle).toString(), transferMinor: amount.toString(), bill: bill_, explanation: `A ${usdcText(amount)} bill ${when}. Take the missing ${usdcText(amount - idle)} out of Morpho into the vault, then pay the recipient you approved.` };
    }
    if (stale) return no("A bill is due but the vault's Morpho position could not be read fresh. It is paid as soon as it can be.");
    if (due.length) return no("A bill is due but the vault cannot cover it right now (its cash and Morpho position are short, or the contract's 24-hour payment budget is used up). Pay it yourself from Obligations.");
  }

  // Cash kept back for approved bills inside the protection window; the rest is managed like the custodial agent.
  const lead = effectiveProtectionLeadDays(input.workspace.policy, { autopilotActive });
  const soon = vaultPays.filter((bill) => bill.obligation.status === "OVERDUE" || Date.parse(bill.obligation.dueAt) - now.getTime() <= lead * DAY_MS)
    .reduce((sum, bill) => sum + BigInt(bill.obligation.amount.minorUnits), 0n);
  const cash = input.returnAll ? idle : idle > soon ? idle - soon : 0n;
  const workspace = { ...input.workspace, obligations: input.workspace.obligations.filter((item) => !managedIds.has(item.id)) };
  const decision = decideAutopilot({ workspace, ownerPositions: input.ownerPositions, agentPosition: input.vaultPosition, mandate: input.mandate, cashMinor: cash.toString(), spentMinor: input.spentMinor, feeReserveMinor: "0", returnAll: input.returnAll, now });
  if (decision.kind === "INVEST") {
    const room = input.depositRoomMinor;
    if (room <= 0n) return { ...decision, kind: "NO_ACTION", depositMinor: "0", explanation: "The vault's 24-hour deposit limit is used up. Investing resumes when it frees up." };
    if (BigInt(decision.depositMinor) > room) return { ...decision, depositMinor: room.toString(), explanation: decision.explanation + " Capped by the vault's 24-hour deposit limit." };
  }
  return decision;
}
