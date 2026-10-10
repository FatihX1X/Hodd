import { assessTreasury, previewAllocation } from "@/lib/treasury/engine";
import { assessEarnOperation } from "@/lib/earn/server-policy";
import type { EarnPosition } from "@/lib/earn/models";
import type { Money, TreasuryWorkspace } from "@/lib/treasury/models";
import { validateMandate, type Decision, type Mandate } from "./models";
export const money = (n: bigint): Money => ({ currency: "USDC", decimals: 6, minorUnits: (n > 0n ? n : 0n).toString() });
const min = (...v: bigint[]) => v.reduce((a,b) => a < b ? a : b);
const max = (a: bigint,b: bigint) => a > b ? a : b;
export interface DecisionInputs { workspace: TreasuryWorkspace; ownerPositions: EarnPosition[]; agentPosition: EarnPosition; mandate: Mandate; cashMinor: string; spentMinor: string; feeReserveMinor: string; returnAll?: boolean; now?: Date; }
/** Integer amounts only. Balances/positions are supplied by the server, never the browser or an LLM. */
export function decideAutopilot(i: DecisionInputs): Decision {
  const now = i.now ?? new Date();
  const m = validateMandate({ ...i.mandate, maxMorphoBps: i.workspace.policy.enabledStrategies.MORPHO ? Math.min(i.mandate.maxMorphoBps, i.workspace.policy.strategyCapsBps.MORPHO) : 0 }, i.workspace.policy);
  const cash = BigInt(i.cashMinor), position = BigInt(i.agentPosition.currentBalance.minorUnits), fee = BigInt(i.feeReserveMinor);
  const remaining = max(0n, BigInt(m.budgetMinor) - BigInt(i.spentMinor));
  const available = min(remaining, cash + position);
  const limit = min(available, BigInt(m.maxPerRunMinor));
  const protectedMinor = assessTreasury(i.workspace, now).protectedCapital.minorUnits;
  const d: Decision = { kind: "NO_ACTION", depositMinor: "0", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: remaining.toString(), protectedMinor, explanation: "No safe movement is required." };
  const no = (reason: string) => ({ ...d, explanation: reason });
  if ((!m.enabled || m.paused) && !i.returnAll) return no("The mandate is disabled or paused.");
  if (limit <= fee) return no("The remaining funded budget cannot cover the fee reserve.");
  const positions = [...i.ownerPositions, i.agentPosition];
  if (positions.some(p => p.liquidityStatus !== "READY" || now.getTime() - Date.parse(p.observedAt) > 60_000 || Date.parse(p.observedAt) > now.getTime() + 5000)) return no("Fresh balances and redeemable positions are required.");
  const redeemable = min(position, BigInt(i.agentPosition.redeemable.minorUnits));
  const liquid = max(0n, cash - fee);
  // One economic leg per decision: after withdrawal a fresh run decides the transfer.
  if (i.returnAll) {
    if (redeemable > 0n && cash >= fee) return { ...d, kind: "RETURN_ALL", withdrawMinor: min(redeemable, limit - fee).toString(), explanation: "Redeem the safely withdrawable agent position before returning cash. The mandate is paused." };
    if (liquid > 0n) return { ...d, kind: "RETURN_ALL", transferMinor: min(liquid, limit - fee).toString(), explanation: "Return funded agent cash to the verified owner, retaining the maximum network fee." };
    return no("No return is possible without liquid gas funds or withdrawable assets.");
  }
  const a = assessTreasury(i.workspace, now);
  const coverage = (BigInt(a.upcomingObligations.minorUnits) * BigInt(i.workspace.policy.minimumLiquidityCoverageBps) + 9999n) / 10000n;
  const shortfall = max(0n, max(BigInt(a.protectedCapital.minorUnits), coverage) - BigInt(i.workspace.liquidUsdc.minorUnits));
  if (shortfall > 0n) {
    if (liquid > 0n) return { ...d, kind: "LIQUIDITY_TOP_UP", transferMinor: min(shortfall, liquid, limit - fee).toString(), explanation: "The owner's liquid USDC is below protected obligations and coverage. Send only the capped shortfall from the agent wallet." };
    const amount = min(shortfall + fee, redeemable, limit - fee);
    if (amount > 0n && cash >= fee) return { ...d, kind: "LIQUIDITY_TOP_UP", withdrawMinor: amount.toString(), explanation: "Withdraw agent Morpho assets to cover the owner's protected liquidity shortfall. A fresh decision precedes the transfer." };
    return no("Liquidity is needed but the agent has insufficient cash for fees or redeemable assets.");
  }
  if (cash < BigInt(m.reserveMinor) + fee) {
    const amount = min(BigInt(m.reserveMinor) + fee - cash, redeemable, limit - fee);
    if (amount > 0n && cash >= fee) return { ...d, kind: "RESERVE_REFILL", withdrawMinor: amount.toString(), explanation: "Refill the mandate's agent cash reserve from safely redeemable Morpho assets." };
    return no("The reserve is below target; fund liquid USDC for withdrawal gas.");
  }
  const ownerValue = i.ownerPositions.reduce((s,p)=>s+BigInt(p.currentBalance.minorUnits),0n);
  const managed = min(available, cash + position);
  const combined = { ...i.workspace, totalTreasury: money(BigInt(i.workspace.liquidUsdc.minorUnits) + ownerValue + managed), liquidUsdc: money(BigInt(i.workspace.liquidUsdc.minorUnits) + min(cash, managed)), strategies: [{ id: "autopilot-morpho", name: "Morpho", kind: "MORPHO" as const, balance: money(ownerValue + position), redeemable: money(positions.reduce((s,p)=>s+BigInt(p.redeemable.minorUnits),0n)), apyBps: null, risk: "MODERATE" as const, liquidity: "VARIABLE" as const, integration: "LIVE" as const }], targetAllocationsBps: { LIQUID: 10000-m.maxMorphoBps, MORPHO: m.maxMorphoBps, USYC: 0, BTC_RESERVE: 0 } };
  const allocation = previewAllocation(combined, assessTreasury(combined, now));
  const allowed = BigInt(allocation.lines.find(l=>l.strategy === "MORPHO")!.approved.minorUnits);
  const ownCap = max(0n, managed - fee) * BigInt(m.maxMorphoBps) / 10000n;
  const amount = min(max(0n, allowed-ownerValue-position), max(0n, ownCap-position), max(0n,cash-BigInt(m.reserveMinor)-fee), limit-fee);
  if (amount <= 0n) return no("Cash reserve, protected capital and Morpho caps leave no investable budget.");
  if (assessEarnOperation(combined, positions, "DEPOSIT", money(amount), money(fee), now).status !== "PASS") return no("The existing Earn policy blocks investment of this budget.");
  return { ...d, kind: "INVEST", depositMinor: amount.toString(), explanation: "Invest only arrived agent cash after fees and reserve, within the engine's deployable capital and both Morpho caps." };
}
