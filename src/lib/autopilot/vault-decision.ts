import { assessTreasury, effectiveProtectionLeadDays } from "@/lib/treasury/engine";
import type { EarnPosition } from "@/lib/earn/models";
import type { Obligation, TreasuryWorkspace } from "@/lib/treasury/models";
import { VAULT_NO_LIMIT } from "./vault";
import type { VaultUsyc } from "./vault-state";
import type { Decision, Mandate, Route } from "./models";

const DAY_MS = 86_400_000;
const USDC = 1_000_000n;
const usdcText = (minor: bigint) => (Number(minor) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " USDC";
const pct = (bps: number | null) => bps === null ? "unknown" : `${(bps / 100).toFixed(2)}%`;
const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));
const max = (a: bigint, b: bigint) => (a > b ? a : b);
/** A bill the vault pays is paid no later than this before it falls due (or at once if it is overdue). */
export const VAULT_PAY_WINDOW_MS = DAY_MS;
/** Below this an investment or a move between strategies costs more in fees than it is worth. */
export const VAULT_MIN_MOVE_MINOR = USDC;
/** Two yields closer than this are treated as equal: new cash is then split evenly between the strategies. */
export const VAULT_APY_TIE_BPS = 50;

/** A bill as the vault sees it: the owner's approval of its recipient on the contract, and whether a payment is open. */
export type VaultBill = Readonly<{ obligation: Obligation; approved: boolean; capMinor: bigint; busy: boolean }>;
export type VaultBillPlan = "PAYS" | "NEEDS_APPROVAL" | "CAP_TOO_LOW" | "NO_RECIPIENT" | "IN_FLIGHT" | "OVER_LIMIT";
/** maxPaymentPerTx is the vault's own setting; new vaults (and lifted ones) have none. */
export function vaultBillPlan(bill: VaultBill, maxPaymentPerTx: bigint = VAULT_NO_LIMIT): VaultBillPlan {
  if (!bill.obligation.recipientAddress) return "NO_RECIPIENT";
  // The contract never pays more than this in one payment, whatever cap a recipient has.
  if (BigInt(bill.obligation.amount.minorUnits) > maxPaymentPerTx) return "OVER_LIMIT";
  if (bill.busy) return "IN_FLIGHT";
  if (!bill.approved) return "NEEDS_APPROVAL";
  return bill.capMinor < BigInt(bill.obligation.amount.minorUnits) ? "CAP_TOO_LOW" : "PAYS";
}
const open = (o: Obligation) => (o.status === "UPCOMING" || o.status === "OVERDUE") && o.amount.currency === "USDC" && BigInt(o.amount.minorUnits) > 0n;

export interface VaultDecisionInputs {
  workspace: TreasuryWorkspace; ownerPositions: EarnPosition[];
  /** The vault's Morpho position. */
  vaultPosition: EarnPosition;
  /** The vault's place in Hodd's USYC pool; null or absent when it cannot be read (USYC is then left alone). */
  usyc?: VaultUsyc | null;
  /** Recent yields in basis points a year; null when unknown. */
  apy?: { morphoBps: number | null; usycBps: number | null };
  /** Only enabled and paused are used: the budget, per-run cap, reserve and Morpho share do not bind the vault agent. */
  mandate: Mandate;
  idleMinor: string; spentMinor?: string; returnAll?: boolean; bills: readonly VaultBill[];
  /** What the contract still lets the agent deposit and pay now (unbounded unless the owner set limits). */
  depositRoomMinor: bigint; paymentRoomMinor: bigint; maxPaymentPerTxMinor?: bigint;
  agentGasMinor: string; feeReserveMinor: string; now?: Date;
  /** Another payment of this user is still open in the ledger; a bill can only be marked PAID once it settles. */
  ledgerBusy?: boolean;
  /** What the agent wallet still holds from the custodial mode: Morpho shares, their value, and its USDC. */
  custodial?: { shares: bigint; positionMinor: bigint; cashMinor: bigint };
}
/** The agent keeps this much USDC for its own network fees; anything above it belongs in the vault. */
export const AGENT_FEE_FLOAT_MINOR = 500_000n;
export const NOTHING_TO_INVEST = "Nothing new to invest: the vault's free cash is below 1 USDC after what it keeps for bills.";

const route = (patch: Partial<Record<keyof Route, bigint>>): Route => ({ depositMorphoMinor: (patch.depositMorphoMinor ?? 0n).toString(), depositUsycMinor: (patch.depositUsycMinor ?? 0n).toString(), withdrawMorphoMinor: (patch.withdrawMorphoMinor ?? 0n).toString(), withdrawUsycMinor: (patch.withdrawUsycMinor ?? 0n).toString() });
/** Legacy runs (before USYC) carry no route: everything they move is Morpho. */
export function routeOf(d: Pick<Decision, "route" | "depositMinor" | "withdrawMinor">): Route {
  return d.route ?? route({ depositMorphoMinor: BigInt(d.depositMinor), withdrawMorphoMinor: BigInt(d.withdrawMinor) });
}

/** Everything the decision and the per-leg checks read, derived once from the inputs. */
export function vaultState(input: VaultDecisionInputs) {
  const now = input.now ?? new Date();
  const idle = BigInt(input.idleMinor);
  const freshAt = (observedAt: string) => { const at = Date.parse(observedAt); return now.getTime() - at <= 60_000 && at <= now.getTime() + 5_000; };
  const morphoFresh = input.vaultPosition.liquidityStatus === "READY" && freshAt(input.vaultPosition.observedAt);
  const morphoValue = BigInt(input.vaultPosition.currentBalance.minorUnits);
  const morphoRedeemable = morphoFresh ? min(morphoValue, BigInt(input.vaultPosition.redeemable.minorUnits)) : 0n;
  const usyc = input.usyc ?? null;
  const usycFresh = Boolean(usyc && usyc.ready && freshAt(usyc.observedAt));
  const usycValue = usyc?.valueMinor ?? 0n;
  const usycRedeemable = usycFresh ? min(usycValue, usyc!.redeemableMinor) : 0n;
  const usycRoom = usycFresh ? min(usyc!.depositRoomMinor, input.depositRoomMinor) : 0n;
  const morphoRoom = morphoFresh ? input.depositRoomMinor : 0n;
  const perTx = input.maxPaymentPerTxMinor ?? VAULT_NO_LIMIT;
  const plan = (bill: VaultBill) => vaultBillPlan(bill, perTx);
  const vaultPays = input.bills.filter((bill) => open(bill.obligation) && plan(bill) === "PAYS");
  const managedIds = new Set(input.bills.filter((bill) => open(bill.obligation) && (plan(bill) === "PAYS" || plan(bill) === "IN_FLIGHT")).map((bill) => bill.obligation.id));
  const autopilotActive = input.mandate.enabled && !input.mandate.paused && !input.returnAll;
  const lead = effectiveProtectionLeadDays(input.workspace.policy, { autopilotActive });
  const keep = vaultPays.filter((bill) => bill.obligation.status === "OVERDUE" || Date.parse(bill.obligation.dueAt) - now.getTime() <= lead * DAY_MS).reduce((sum, bill) => sum + BigInt(bill.obligation.amount.minorUnits), 0n);
  const due = vaultPays.filter((bill) => bill.obligation.status === "OVERDUE" || Date.parse(bill.obligation.dueAt) - now.getTime() <= VAULT_PAY_WINDOW_MS)
    .sort((a, b) => Date.parse(a.obligation.dueAt) - Date.parse(b.obligation.dueAt) || a.obligation.id.localeCompare(b.obligation.id));
  const freeCash = max(0n, idle - keep);
  const apy = input.apy ?? { morphoBps: input.vaultPosition.apyBps ?? null, usycBps: null };
  return { now, idle, morphoFresh, morphoValue, morphoRedeemable, usyc, usycFresh, usycValue, usycRedeemable, usycRoom, morphoRoom, vaultPays, managedIds, autopilotActive, keep, due, freeCash, apy };
}
export type VaultState = ReturnType<typeof vaultState>;

/**
 * How new cash splits between the strategies when the advisor does not decide: the higher recent yield takes it
 * all, yields within half a point split it evenly, and a strategy that cannot take a deposit right now gets nothing
 * (USYC also not beyond what the pool accepts). What neither can take stays in the vault as cash.
 */
export function splitDeposit(amount: bigint, s: Pick<VaultState, "morphoRoom" | "usycRoom" | "apy">) {
  const morphoOk = s.morphoRoom > 0n, usycOk = s.usycRoom > 0n;
  let usyc = 0n;
  if (usycOk && !morphoOk) usyc = amount;
  else if (usycOk && morphoOk) {
    const m = s.apy.morphoBps, u = s.apy.usycBps;
    if (m === null && u === null) usyc = amount / 2n;
    else if (m === null) usyc = amount;
    else if (u === null) usyc = 0n;
    else if (Math.abs(m - u) < VAULT_APY_TIE_BPS) usyc = amount / 2n;
    else usyc = u > m ? amount : 0n;
  }
  usyc = min(usyc, s.usycRoom);
  const morpho = morphoOk ? min(amount - usyc, s.morphoRoom) : 0n;
  return { morpho, usyc };
}

/**
 * Autopilot in vault mode. The agent is bounded only by where it can send money: the Morpho vault, Hodd's USYC pool,
 * recipients the owner approved (up to each one's cap) and the owner. Amounts are the agent's call:
 * 1. what the custodial agent still holds moves into the vault;
 * 2. a return sends everything (both strategies, then cash) to the owner;
 * 3. an approved bill due within a day or overdue is paid, redeeming the missing part from Morpho, then USYC;
 * 4. the owner's own protected bills (the ones not approved for the vault) are topped up in the owner's wallet;
 * 5. approved bills inside the protection window bring their amount back to the vault's cash;
 * 6. the rest is invested, the higher yield first.
 * Network fees are paid by the agent wallet, not the vault. The advisor decides 5 and 6: it may invest the whole
 * balance, keep money invested until a bill's payment day, split between the strategies or move between them
 * (vault-advisor.ts). Step 3 always pays a due bill, whatever the advisor did before.
 */
export function decideVault(input: VaultDecisionInputs): Decision {
  const s = vaultState(input);
  const base: Decision = { kind: "NO_ACTION", depositMinor: "0", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: "0", protectedMinor: "0", explanation: "No safe movement is required." };
  const no = (explanation: string): Decision => ({ ...base, explanation });

  // 1. Funds the agent still holds from the custodial mode go into the owner's vault first (a return then takes them too).
  const custodial = input.custodial;
  if (custodial && (s.autopilotActive || input.returnAll) && (custodial.shares > 0n || custodial.cashMinor > AGENT_FEE_FLOAT_MINOR * 2n) && BigInt(input.agentGasMinor) >= BigInt(input.feeReserveMinor)) {
    const cash = custodial.cashMinor > AGENT_FEE_FLOAT_MINOR * 2n ? custodial.cashMinor - AGENT_FEE_FLOAT_MINOR : 0n;
    return { ...base, kind: "MOVE_TO_VAULT", withdrawMinor: custodial.positionMinor.toString(), transferMinor: cash.toString(), explanation: `Your agent still holds ${usdcText(custodial.positionMinor + cash)} from before your vault. Move its Morpho shares and cash into your vault, keeping ${usdcText(AGENT_FEE_FLOAT_MINOR)} for network fees.` };
  }

  // 2. Everything back to the owner: both strategies (redeemed straight to the owner), then the vault's cash.
  if (input.returnAll) {
    const morphoHeld = s.morphoValue > 0n, usycHeld = (s.usyc?.shares ?? 0n) > 0n;
    if (morphoHeld && !s.morphoFresh) return no("A fresh read of the vault's Morpho position is required before returning funds.");
    if (!morphoHeld && !usycHeld && s.idle === 0n) return no("The vault is empty: there is nothing to return.");
    // While Circle pauses the pool (or it cannot be read) the rest still goes back; USYC follows with the next return.
    const usycNow = usycHeld && s.usycFresh;
    if (!morphoHeld && !usycNow && s.idle === 0n) return no("Your USYC position cannot be redeemed right now (Circle has paused the pool or it cannot be read). Try again shortly, or take it back yourself from Your vault.");
    const withdraw = (morphoHeld ? s.morphoValue : 0n) + (usycNow ? s.usycValue : 0n);
    const later = usycHeld && !usycNow ? " The USYC position stays until the pool can pay out; return again then." : "";
    return { ...base, kind: "RETURN_ALL", withdrawMinor: withdraw.toString(), transferMinor: s.idle.toString(), route: route({ withdrawMorphoMinor: morphoHeld ? s.morphoValue : 0n, withdrawUsycMinor: usycNow ? s.usycValue : 0n }), explanation: `Send everything to your wallet: ${[morphoHeld && "redeem the Morpho position", usycNow && "redeem the USYC position", s.idle > 0n && "send the vault's cash"].filter(Boolean).join(", then ")}.${later}` };
  }

  if (!s.autopilotActive) return no("The mandate is disabled or paused.");
  if (BigInt(input.agentGasMinor) < BigInt(input.feeReserveMinor)) return no("The agent wallet needs a little USDC for network fees before it can act. Invest again or send it a few cents.");

  // 3. Approved bills that are due: from cash, then Morpho, then USYC.
  if (s.due.length && input.ledgerBusy) return no("A bill is due, but another payment is still being confirmed. Autopilot pays once it settles; if it stays open, resolve it on Obligations.");
  let stale = false;
  for (const bill of s.due) {
    const amount = BigInt(bill.obligation.amount.minorUnits);
    if (amount > input.paymentRoomMinor) continue;
    const bill_ = { obligationId: bill.obligation.id, recipient: bill.obligation.recipientAddress!, amountMinor: amount.toString(), dueAt: bill.obligation.dueAt };
    const when = bill.obligation.status === "OVERDUE" || Date.parse(bill.obligation.dueAt) <= s.now.getTime() ? "is due now" : "falls due within a day";
    if (s.idle >= amount) return { ...base, kind: "PAY_BILL", transferMinor: amount.toString(), bill: bill_, route: route({}), explanation: `A ${usdcText(amount)} bill ${when}. Pay it from the vault's cash to the recipient you approved.` };
    const need = amount - s.idle;
    if (s.morphoRedeemable + s.usycRedeemable < need) {
      // A bill that needs a strategy waits for a fresh read; another bill that cash alone covers is still paid.
      if (!s.morphoFresh || ((s.usyc?.shares ?? 0n) > 0n && !s.usycFresh)) stale = true;
      continue;
    }
    const fromMorpho = min(need, s.morphoRedeemable), fromUsyc = need - fromMorpho;
    const sources = [fromMorpho > 0n && `${usdcText(fromMorpho)} from Morpho`, fromUsyc > 0n && `${usdcText(fromUsyc)} from USYC`].filter(Boolean).join(" and ");
    return { ...base, kind: "PAY_BILL", withdrawMinor: need.toString(), transferMinor: amount.toString(), bill: bill_, route: route({ withdrawMorphoMinor: fromMorpho, withdrawUsycMinor: fromUsyc }), explanation: `A ${usdcText(amount)} bill ${when}. Take the missing ${sources} into the vault, then pay the recipient you approved.` };
  }
  if (stale) return no("A bill is due but the vault's Morpho or USYC position could not be read fresh. It is paid as soon as it can be.");
  if (s.due.length) return no("A bill is due but the vault cannot cover it right now (its cash and redeemable positions are short, or a payment limit you set on the vault is used up). Pay it yourself from Obligations.");

  // 4. The owner's own bills (not approved for the vault) inside the protection window: top up the owner's wallet.
  const fresh = (p: EarnPosition) => p.liquidityStatus === "READY" && s.now.getTime() - Date.parse(p.observedAt) <= 60_000 && Date.parse(p.observedAt) <= s.now.getTime() + 5_000;
  if (!input.ownerPositions.every(fresh)) return no("Fresh balances and redeemable positions are required.");
  const workspace = { ...input.workspace, strategies: input.workspace.strategies.filter((strategy) => strategy.kind !== "USYC"), obligations: input.workspace.obligations.filter((item) => !s.managedIds.has(item.id)) };
  const assessment = assessTreasury(workspace, s.now, { autopilotActive: true });
  const coverage = (BigInt(assessment.upcomingObligations.minorUnits) * BigInt(workspace.policy.minimumLiquidityCoverageBps) + 9999n) / 10000n;
  const shortfall = max(0n, max(BigInt(assessment.protectedCapital.minorUnits), coverage) - BigInt(workspace.liquidUsdc.minorUnits));
  const protectedMinor = assessment.protectedCapital.minorUnits;
  if (shortfall > 0n) {
    const top = { ...base, kind: "LIQUIDITY_TOP_UP" as const, protectedMinor };
    if (s.freeCash > 0n) return { ...top, transferMinor: min(shortfall, s.freeCash).toString(), route: route({}), explanation: `Your wallet is ${usdcText(shortfall)} short of the bills you pay yourself. Send that from the vault's cash to your wallet.` };
    if (s.morphoRedeemable > 0n) { const amount = min(shortfall, s.morphoRedeemable); return { ...top, withdrawMinor: amount.toString(), route: route({ withdrawMorphoMinor: amount }), explanation: `Your wallet is ${usdcText(shortfall)} short of the bills you pay yourself. Redeem ${usdcText(amount)} from Morpho straight to your wallet.` }; }
    if (s.usycRedeemable > 0n) { const amount = min(shortfall, s.usycRedeemable); return { ...top, withdrawMinor: amount.toString(), route: route({ withdrawUsycMinor: amount }), explanation: `Your wallet is ${usdcText(shortfall)} short of the bills you pay yourself. Redeem ${usdcText(amount)} from USYC straight to your wallet.` }; }
    return { ...base, protectedMinor, explanation: "Your wallet is short of the bills you pay yourself, but the vault has no free cash or redeemable position to send right now." };
  }

  // 5. Back to cash for approved bills inside the protection window. The advisor may instead keep the money invested
  //    until the bill's payment day, when step 3 takes whatever is missing out of the strategies.
  const short = s.keep > s.idle ? s.keep - s.idle : 0n;
  if (short >= VAULT_MIN_MOVE_MINOR && s.morphoRedeemable + s.usycRedeemable >= VAULT_MIN_MOVE_MINOR) {
    const fromMorpho = min(short, s.morphoRedeemable), fromUsyc = min(short - fromMorpho, s.usycRedeemable);
    const sources = [fromMorpho > 0n && `${usdcText(fromMorpho)} from Morpho`, fromUsyc > 0n && `${usdcText(fromUsyc)} from USYC`].filter(Boolean).join(" and ");
    return { ...base, kind: "RESERVE_REFILL", protectedMinor, withdrawMinor: (fromMorpho + fromUsyc).toString(), route: route({ withdrawMorphoMinor: fromMorpho, withdrawUsycMinor: fromUsyc }), explanation: `Approved bills of ${usdcText(s.keep)} fall due soon and the vault holds ${usdcText(s.idle)} as cash. Bring ${sources} back to the vault's cash.` };
  }

  // 6. Invest the free cash, the higher yield first.
  if (s.freeCash < VAULT_MIN_MOVE_MINOR) return { ...base, protectedMinor, explanation: NOTHING_TO_INVEST };
  if (input.depositRoomMinor <= 0n) return { ...base, protectedMinor, explanation: "A deposit limit you set on the vault is used up for the last 24 hours. Investing resumes when it frees up." };
  const split = splitDeposit(min(s.freeCash, input.depositRoomMinor), s);
  const total = split.morpho + split.usyc;
  if (total < VAULT_MIN_MOVE_MINOR) return { ...base, protectedMinor, explanation: "Neither Morpho nor USYC can take a deposit right now (a stale read, or the USYC pool is closed to new deposits). The cash stays in the vault." };
  const parts = [split.morpho > 0n && `${usdcText(split.morpho)} into Morpho (recent yield ${pct(s.apy.morphoBps)})`, split.usyc > 0n && `${usdcText(split.usyc)} into USYC (recent yield ${pct(s.apy.usycBps)})`].filter(Boolean).join(" and ");
  const kept = s.keep > 0n ? ` ${usdcText(min(s.keep, s.idle))} stays as cash for approved bills.` : "";
  return { ...base, kind: "INVEST", depositMinor: total.toString(), protectedMinor, route: route({ depositMorphoMinor: split.morpho, depositUsycMinor: split.usyc }), explanation: `Invest ${parts}.${kept}` };
}
