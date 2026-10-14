import "server-only";
import { randomUUID } from "node:crypto";
import { getAddress, type Hex } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { liveControls } from "@/lib/earn/live-controls";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { paymentProposalSchema } from "@/lib/payments/models";
import { agentAdapter } from "./circle";
import { agentFeeConfig } from "./calls";
import { agentInputs } from "./inputs";
import { adviseDecision, advisorEnvelope, advisorFacts } from "./advisor";
import { advisorConfigured, groqAdvisor } from "./advisor-model";
import { agentDb, patchRun, patchStep, type AgentRun, type AgentStep } from "./store";
import { stepAction } from "./state";
import type { RunTrigger } from "./triggers";
import type { Decision } from "./models";
import { billRef, decodeVaultCall, encodeVaultCall, maxSharesFor, minAssetsFor, minSharesFor, strategyAbi, verifyVaultReceipt, VAULT_MORPHO, type VaultInstruction } from "./vault";
import { convertToAssets, previewDeposit, previewWithdraw, readRecipients, readVaultFunds, verifiedVault } from "./vault-state";
import { AGENT_FEE_FLOAT_MINOR, decideVault, vaultBillPlan, type VaultBill } from "./vault-decision";

const ACTIVE_PAYMENT = ["AWAITING_SIGNATURE", "SUBMITTED", "UNKNOWN"];
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const usdc = (minor: bigint) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: (minor > 0n ? minor : 0n).toString() });

/** Everything a vault-mode decision needs: the owner side (as for the custodial agent), the vault and the bills. */
export async function vaultInputs(userId: string) {
  const i = await agentInputs(userId);
  if (!i.wallet.vault_address) throw new Error("AGENT_VAULT_NOT_DEPLOYED");
  const vaultAddress = getAddress(i.wallet.vault_address);
  const config = await verifiedVault(vaultAddress, i.wallet.owner_address, i.wallet.address);
  const [funds, agentShares] = await Promise.all([readVaultFunds(vaultAddress, i.vault), arcClient.readContract({ address: VAULT_MORPHO, abi: strategyAbi, functionName: "balanceOf", args: [getAddress(i.wallet.address)] })]);
  const custodial = { shares: agentShares, positionMinor: BigInt(i.agentPosition.currentBalance.minorUnits), cashMinor: BigInt(i.cash.balance.minorUnits) };
  const openBills = i.workspace.obligations.filter((o) => o.status === "UPCOMING" || o.status === "OVERDUE");
  const withRecipient = openBills.filter((o) => o.recipientAddress);
  const [recipients, active] = await Promise.all([
    withRecipient.length ? readRecipients(vaultAddress, withRecipient.map((o) => o.recipientAddress!)) : Promise.resolve(new Map<string, { approved: boolean; capMinor: bigint }>()),
    agentDb().from("payment_proposals").select("id,obligation_id").eq("user_id", userId).eq("scope", "TREASURY").in("state", ACTIVE_PAYMENT),
  ]);
  if (active.error) throw new Error("AGENT_STATUS_UNAVAILABLE");
  const activeRows = (active.data ?? []) as { id: string; obligation_id: string }[];
  const bills: VaultBill[] = openBills.map((obligation) => {
    const r = obligation.recipientAddress ? recipients.get(getAddress(obligation.recipientAddress)) : undefined;
    return { obligation, approved: r?.approved ?? false, capMinor: r?.capMinor ?? 0n, busy: activeRows.some((row) => row.obligation_id === obligation.id) };
  });
  return { ...i, vaultAddress, config, funds, bills, activePayments: activeRows, custodial };
}
export type VaultInputs = Awaited<ReturnType<typeof vaultInputs>>;

export function vaultDecision(v: VaultInputs, now = new Date()) {
  return decideVault({ workspace: v.workspace, ownerPositions: v.ownerPositions, vaultPosition: v.funds.position, mandate: v.stored.mandate, idleMinor: v.funds.idle.balance.minorUnits, spentMinor: String(v.stored.spent_minor), returnAll: v.stored.return_requested, bills: v.bills, depositRoomMinor: v.funds.depositRoomMinor, paymentRoomMinor: v.funds.paymentRoomMinor, agentGasMinor: v.cash.balance.minorUnits, feeReserveMinor: v.feeReserveMinor, ledgerBusy: v.activePayments.length > 0, custodial: v.custodial, now });
}

/** Same bounded advisor as the custodial agent, over the vault's cash and Morpho position (fees are the agent's). */
async function adviseVault(v: VaultInputs, engine: Decision, now = new Date()): Promise<Decision> {
  const m = v.stored.mandate;
  if (v.stored.return_requested || !m.enabled || m.paused || !(await advisorConfigured())) return engine;
  const controls = await liveControls(); if (!controls?.get("AGENT_ADVISOR")) return engine;
  const position = v.funds.position, observed = Date.parse(position.observedAt);
  if (position.liquidityStatus !== "READY" || now.getTime() - observed > 60_000) return engine;
  const envelope = advisorEnvelope(engine, { cashMinor: BigInt(v.funds.idle.balance.minorUnits), redeemableMinor: BigInt(position.redeemable.minorUnits), positionMinor: BigInt(position.currentBalance.minorUnits), feeReserveMinor: 0n });
  if (!envelope) return engine;
  const facts = advisorFacts({ workspace: v.workspace, cash: v.funds.idle.balance, ownerCash: v.ownerCash.balance, agentPosition: position, vault: v.vault, mandate: m, remainingBudgetMinor: engine.remainingBudgetMinor, now });
  return adviseDecision(engine, envelope, facts, groqAdvisor);
}

/** Records a vault-mode run (NO_ACTION or RUNNING). The caller advances a RUNNING one. */
export async function createVaultRun(userId: string, trigger: RunTrigger): Promise<AgentRun> {
  const v = await vaultInputs(userId);
  const decision = await adviseVault(v, vaultDecision(v));
  const id = randomUUID();
  const snapshot = { mode: "VAULT", vault: v.vaultAddress, trigger, workspace: v.workspace, workspaceRevision: v.workspaceRevision, mandate: v.stored.mandate, mandateRevision: v.stored.revision, spentMinor: String(v.stored.spent_minor), cash: v.funds.idle, agentGas: v.cash, ownerCash: v.ownerCash, ownerPositions: v.ownerPositions, agentPosition: v.funds.position, feeReserveMinor: v.feeReserveMinor, depositRoomMinor: v.funds.depositRoomMinor.toString(), paymentRoomMinor: v.funds.paymentRoomMinor.toString(), bills: v.bills.map((bill) => ({ id: bill.obligation.id, plan: vaultBillPlan(bill), dueAt: bill.obligation.dueAt, amountMinor: bill.obligation.amount.minorUnits })) };
  const { error } = await agentDb().rpc("hodd_start_agent_run", { p_id: id, p_user: userId, p_snapshot: snapshot, p_decision: decision, p_quote: null, p_return_all: v.stored.return_requested, p_revision: v.stored.revision });
  if (error) throw new Error(/rate limit/i.test(error.message) ? "AGENT_RATE_LIMIT" : "AGENT_RUN_CHANGED");
  const { data, error: readError } = await agentDb().from("agent_runs").select("*").eq("id", id).single();
  if (readError || !data) throw new Error("AGENT_STATUS_UNAVAILABLE");
  return data as AgentRun;
}

const decoded = (run: AgentRun, step: AgentStep) => decodeVaultCall(String(run.snapshot.vault), step.call);
/**
 * The next operator call for this run, or null when it is done. Legs: INVEST deposits; RESERVE_REFILL and DE_RISK
 * withdraw into the vault; LIQUIDITY_TOP_UP sends idle cash or redeems straight to the owner; RETURN_ALL redeems the
 * whole position to the owner, then sends the idle cash; PAY_BILL withdraws the missing part, then pays.
 */
export async function nextVaultLeg(run: AgentRun, done: VaultInstruction[], v: VaultInputs): Promise<VaultInstruction | null> {
  const d = run.decision, idle = BigInt(v.funds.idle.balance.minorUnits), shares = v.funds.shares;
  const withdraw = async (assets: bigint): Promise<VaultInstruction> => { const preview = await previewWithdraw(assets); const max = maxSharesFor(preview); return { fn: "withdrawFromStrategy", strategy: VAULT_MORPHO, assets, maxShares: max < shares ? max : shares }; };
  switch (d.kind) {
    case "INVEST": return done.length ? null : { fn: "depositToStrategy", strategy: VAULT_MORPHO, assets: BigInt(d.depositMinor), minShares: minSharesFor(await previewDeposit(BigInt(d.depositMinor))) };
    case "RESERVE_REFILL": case "DE_RISK": return done.length ? null : withdraw(BigInt(d.withdrawMinor));
    case "LIQUIDITY_TOP_UP": {
      if (done.length) return null;
      if (BigInt(d.transferMinor) > 0n) return { fn: "transferToOwner", amount: BigInt(d.transferMinor) };
      const preview = await previewWithdraw(BigInt(d.withdrawMinor));
      return { fn: "redeemToOwner", strategy: VAULT_MORPHO, shares: preview < shares ? preview : shares, minAssets: minAssetsFor(BigInt(d.withdrawMinor)) };
    }
    case "RETURN_ALL": {
      if (done.some((op) => op.fn === "transferToOwner")) return null;
      if (!done.length && shares > 0n) return { fn: "redeemToOwner", strategy: VAULT_MORPHO, shares, minAssets: minAssetsFor(await convertToAssets(shares)) };
      return idle > 0n ? { fn: "transferToOwner", amount: idle } : null;
    }
    case "MOVE_TO_VAULT": {
      if (!done.some((op) => op.fn === "moveShares") && v.custodial.shares > 0n) return { fn: "moveShares", amount: v.custodial.shares };
      if (done.some((op) => op.fn === "moveCash")) return null;
      const cash = v.custodial.cashMinor > AGENT_FEE_FLOAT_MINOR ? v.custodial.cashMinor - AGENT_FEE_FLOAT_MINOR : 0n;
      return cash > 0n ? { fn: "moveCash", amount: cash } : null;
    }
    case "PAY_BILL": {
      if (!d.bill) throw new Error("AGENT_BILL_MISSING");
      const legs = BigInt(d.withdrawMinor) > 0n ? ["withdraw", "pay"] : ["pay"];
      const leg = legs[done.length];
      if (!leg) return null;
      if (leg === "withdraw") return withdraw(BigInt(d.withdrawMinor));
      return { fn: "pay", recipient: getAddress(d.bill.recipient), amount: BigInt(d.bill.amountMinor), ref: billRef(d.bill.obligationId) };
    }
    default: return null;
  }
}

/** Fresh state must still allow the next leg; an advised run may only ever be smaller than the fresh engine decision. */
export function vaultLegAllowed(run: AgentRun, op: VaultInstruction, fresh: Decision, v: VaultInputs, ownStepId?: string) {
  const d = run.decision, n = (value: string) => BigInt(value);
  const redeemable = n(v.funds.position.redeemable.minorUnits);
  switch (d.kind) {
    case "INVEST": return fresh.kind === "INVEST" && n(fresh.depositMinor) >= n(d.depositMinor);
    case "RESERVE_REFILL": case "LIQUIDITY_TOP_UP": return fresh.kind === d.kind && n(fresh.withdrawMinor) >= n(d.withdrawMinor) && n(fresh.transferMinor) >= n(d.transferMinor);
    case "DE_RISK": return (fresh.kind === "INVEST" || fresh.kind === "NO_ACTION") && redeemable >= n(d.withdrawMinor);
    case "RETURN_ALL": return run.return_all && v.stored.return_requested;
    // Only into this owner's verified vault, never more than the agent holds, always keeping its fee float.
    case "MOVE_TO_VAULT": return op.fn === "moveShares" ? op.amount <= v.custodial.shares : op.fn === "moveCash" && op.amount + AGENT_FEE_FLOAT_MINOR <= v.custodial.cashMinor;
    case "PAY_BILL": {
      const bill = v.bills.find((item) => item.obligation.id === d.bill?.obligationId);
      if (!bill || !d.bill || BigInt(bill.obligation.amount.minorUnits) !== n(d.bill.amountMinor) || !bill.obligation.recipientAddress || !same(bill.obligation.recipientAddress, d.bill.recipient)) return false;
      if (!bill.approved || bill.capMinor < n(d.bill.amountMinor)) return false;
      // The ledger marks a bill PAID only while no other payment of this user is open (an owner payment or another
      // run); this step's own record never counts against it.
      if (v.activePayments.some((row) => row.id !== ownStepId)) return false;
      if (op.fn === "pay") return n(v.funds.idle.balance.minorUnits) >= n(d.bill.amountMinor) && v.funds.paymentRoomMinor >= n(d.bill.amountMinor);
      return n(v.funds.idle.balance.minorUnits) + redeemable >= n(d.bill.amountMinor);
    }
    default: return false;
  }
}

/** The bill payment's ledger record: same table, lease and PAID path as an owner payment, on its own rail. */
async function openBillPayment(run: AgentRun, step: AgentStep, v: VaultInputs, op: Extract<VaultInstruction, { fn: "pay" }>) {
  const bill = v.bills.find((item) => item.obligation.id === run.decision.bill?.obligationId)!;
  const { data: existing } = await agentDb().from("payment_proposals").select("id,state").eq("id", step.id).maybeSingle();
  if (existing) return;
  const { data: row, error: rowError } = await agentDb().from("payment_obligations").select("revision").eq("user_id", run.user_id).eq("scope", "TREASURY").eq("id", bill.obligation.id).single();
  if (rowError || !row || !v.workspace.walletConnection) throw new Error("AGENT_BILL_UNAVAILABLE");
  const fee = BigInt(step.gas_limit) * BigInt(step.gas_price_wei);
  const proposal = paymentProposalSchema.parse({
    id: step.id, obligationId: bill.obligation.id, obligationRevision: row.revision, scope: "TREASURY", wallet: v.workspace.walletConnection,
    recipientAddress: op.recipient, recipientLabel: bill.obligation.recipient, amount: usdc(op.amount), feeReserve: usdc(0n),
    balanceAfter: usdc(BigInt(v.funds.idle.balance.minorUnits) - op.amount), gasBudgetWei: fee.toString(), feeQuote: null,
    policy: { status: "PASS", label: "Autopilot vault", reason: "Paid from your HoddieVault to a recipient you approved, within its cap and the vault's 24-hour payment budget." },
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), startBlock: step.started_block, executionEnabled: true,
    executionReason: "Autopilot pays this bill from your vault. The contract only allows recipients you approved.",
    rail: "AUTOPILOT_VAULT", autopilot: { vaultAddress: v.vaultAddress, runId: run.id },
  });
  const { error } = await agentDb().from("payment_proposals").insert({ id: step.id, user_id: run.user_id, scope: "TREASURY", obligation_id: bill.obligation.id, wallet_address: v.vaultAddress.toLowerCase(), binding: `autopilot:${run.id}`, policy_digest: `autopilot:${run.id}`, policy_snapshot: v.workspace.policy, obligation_snapshot: v.workspace.obligations, pending_snapshot: v.workspace.pendingTransactions, proposal, expires_at: proposal.expiresAt, state: "AWAITING_SIGNATURE" });
  if (error) throw new Error("AGENT_BILL_BUSY");
}
const setPayment = (id: string, state: "SUBMITTED" | "UNKNOWN" | "FAILED") => agentDb().from("payment_proposals").update({ state, updated_at: new Date().toISOString() }).eq("id", id).in("state", ACTIVE_PAYMENT);

/** One bounded step of a vault-mode run (the caller holds the run lease). */
export async function advanceVaultRun(run: AgentRun, steps: AgentStep[], allowSubmission: boolean): Promise<AgentRun> {
  const pending = steps.find((s) => s.state !== "VERIFIED" && s.state !== "FAILED");
  if (pending && stepAction(pending.state) === "RECHECK") return settleVaultStep(run, pending);
  if (run.state === "UNKNOWN") return run;
  if (steps.some((s) => s.state === "FAILED" || (s.receipt as { status?: string } | null)?.status === "REVERTED")) return patchRun(run, "FAILED", "AGENT_STEP_FAILED");
  if (!allowSubmission) return run;
  const controls = await liveControls();
  if (!controls?.get("AGENT") || !controls.get("EXECUTION")) return patchRun(run, steps.length ? "PARTIAL" : "FAILED", "AGENT_PAUSED");
  const v = await vaultInputs(run.user_id);
  if (v.stored.revision !== run.snapshot.mandateRevision || (!run.return_all && (!v.stored.mandate.enabled || v.stored.mandate.paused))) return patchRun(run, steps.length ? "PARTIAL" : "FAILED", "AGENT_MANDATE_CHANGED");
  if (getAddress(String(run.snapshot.vault)) !== v.vaultAddress) return patchRun(run, steps.length ? "PARTIAL" : "FAILED", "AGENT_VAULT_CHANGED");
  const done = steps.filter((s) => s.state === "VERIFIED").map((s) => decoded(run, s));
  let step = pending ?? null;
  const op = step ? decoded(run, step) : await nextVaultLeg(run, done, v);
  if (!op) return finishVault(run, v);
  if (!vaultLegAllowed(run, op, vaultDecision(v), v, step?.id)) {
    if (step && op.fn === "pay") await setPayment(step.id, "FAILED");
    return patchRun(run, steps.length ? "PARTIAL" : "FAILED", "AGENT_FRESH_POLICY_BLOCKED");
  }
  if (!step) {
    const call = encodeVaultCall(v.vaultAddress, op);
    const gasLimit = (await arcClient.estimateGas({ account: getAddress(v.wallet.address), to: call.to, data: call.data, value: 0n }) * 120n + 99n) / 100n;
    const amount = op.fn === "depositToStrategy" || op.fn === "withdrawFromStrategy" ? op.assets : op.fn === "redeemToOwner" ? op.minAssets : op.fn === "moveShares" ? 0n : op.amount;
    step = { id: randomUUID(), run_id: run.id, user_id: run.user_id, state: "PREPARED", stage: "VAULT", call, gas_limit: gasLimit.toString(), gas_price_wei: v.gasPriceWei, started_block: (await arcClient.getBlockNumber()).toString(), amount_minor: amount.toString(), circle_transaction_id: null, tx_hash: null, receipt: null };
    const { error } = await agentDb().from("agent_run_steps").insert(step); if (error) throw new Error("AGENT_STEP_STORE_UNAVAILABLE");
  }
  // The signed call is exactly the leg: this user's vault, an operator function, the Morpho strategy or the approved recipient.
  const signed = decoded(run, step);
  if (JSON.stringify(signed, (_, value) => typeof value === "bigint" ? value.toString() : value) !== JSON.stringify(op, (_, value) => typeof value === "bigint" ? value.toString() : value)) throw new Error("AGENT_VAULT_CALL_REFUSED");
  const fee = BigInt(nativeWeiToUsdcCeil((BigInt(step.gas_limit) * BigInt(step.gas_price_wei)).toString()).minorUnits);
  const [gas, price] = await Promise.all([arcClient.estimateGas({ account: getAddress(v.wallet.address), to: step.call.to, data: step.call.data, value: 0n }), arcClient.getGasPrice()]);
  if (fee > BigInt(v.feeReserveMinor) || fee > BigInt(v.cash.balance.minorUnits) || gas > BigInt(step.gas_limit) || price > BigInt(step.gas_price_wei)) throw new Error("AGENT_SIGNING_LIMIT_EXCEEDED");
  if (signed.fn === "pay") await openBillPayment(run, step, v, signed);
  const current = await liveControls(); if (!current?.get("AGENT") || !current.get("EXECUTION")) throw new Error("AGENT_PAUSED");
  const fence = await patchStep(step, { state: "SUBMITTING" });
  try {
    const { devc } = await agentAdapter().getSdk();
    const priority = await Promise.resolve().then(() => arcClient.estimateMaxPriorityFeePerGas()).catch(() => 2_000_000_000n);
    const result = await devc.createContractExecutionTransaction({ walletId: v.wallet.circle_wallet_id, contractAddress: fence.call.to, callData: fence.call.data, amount: "0", idempotencyKey: fence.id, refId: fence.id, fee: agentFeeConfig(fence.gas_limit, BigInt(fence.gas_price_wei), priority) });
    if (!result.data?.id) throw new Error("AGENT_SUBMISSION_UNRESOLVED");
    await patchStep(fence, { state: "SUBMITTED", circle_transaction_id: result.data.id });
    if (signed.fn === "pay") await setPayment(fence.id, "SUBMITTED");
    return run;
  } catch {
    await patchStep(fence, { state: "UNKNOWN" }).catch(() => undefined);
    if (signed.fn === "pay") await setPayment(fence.id, "UNKNOWN");
    return patchRun(run, "UNKNOWN", "AGENT_SUBMISSION_UNRESOLVED");
  }
}

async function settleVaultStep(run: AgentRun, initial: AgentStep): Promise<AgentRun> {
  let step = initial;
  const op = decoded(run, step);
  try {
    const { data: wallet, error } = await agentDb().from("agent_wallets").select("*").eq("user_id", run.user_id).single();
    if (error || !wallet || wallet.account_type !== "EOA" || !wallet.vault_address || !same(wallet.vault_address, String(run.snapshot.vault))) throw new Error();
    if (!step.tx_hash && step.circle_transaction_id) {
      const { devc } = await agentAdapter().getSdk(); const tx = (await devc.getTransaction({ id: step.circle_transaction_id })).data?.transaction;
      if (!tx || tx.walletId !== wallet.circle_wallet_id || tx.blockchain !== "ARC-TESTNET" || tx.refId !== step.id) throw new Error();
      if (tx.txHash && /^0x[0-9a-fA-F]{64}$/.test(tx.txHash)) step = await patchStep(step, { tx_hash: tx.txHash.toLowerCase() });
      else if (["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) {
        await patchStep(step, { state: "FAILED", receipt: { providerState: tx.state } });
        if (op.fn === "pay") await setPayment(step.id, "FAILED");
        return patchRun(run, "FAILED", "AGENT_PROVIDER_FAILED");
      } else return run;
    }
    if (!step.tx_hash) return patchRun(run, "UNKNOWN", "AGENT_SUBMISSION_UNRESOLVED");
    const hash = step.tx_hash as Hex;
    let receipt; try { receipt = await arcClient.getTransactionReceipt({ hash }); } catch { return run; }
    if (receipt.blockNumber <= BigInt(step.started_block)) throw new Error();
    const transaction = await arcClient.getTransaction({ hash });
    if (!same(transaction.from, wallet.address) || !transaction.to || !same(transaction.to, step.call.to) || !same(transaction.input, step.call.data) || transaction.value !== 0n) throw new Error();
    const feeMinor = nativeWeiToUsdcCeil((receipt.gasUsed * receipt.effectiveGasPrice).toString()).minorUnits;
    if (receipt.status === "reverted") {
      await patchStep(step, { state: "VERIFIED", receipt: { status: "REVERTED", blockNumber: receipt.blockNumber.toString(), feeMinor } });
      if (op.fn === "pay") await setPayment(step.id, "FAILED");
      return patchRun(run, "FAILED", "AGENT_RECEIPT_REVERTED");
    }
    const evidence = verifyVaultReceipt(receipt, wallet.vault_address, wallet.owner_address, op, wallet.address);
    await patchStep(step, { state: "VERIFIED", receipt: { status: "VERIFIED", blockNumber: receipt.blockNumber.toString(), feeMinor, gasUsed: receipt.gasUsed.toString(), gasPriceWei: receipt.effectiveGasPrice.toString(), assetsMinor: evidence.assetsMinor.toString(), shares: evidence.shares.toString() } });
    if (op.fn === "pay") {
      // The bill becomes PAID through the same ledger function as an owner payment, bound to the canonical transfer.
      const { error: finishError } = await agentDb().rpc("hodd_finish_payment", { p_user: run.user_id, p_scope: "TREASURY", p_id: step.id, p_hash: hash.toLowerCase(), p_receipt: { blockNumber: receipt.blockNumber.toString(), logIndex: "logIndex" in evidence ? evidence.logIndex : 0, networkFee: usdc(BigInt(feeMinor)) } });
      if (finishError) return patchRun(run, "UNKNOWN", "AGENT_BILL_LEDGER_UNAVAILABLE");
    }
    if (run.state === "UNKNOWN") return patchRun(run, "RUNNING");
    return run;
  } catch {
    if (step.state !== "UNKNOWN") await patchStep(step, { state: "UNKNOWN" }).catch(() => undefined);
    if (op.fn === "pay") await setPayment(step.id, "UNKNOWN").then(() => undefined, () => undefined);
    return patchRun(run, "UNKNOWN", "AGENT_RECEIPT_NOT_VERIFIED");
  }
}

async function finishVault(run: AgentRun, v: VaultInputs) {
  // A return leaves nothing but dust behind; any other run is complete once its legs are verified.
  const left = BigInt(v.funds.idle.balance.minorUnits) + BigInt(v.funds.position.currentBalance.minorUnits);
  if (run.return_all && left > 10n) return patchRun(run, "PARTIAL", "AGENT_RETURN_HAS_RESIDUAL_ASSETS");
  return patchRun(run, "COMPLETED");
}
