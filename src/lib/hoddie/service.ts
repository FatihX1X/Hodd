import "server-only";
import { randomUUID } from "node:crypto";
import { applyChange, changeSchemas, REQUEST_KINDS, type ChangeKind } from "@/lib/agent/changes";
import { liveWorkspace } from "@/lib/agent/context";
import { allocationView, obligationView, overviewView, paymentCheckView, policyView, usdc } from "@/lib/agent/views";
import { estimateTransferFee } from "@/lib/agent/tools";
import { assessTreasury } from "@/lib/treasury/engine";
import { assessEarnOperation } from "@/lib/earn/server-policy";
import { decimalStringToMoney } from "@/lib/earn/money";
import { dueDate, percentageBps, slotValue, type MaskedCommand } from "./privacy";
import { HoddieError, intentSchema, kindSchema, type HoddieIntent, type HoddieResult } from "./models";
import { issueReview, verifyReview, type HoddieContext, type requireConsent } from "./security";
type Consent = Awaited<ReturnType<typeof requireConsent>>;
const zero = { currency: "USDC", decimals: 6, minorUnits: "0" } as const;
const text = (value: unknown): string => value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
const card = (title: string, values: Record<string, unknown>) => ({ title, fields: Object.entries(values).map(([label, value]) => ({ label, value: text(value) })) });
const say = (language: "en" | "tr", en: string, tr: string) => language === "tr" ? tr : en;

async function evaluatedChange(context: HoddieContext, kind: ChangeKind, raw: unknown, newId: string) {
  const change = changeSchemas[kind].parse(raw);
  if ("dueDate" in change && change.dueDate) dueDate("EXPLICIT", String(change.dueDate), "UTC");
  const live = await liveWorkspace(context.workspace);
  if (REQUEST_KINDS.includes(kind) && live.source !== "LIVE") throw new HoddieError("LIVE_DATA_REQUIRED", "Connect a wallet with complete, fresh balances and Morpho positions before preparing a money request.", 409);
  if (kind === "PAYMENT_REQUEST") {
    const id = (change as { obligationId: string }).obligationId;
    const obligation = live.workspace.obligations.find((item) => item.id === id);
    if (!obligation) throw new HoddieError("NOT_FOUND", "Select a current obligation.");
    const fee = await estimateTransferFee(live.workspace, obligation.recipientAddress, obligation.amount);
    const check = paymentCheckView(live.workspace, obligation, fee);
    if (!check.canPayNow) throw new HoddieError("POLICY_BLOCKED", check.policy.reason, 409);
  }
  if (kind === "EARN_REQUEST") {
    const request = change as { operation: "DEPOSIT" | "WITHDRAW" | "REDEEM_ALL"; amount?: string; vaultAddress?: string };
    const vault = live.portfolio?.vaults.find((item) => item.address.toLowerCase() === request.vaultAddress?.toLowerCase());
    if (!vault) throw new HoddieError("VAULT_REQUIRED", "Select a freshly verified vault from Invest.");
    const position = live.portfolio!.positions.find((item) => item.vaultAddress.toLowerCase() === vault.address.toLowerCase());
    const amount = request.operation === "REDEEM_ALL" ? position?.redeemable : request.amount ? decimalStringToMoney(request.amount) : undefined;
    if (!amount || BigInt(amount.minorUnits) <= 0n) throw new HoddieError("AMOUNT_REQUIRED", "Enter a positive amount or choose a funded position.");
    if (request.operation !== "DEPOSIT" && (!position || [position.currentBalance, position.redeemable, position.maxWithdrawable, vault.liquidity].some((limit) => BigInt(amount.minorUnits) > BigInt(limit.minorUnits)))) throw new HoddieError("POLICY_BLOCKED", "The requested withdrawal exceeds this vault's fresh position or available liquidity.", 409);
    const policy = assessEarnOperation(live.workspace, live.portfolio!.positions, request.operation, amount, zero);
    if (policy.status === "BLOCKED") throw new HoddieError("POLICY_BLOCKED", policy.reason, 409);
  }
  // Keep stored balances as stored; only the impact uses a fresh operational view.
  const applied = applyChange(context.workspace, kind, change, new Date(), () => newId, "Hoddie");
  const before = assessTreasury(live.workspace);
  const after = assessTreasury(applyChange(live.workspace, kind, change, new Date(), () => newId, "Hoddie").workspace);
  return { change, applied, live, impact: [{ label: "Deployable capital", before: usdc(before.deployableCapital), after: usdc(after.deployableCapital) }, { label: "Protected capital", before: usdc(before.protectedCapital), after: usdc(after.protectedCapital) }, { label: "Coverage", before: before.coverageStatus, after: after.coverageStatus }] };
}

export async function prepareChange(context: HoddieContext, consent: Consent, kind: ChangeKind, raw: Record<string, unknown>, language: "en" | "tr" = "en"): Promise<HoddieResult> {
  const parsed = changeSchemas[kind].safeParse(raw);
  if (!parsed.success) return { language, message: say(language, "Complete these fields in Hodd, then review the change.", "Bu alanları Hodd içinde tamamla, ardından değişikliği incele."), cards: [], draft: { kind, values: raw } };
  const newId = randomUUID();
  const result = await evaluatedChange(context, kind, parsed.data, newId);
  const { handle, payload } = issueReview(context, consent, "PROPOSAL", { kind, change: result.change, newId });
  return { language, message: say(language, "Review the exact change below. Nothing has been applied.", "Aşağıdaki değişikliği incele. Henüz uygulanmadı."), cards: [], source: result.live.source, observedAt: new Date().toISOString(), proposal: { handle, kind, summary: result.applied.summary, lines: [...result.applied.lines, ...(kind === "EARN_REQUEST" ? ["Request preview excludes final fees. The separate fresh Earn quote determines fees, policy and executable amount."] : [])], expiresAt: new Date(payload.exp).toISOString(), impact: result.impact } };
}

export async function confirmChange(context: HoddieContext, consent: Consent, handle: string) {
  const payload = verifyReview(handle, context, consent, "PROPOSAL");
  const kind = kindSchema.parse(payload.data.kind);
  if (typeof payload.data.newId !== "string") throw new HoddieError("INVALID_CONFIRMATION", "Prepare this change again.");
  const result = await evaluatedChange(context, kind, payload.data.change, payload.data.newId);
  const isRequest = REQUEST_KINDS.includes(kind);
  const { data, error } = await context.client.rpc("hodd_apply_hoddie_action", { p_id: payload.id, p_kind: kind, p_change: result.change, p_summary: result.applied.summary.slice(0, 500), p_status: isRequest ? "OPEN" : "APPLIED", p_expires_at: isRequest ? new Date(Date.now() + 24 * 3_600_000).toISOString() : null, p_workspace: result.applied.workspace, p_revision: context.revision });
  if (error) throw new HoddieError("CONFIRMATION_CONFLICT", "This review was used, the workspace changed, or the save outcome could not be confirmed. Inspect Activity and reload before preparing another change.", 409);
  return { status: "READY" as const, actionId: payload.id, revision: data, kind, change: result.change, request: isRequest };
}

export async function resolveIntent(context: HoddieContext, consent: Consent, intent: HoddieIntent, command: MaskedCommand, timezone: string, selectedId?: string): Promise<HoddieResult> {
  if (["CREATE_OBLIGATION", "UPDATE_OBLIGATION"].includes(intent.action) && intent.status === "PAID") throw new HoddieError("PAID_RECEIPT_REQUIRED", "Only a verified payment receipt can mark an obligation paid. Nothing was changed.");
  if (new Set(intent.targets.map((item) => item.strategy)).size !== intent.targets.length) throw new HoddieError("INVALID_INTENT", "Specify each allocation strategy once.");
  const language = intent.language; const base: HoddieResult = { language, message: say(language, "Here is the current Hodd result.", "Güncel Hodd sonucu burada."), cards: [] };
  if ((intent.dateMode === "TOMORROW" && !/tomorrow|yarın|yarin/i.test(command.text)) || (intent.dateMode === "TODAY" && !/today|bugün|bugun/i.test(command.text))) throw new HoddieError("DATE_REQUIRED", "Specify the date explicitly or use today/tomorrow.");
  const tokenIds = intent.obligationToken ? command.slots[intent.obligationToken]?.obligationIds : undefined;
  if (intent.obligationToken && !tokenIds) throw new HoddieError("INVALID_INTENT", "Select a bill from your current workspace.");
  const selected = intent.useCurrentSelection ? selectedId : tokenIds?.length === 1 ? tokenIds[0] : undefined;
  const needsBill = ["UPDATE_OBLIGATION", "PAYMENT_REQUEST", "CHECK_PAYMENT"].includes(intent.action);
  const date = dueDate(intent.dateMode, slotValue(command, intent.dateToken, "DATE"), timezone);
  if (needsBill && !selected && !(intent.action === "CHECK_PAYMENT" && date)) {
    const candidates = context.workspace.obligations.filter((item) => tokenIds ? tokenIds.includes(item.id) : true);
    return { ...base, message: say(language, "Which obligation do you mean? Choose one; no amount or recipient was inferred.", "Hangi yükümlülüğü kastediyorsun? Birini seç; tutar veya alıcı tahmin edilmedi."), choices: candidates.slice(0, 50).map((item) => ({ label: `${item.title} · ${usdc(item.amount)} · ${item.dueAt.slice(0, 10)}`, handle: issueReview(context, consent, "SELECTION", { intent: { ...intent, obligationToken: null, useCurrentSelection: true }, command, timezone, obligationId: item.id }).handle })) };
  }
  const amount = slotValue(command, intent.amountToken, "AMOUNT");
  const percent = slotValue(command, intent.percentToken, "PERCENT");
  const title = slotValue(command, intent.titleToken, "TEXT");
  const address = slotValue(command, intent.addressToken, "ADDRESS");
  const kind = kindSchema.safeParse(intent.action);
  if (kind.success) {
    let change: Record<string, unknown> = {};
    if (kind.data === "CREATE_OBLIGATION") change = { ...(title ? { title } : {}), ...(amount ? { amount } : {}), ...(date ? { dueDate: date } : {}), ...(address ? { recipientAddress: address } : {}), ...(intent.status === "DRAFT" || intent.status === "UPCOMING" ? { status: intent.status } : {}) };
    if (kind.data === "UPDATE_OBLIGATION") change = { obligationId: selected!, ...(title ? { title } : {}), ...(amount ? { amount } : {}), ...(date ? { dueDate: date } : {}), ...(address ? { recipientAddress: address } : {}), ...(intent.status && intent.status !== "PAID" ? { status: intent.status } : {}) };
    if (kind.data === "PAYMENT_REQUEST") change = { obligationId: selected! };
    if (kind.data === "UPDATE_POLICY") {
      if (intent.policyField === "SAFETY_BUFFER" && amount) change.safetyBuffer = amount;
      if (intent.policyField === "MIN_COVERAGE" && percent) change.minimumLiquidityCoverageBps = percentageBps(percent);
      if (intent.policyField === "STRATEGY_CAP" && intent.strategy && percent) change.strategyCapsBps = { [intent.strategy]: percentageBps(percent) };
      if (intent.policyField === "ENABLED_STRATEGY" && intent.strategy && intent.enabled !== null) change.enabledStrategies = { [intent.strategy]: intent.enabled };
    }
    if (kind.data === "SET_TARGETS") change.targetsBps = Object.fromEntries(intent.targets.map((item) => [item.strategy, percentageBps(slotValue(command, item.percentToken, "PERCENT")!)]));
    if (kind.data === "EARN_REQUEST") {
      const live = await liveWorkspace(context.workspace);
      change = { ...(intent.operation ? { operation: intent.operation } : {}), ...(amount ? { amount } : {}), ...(live.portfolio?.vaults.length === 1 ? { vaultAddress: live.portfolio.vaults[0].address } : {}) };
    }
    if ((kind.data === "UPDATE_POLICY" || kind.data === "UPDATE_OBLIGATION") && Object.keys(change).filter((item) => item !== "obligationId").length === 0) return { ...base, message: say(language, "Enter the exact fields to change.", "Değişecek alanları açıkça gir."), draft: { kind: kind.data, values: change } };
    return prepareChange(context, consent, kind.data, change, language);
  }
  if (intent.action === "NAVIGATE") return { ...base, message: say(language, "Open this Hodd area.", "Hodd içinde bu bölümü aç."), navigation: intent.route ?? "/" };
  if (intent.action === "HELP") return { ...base, message: say(language, "Ask for your treasury summary, bills, policy, payment feasibility or an allocation preview. Changes need an Apply change click; payment and Earn need a separate wallet signature.", "Hesap özeti, yükümlülükler, policy, ödeme uygunluğu veya yatırım önizlemesi isteyebilirsin. Değişiklikler Apply change ile, ödeme ve Earn ayrıca wallet imzasıyla onaylanır.") };
  const live = await liveWorkspace(context.workspace); const workspace = live.workspace;
  base.source = live.source; base.observedAt = live.snapshot?.observedAt ?? new Date().toISOString();
  if (intent.action === "OVERVIEW") {
    const view = overviewView(workspace);
    base.cards = [card("Treasury overview", { "Total treasury": view.totalTreasury, "Liquid USDC": view.liquidUsdc, "Obligations · 30 days": view.upcomingObligations30d, "Protected capital": view.protectedCapital, "Deployable capital": view.deployableCapital, "Liquidity coverage": view.liquidityCoverage ?? view.coverageStatus, "Coverage status": view.coverageStatus }), ...view.strategies.map((item) => card(item.name, { Balance: item.balance, Redeemable: item.redeemable, Integration: item.integration })), ...(view.nextPayment ? [card("Next payment", { Title: view.nextPayment.title, Amount: view.nextPayment.amount, Due: view.nextPayment.dueDate, Status: view.nextPayment.feasibility?.status, Shortfall: view.nextPayment.feasibility?.shortfall })] : [])];
    base.cards.push(card("Protected reserves", { "Safety buffer": view.safetyBuffer, "Pending payments": view.pendingPayments }), ...view.violations.map((item) => card(item.code, { Status: item.severity, Reason: item.message })));
  }
  if (intent.action === "OBLIGATIONS") {
    const items = workspace.obligations.map((item) => item.status === "UPCOMING" && Date.parse(item.dueAt) < Date.now() ? { ...item, status: "OVERDUE" as const } : item).filter((item) => !intent.status || item.status === intent.status).filter((item) => !date || item.dueAt.slice(0, 10) <= date);
    base.cards = items.slice(0, 20).map((item) => card(item.title, obligationView(workspace, item)));
    if (items.length === 1) base.selectionRef = issueReview(context, consent, "REFERENCE", { obligationId: items[0].id }).handle;
    if (!items.length) base.message = say(language, "No obligations match this filter.", "Bu filtreye uyan yükümlülük yok.");
  }
  if (intent.action === "POLICY") {
    base.cards = [card("Treasury policy", policyView(workspace)), card("How protection works", {
      "Protected capital": "Active obligations within 30 days + safety buffer + pending transactions",
      "Deployable capital": "max(total treasury − protected capital, 0)",
      "Liquidity coverage": "Safely available liquid + redeemable assets / protected obligations; no obligations is a separate status",
      "Strategy limits": "Caps and availability limit previews. Unallocated capital stays liquid; nothing moves automatically.",
    })];
  }
  if (intent.action === "ALLOCATION") {
    if (live.source === "PARTIAL") throw new HoddieError("LIVE_DATA_REQUIRED", "Some positions are unavailable. An allocation preview cannot use incomplete balances.", 409);
    const view = allocationView(workspace); base.cards = [card("Allocation preview", { Status: view.status, "Deployable capital": view.deployableCapital, "Stays liquid": view.stayingLiquid }), ...view.lines.map((item) => card(item.strategy, { Requested: item.requested, Approved: item.approved, Reason: item.reason }))];
  }
  if (intent.action === "ACTIVITY") base.cards = workspace.activities.slice(0, 20).map((item) => card(item.action, { Summary: item.summary, Actor: item.actor, At: item.occurredAt, Policy: item.policy.status, Approval: item.approval, Execution: item.execution, "Transaction hash · audit reference": item.transactionHash ?? "None", "Record type": "LOCAL AUDIT · canonical receipts are in payment history / existing execution results" }));
  if (intent.action === "PAYMENTS") {
    const { data, error } = await context.client.from("payment_proposals").select("id,state,tx_hash,updated_at").eq("user_id", context.userId).eq("scope", "TREASURY").order("updated_at", { ascending: false }).limit(20);
    if (error) throw new HoddieError("UNAVAILABLE", "Payment history is unavailable.", 503);
    base.cards = (data ?? []).map((row) => card("Payment", row));
  }
  if (intent.action === "VAULTS") base.cards = (live.portfolio?.vaults ?? []).map((item) => card(item.name, { Vault: item.address, APY: `${item.apyBps / 100}%`, Liquidity: usdc(item.liquidity), Status: item.status }));
  if (intent.action === "CHECK_PAYMENT") {
    if (live.source === "PARTIAL") throw new HoddieError("LIVE_DATA_REQUIRED", "Payment feasibility requires complete fresh balances and positions.", 409);
    const items = workspace.obligations.filter((item) => selected ? item.id === selected : ["UPCOMING", "OVERDUE"].includes(item.status) && item.dueAt.slice(0, 10) <= date!);
    base.cards = await Promise.all(items.slice(0, 20).map(async (item) => { const fee = await estimateTransferFee(workspace, item.recipientAddress, item.amount); const view = paymentCheckView(workspace, item, fee); return card(item.title, { Policy: view.policy.status, Reason: view.policy.reason, "Estimated fee · preview only": view.estimatedFee, "Required liquid": view.requiredLiquid, "Current liquid": view.liquidUsdc, Funding: view.funding.message }); }));
    if (selected) base.selectionRef = issueReview(context, consent, "REFERENCE", { obligationId: selected }).handle;
  }
  base.message += ` ${live.note}`;
  return base;
}

export async function resolveSelection(context: HoddieContext, consent: Consent, handle: string) {
  const payload = verifyReview(handle, context, consent, "SELECTION");
  return resolveIntent(context, consent, intentSchema.parse(payload.data.intent), payload.data.command as MaskedCommand, String(payload.data.timezone), String(payload.data.obligationId));
}
