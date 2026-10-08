import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { treasuryWorkspaceSchema, type Money, type Obligation, type StrategyKind, type TreasuryWorkspace } from "@/lib/treasury/models";
import { moneyToInput, parseMoneyInput } from "@/lib/treasury/money";
import { makeActivity } from "@/lib/treasury/live";
import { formatMoney } from "@/lib/treasury/format";

// Pure workspace changes shared by the prepare (preview) and confirm (apply) tools,
// so what Claude shows the user is exactly what gets written.

const amount = z.string().trim().regex(/^\d+(\.\d{1,6})?$/, "Use a USDC amount like 125 or 125.50 (max 6 decimals).").describe("USDC amount, e.g. \"125.50\"");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").describe("Due date, YYYY-MM-DD");
const address = z.string().trim().refine((value) => isAddress(value, { strict: false }), "Enter a valid 0x… Arc address.").describe("Recipient Arc wallet address (0x…), needed for payments");
const category = z.enum(["PAYROLL", "VENDOR", "SUBSCRIPTION", "RENT", "TAX", "OTHER"]);
const priority = z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]);
const bps = z.number().int().min(0).max(10_000);

export const createObligationChange = z.object({
  title: z.string().trim().min(1).max(80),
  amount, dueDate: date, category: category.default("OTHER"), priority: priority.default("NORMAL"),
  status: z.enum(["UPCOMING", "DRAFT"]).default("UPCOMING").describe("UPCOMING is protected in treasury math; DRAFT is not"),
  recipient: z.string().trim().max(120).optional().describe("Recipient name"),
  recipientAddress: address.optional(),
  description: z.string().trim().max(500).optional(),
}).strict();

export const updateObligationChange = z.object({
  obligationId: z.string().min(1),
  title: z.string().trim().min(1).max(80).optional(), amount: amount.optional(), dueDate: date.optional(),
  category: category.optional(), priority: priority.optional(),
  status: z.enum(["UPCOMING", "DRAFT", "OVERDUE"]).optional().describe("PAID is set only by a verified onchain payment"),
  recipient: z.string().trim().max(120).nullable().optional(), recipientAddress: address.nullable().optional(),
  description: z.string().trim().max(500).optional(),
}).strict();

export const updatePolicyChange = z.object({
  safetyBuffer: z.string().trim().regex(/^\d+(\.\d{1,6})?$/).optional().describe("Minimum USDC always kept liquid"),
  minimumLiquidityCoverageBps: z.number().int().min(0).max(100_000).optional().describe("Minimum liquidity coverage in basis points (10000 = 100%)"),
  strategyCapsBps: z.object({ LIQUID: bps, MORPHO: bps, USYC: bps, BTC_RESERVE: bps }).partial().optional().describe("Max share of deployable capital per strategy, basis points"),
  enabledStrategies: z.object({ LIQUID: z.boolean(), MORPHO: z.boolean(), USYC: z.boolean(), BTC_RESERVE: z.boolean() }).partial().optional(),
}).strict();

export const setTargetsChange = z.object({
  targetsBps: z.object({ LIQUID: bps, MORPHO: bps, USYC: bps, BTC_RESERVE: bps }).strict().describe("Target allocation of deployable capital, basis points, must total 10000"),
}).strict();

export const paymentRequestChange = z.object({ obligationId: z.string().min(1) }).strict();
export const earnRequestChange = z.object({
  operation: z.enum(["DEPOSIT", "WITHDRAW", "REDEEM_ALL"]),
  amount: amount.optional().describe("Required for DEPOSIT and WITHDRAW"),
  vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().describe("Allowlisted Morpho vault; defaults to the first verified vault"),
}).strict();

export const changeSchemas = {
  CREATE_OBLIGATION: createObligationChange, UPDATE_OBLIGATION: updateObligationChange, UPDATE_POLICY: updatePolicyChange,
  SET_TARGETS: setTargetsChange, PAYMENT_REQUEST: paymentRequestChange, EARN_REQUEST: earnRequestChange,
} as const;
export type ChangeKind = keyof typeof changeSchemas;
export type ChangeOf<K extends ChangeKind> = z.infer<(typeof changeSchemas)[K]>;
export const REQUEST_KINDS: readonly ChangeKind[] = ["PAYMENT_REQUEST", "EARN_REQUEST"];

const usdc = (value: string) => parseMoneyInput(value, "USDC", 6);
const usdcOrZero = (value: string): Money => /^0+(\.0+)?$/.test(value.trim()) ? { currency: "USDC", decimals: 6, minorUnits: "0" } : usdc(value);
const show = (money: Money) => formatMoney(money, { fractionDigits: 2 });

function activeObligation(workspace: TreasuryWorkspace, id: string): Obligation {
  const obligation = workspace.obligations.find((item) => item.id === id);
  if (!obligation) throw new Error(`No obligation with id ${id}.`);
  return obligation;
}

export type AppliedChange = { workspace: TreasuryWorkspace; summary: string; lines: string[] };

/** Validates and applies one change. Throws a user-readable Error when the change is not allowed. */
export function applyChange(workspace: TreasuryWorkspace, kind: ChangeKind, rawChange: unknown, now: Date, newId: () => string = () => crypto.randomUUID()): AppliedChange {
  const stamp = now.toISOString();
  const finish = (next: TreasuryWorkspace, action: string, summary: string, lines: string[]): AppliedChange => {
    const withActivity = { ...next, updatedAt: stamp, activities: [makeActivity(action, summary, "Approved by the user in Claude (Hodd connector).", stamp, "AGENT", "APPROVED"), ...next.activities] };
    return { workspace: treasuryWorkspaceSchema.parse(withActivity), summary, lines };
  };
  const locked = (id: string) => workspace.paymentReservations?.some((item) => item.obligationId === id);
  const anyPaymentPending = Boolean(workspace.paymentReservations?.length);

  switch (kind) {
    case "CREATE_OBLIGATION": {
      const change = createObligationChange.parse(rawChange);
      if (anyPaymentPending) throw new Error("A payment is pending in Hodd; finish or review it before changing obligations.");
      const obligation: Obligation = { id: newId(), revision: 1, title: change.title, category: change.category, amount: usdc(change.amount), dueAt: `${change.dueDate}T17:00:00.000Z`, recipient: change.recipient?.trim() || null, recipientAddress: change.recipientAddress ? getAddress(change.recipientAddress) : null, priority: change.priority, status: change.status, description: change.description?.trim() ?? "" };
      const summary = `${obligation.title}: ${show(obligation.amount)} due ${change.dueDate} (${obligation.status.toLowerCase()}).`;
      return finish({ ...workspace, obligations: [...workspace.obligations, obligation] }, "Obligation created via Claude", summary, [`New obligation ${summary}`, `Recipient: ${obligation.recipient ?? "—"} ${obligation.recipientAddress ?? ""}`.trim()]);
    }
    case "UPDATE_OBLIGATION": {
      const change = updateObligationChange.parse(rawChange);
      const previous = activeObligation(workspace, change.obligationId);
      if (previous.status === "PAID") throw new Error("Paid obligations cannot be edited.");
      if (locked(previous.id) || anyPaymentPending) throw new Error("A payment is pending in Hodd; finish or review it before changing obligations.");
      const next: Obligation = {
        ...previous,
        ...(change.title !== undefined ? { title: change.title } : {}),
        ...(change.amount !== undefined ? { amount: usdc(change.amount) } : {}),
        ...(change.dueDate !== undefined ? { dueAt: `${change.dueDate}T17:00:00.000Z` } : {}),
        ...(change.category !== undefined ? { category: change.category } : {}),
        ...(change.priority !== undefined ? { priority: change.priority } : {}),
        ...(change.status !== undefined ? { status: change.status } : {}),
        ...(change.recipient !== undefined ? { recipient: change.recipient?.trim() || null } : {}),
        ...(change.recipientAddress !== undefined ? { recipientAddress: change.recipientAddress ? getAddress(change.recipientAddress) : null } : {}),
        ...(change.description !== undefined ? { description: change.description.trim() } : {}),
        revision: (previous.revision ?? 1) + 1,
      };
      const lines = [
        previous.title !== next.title ? `Title: ${previous.title} → ${next.title}` : null,
        previous.amount.minorUnits !== next.amount.minorUnits ? `Amount: ${show(previous.amount)} → ${show(next.amount)}` : null,
        previous.dueAt !== next.dueAt ? `Due: ${previous.dueAt.slice(0, 10)} → ${next.dueAt.slice(0, 10)}` : null,
        previous.status !== next.status ? `Status: ${previous.status} → ${next.status}` : null,
        previous.category !== next.category ? `Category: ${previous.category} → ${next.category}` : null,
        previous.priority !== next.priority ? `Priority: ${previous.priority} → ${next.priority}` : null,
        previous.recipient !== next.recipient ? `Recipient: ${previous.recipient ?? "—"} → ${next.recipient ?? "—"}` : null,
        (previous.recipientAddress ?? null) !== (next.recipientAddress ?? null) ? `Recipient address: ${previous.recipientAddress ?? "—"} → ${next.recipientAddress ?? "—"}` : null,
        previous.description !== next.description ? "Description updated" : null,
      ].filter((line): line is string => Boolean(line));
      if (!lines.length) throw new Error("Nothing would change.");
      return finish({ ...workspace, obligations: workspace.obligations.map((item) => item.id === previous.id ? next : item) }, "Obligation updated via Claude", `${next.title}: ${lines.join("; ")}`, lines);
    }
    case "UPDATE_POLICY": {
      const change = updatePolicyChange.parse(rawChange);
      if (anyPaymentPending) throw new Error("A payment is pending in Hodd; the policy is locked until it completes.");
      const policy = workspace.policy; const lines: string[] = [];
      const next = { ...policy, strategyCapsBps: { ...policy.strategyCapsBps }, enabledStrategies: { ...policy.enabledStrategies } };
      if (change.safetyBuffer !== undefined) { next.safetyBuffer = usdcOrZero(change.safetyBuffer); lines.push(`Safety buffer: ${show(policy.safetyBuffer)} → ${show(next.safetyBuffer)}`); }
      if (change.minimumLiquidityCoverageBps !== undefined) { next.minimumLiquidityCoverageBps = change.minimumLiquidityCoverageBps; lines.push(`Minimum coverage: ${policy.minimumLiquidityCoverageBps / 100}% → ${change.minimumLiquidityCoverageBps / 100}%`); }
      for (const [key, value] of Object.entries(change.strategyCapsBps ?? {}) as [StrategyKind, number][]) { next.strategyCapsBps[key] = value; lines.push(`${key} cap: ${policy.strategyCapsBps[key] / 100}% → ${value / 100}%`); }
      for (const [key, value] of Object.entries(change.enabledStrategies ?? {}) as [StrategyKind, boolean][]) { next.enabledStrategies[key] = value; lines.push(`${key}: ${policy.enabledStrategies[key] ? "enabled" : "disabled"} → ${value ? "enabled" : "disabled"}`); }
      if (!lines.length) throw new Error("Nothing would change.");
      return finish({ ...workspace, policy: next }, "Treasury policy updated via Claude", lines.join("; "), lines);
    }
    case "SET_TARGETS": {
      const change = setTargetsChange.parse(rawChange);
      const total = Object.values(change.targetsBps).reduce((sum, item) => sum + item, 0);
      if (total !== 10_000) throw new Error(`Targets must total 10000 basis points (100%); they total ${total}.`);
      const lines = (Object.keys(change.targetsBps) as StrategyKind[]).map((key) => `${key}: ${workspace.targetAllocationsBps[key] / 100}% → ${change.targetsBps[key] / 100}%`);
      return finish({ ...workspace, targetAllocationsBps: change.targetsBps }, "Allocation targets updated via Claude", lines.join("; "), [...lines, "Targets only change previews; they never move funds."]);
    }
    case "PAYMENT_REQUEST": {
      const change = paymentRequestChange.parse(rawChange);
      const obligation = activeObligation(workspace, change.obligationId);
      if (!["UPCOMING", "OVERDUE"].includes(obligation.status)) throw new Error("Only upcoming or overdue obligations can be paid.");
      if (!obligation.recipientAddress) throw new Error("This obligation has no recipient address. Add one first.");
      if (locked(obligation.id)) throw new Error("This obligation already has a pending payment.");
      const summary = `Pay ${obligation.title}: ${show(obligation.amount)} to ${obligation.recipientAddress}`;
      return finish(workspace, "Payment requested via Claude", summary, [summary, "Complete it in Hodd: review, confirm and sign with your wallet."]);
    }
    case "EARN_REQUEST": {
      const change = earnRequestChange.parse(rawChange);
      if (change.operation !== "REDEEM_ALL" && !change.amount) throw new Error("An amount is required for deposits and withdrawals.");
      const label = change.operation === "DEPOSIT" ? "Deposit" : change.operation === "WITHDRAW" ? "Withdraw" : "Redeem all";
      const summary = `${label}${change.amount ? ` ${show(usdc(change.amount))}` : ""} ${change.operation === "DEPOSIT" ? "into" : "from"} Morpho`;
      return finish(workspace, "Earn operation requested via Claude", summary, [summary, "Complete it in Hodd: review the fresh quote, confirm and sign with your wallet."]);
    }
  }
}

export const moneyText = (money: Money) => moneyToInput(money);
