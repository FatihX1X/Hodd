import { getAddress, isAddress, zeroAddress } from "viem";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { addUsdc } from "@/lib/earn/money";
import { assessTreasury, getProtectedObligations } from "@/lib/treasury/engine";
import type { Money, Obligation, PolicyResult, TreasuryWorkspace } from "@/lib/treasury/models";
export function paymentRecipient(value: string | null | undefined, wallet: string) {
  if (!value || !isAddress(value)) throw new Error("Enter a valid checksummed Arc recipient address.");
  const address = getAddress(value);
  if ([zeroAddress, ARC_TESTNET_USDC, wallet].some((item) => item.toLowerCase() === address.toLowerCase())) throw new Error("The recipient cannot be zero, the USDC contract or your treasury wallet.");
  return address;
}
export function assessPayment(workspace: TreasuryWorkspace, obligation: Obligation, fees: Money, now = new Date()): PolicyResult {
  const block = (reason: string): PolicyResult => ({ status: "BLOCKED", label: "Payment policy", reason });
  const amounts = [workspace.totalTreasury, workspace.liquidUsdc, workspace.pendingTransactions, obligation.amount, fees, workspace.policy.safetyBuffer, ...workspace.obligations.map((item) => item.amount), ...workspace.strategies.flatMap((item) => [item.balance, item.redeemable])];
  addUsdc(amounts);
  if (amounts.some((item) => !/^\d+$/.test(item.minorUnits))) return block("Payment inputs must be nonnegative integer minor units.");
  if (!workspace.obligations.some((item) => item.id === obligation.id && item.revision === obligation.revision && item.amount.minorUnits === obligation.amount.minorUnits && item.status === obligation.status && item.dueAt === obligation.dueAt)) return block("The obligation does not match the current workspace.");
  if (!["UPCOMING", "OVERDUE"].includes(obligation.status) || BigInt(obligation.amount.minorUnits) <= 0n) return block("Only positive, active obligations can be paid in full.");
  if (workspace.paymentReservations?.some((item) => item.obligationId === obligation.id)) return block("This obligation already has a pending payment.");
  const earlier = getProtectedObligations(workspace, now).filter((item) => item.id !== obligation.id && Date.parse(item.dueAt) <= Date.parse(obligation.dueAt));
  const reserved = addUsdc([workspace.policy.safetyBuffer, workspace.pendingTransactions, ...earlier.map((item) => item.amount)]);
  const required = addUsdc([reserved, obligation.amount, fees]);
  if (BigInt(required.minorUnits) > BigInt(workspace.liquidUsdc.minorUnits)) return block("Liquid USDC cannot cover this payment, fees, safety buffer and earlier obligations. Withdraw separately before requesting a new proposal.");
  const liquid = { ...workspace.liquidUsdc, minorUnits: (BigInt(workspace.liquidUsdc.minorUnits) - BigInt(obligation.amount.minorUnits) - BigInt(fees.minorUnits)).toString() };
  const total = { ...workspace.totalTreasury, minorUnits: (BigInt(workspace.totalTreasury.minorUnits) - BigInt(obligation.amount.minorUnits) - BigInt(fees.minorUnits)).toString() };
  if (BigInt(total.minorUnits) < 0n) return block("Fresh treasury balance is insufficient.");
  const after = assessTreasury({ ...workspace, liquidUsdc: liquid, totalTreasury: total, obligations: workspace.obligations.filter((item) => item.id !== obligation.id) }, now);
  if (after.violations.length) return block("The remaining obligations or liquidity coverage would breach policy.");
  return { status: "PASS", label: "Payment policy", reason: "Full payment and fee reserve preserve safety buffer, pending reservations and the remaining obligations. Deployable capital is not the payment limit." };
}
