import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createViemAdapter, externalSigning, type EvmCallsPayload } from "@circle-fin/adapter-viem-v2/next";
import { ArcTestnet } from "@circle-fin/app-kit/chains";
import { createCircleUserWalletAdapter } from "@circle-fin/adapter-circle-wallets/ucw/server";
import { circleUserWalletClient } from "@/lib/circle/user-wallet-server";
import { assertEarnContextCurrent } from "./server-context";
import { formatUnits, getAddress, parseUnits } from "viem";
import type { WalletCall } from "@/lib/wallet/runtime";
import { arcClient, earnKit, getEarnPosition, operationConfig } from "./gateway";
import { durableEarnQuotes, digest } from "./durable-quotes";
import { freshEarnInputs, type EarnContext } from "./server-quotes";
import { assessEarnOperation } from "./server-policy";
import { verifyApprovalReceipt, verifyEarnReceipt } from "./receipts";
import { earnExecutionResultSchema, type EarnExecutionResult, type EarnQuote } from "./models";
import { EarnAccessError } from "./security";
import { nativeWeiToUsdcCeil } from "./money";
import { boundedArcGasPrice, quotedSigningGasPrice } from "./gas";
import { recordEarnEvidence } from "./provider-evidence";
import { safeEarnFailure } from "./diagnostics";
import { assertBoundedEarnFeeProvider, boundedCircleChallengeFee } from "./circle-fees";

type Pending = { id: string; stage: "APPROVAL" | "EARN"; calls: WalletCall[]; gasBudgetWei: string; gasCeiling?: { gasLimit: string; gasPriceWei: string }; challengeId?: string };
type Job = { id: string; binding: string; policyDigest: string; quote: EarnQuote; status: "AWAITING_SIGNATURE" | "SUBMITTED" | "COMPLETE" | "PARTIAL" | "FAILED" | "UNKNOWN"; events: { stage: string; hash?: string }[]; pending?: Pending; result?: EarnExecutionResult; controller: AbortController; resolve?: (hash: `0x${string}`) => void; reject?: (error: Error) => void; submitted: boolean; gasSpent: bigint; lease: string; startedBlock: bigint; embeddedCall?: { to: `0x${string}`; data: `0x${string}`; value: bigint }; receipts: Set<string> };
const globalJobs = globalThis as typeof globalThis & { hoddEarnJobs?: Map<string, Job> };
const jobs = globalJobs.hoddEarnJobs ??= new Map<string, Job>();
const diagnostics = (job: Job) => job as Job & { diagnosticStage?: string; failure?: ReturnType<typeof safeEarnFailure> };
const hashPattern = /^0x[\da-fA-F]{64}$/;
const gasReserveWei = (quote: EarnQuote) => quote.gasFees.reduce((sum, item) => {
  if (!item.amount) throw new Error("GAS_RESERVE_UNAVAILABLE");
  return sum + BigInt(item.amount.minorUnits) * 10n ** 12n;
}, 0n);

function checkedJob(context: EarnContext, id: string) {
  const job = jobs.get(id);
  if (!job || job.binding !== context.binding) throw new EarnAccessError("EXECUTION_NOT_FOUND", "This execution is unavailable in the current wallet session.", 404);
  if (job.policyDigest !== context.policyDigest) {
    job.controller.abort(); job.reject?.(new Error("WORKSPACE_CHANGED"));
    throw new EarnAccessError("WORKSPACE_CHANGED", "Workspace policy changed. Review the execution before requesting a new quote.", 409);
  }
  return job;
}

const testSignerAnswered = new Set<string>();
/**
 * Dev-only test signer: returns the exact call and server-bound gas ceiling of
 * this session's pending Earn request, once. Arbitrary calldata is never signed.
 */
export function claimTestSignerRequest(binding: string, calls: readonly WalletCall[], ceiling: { gasLimit: string; gasPriceWei: string }) {
  const same = (a: WalletCall, b: WalletCall) => a.to.toLowerCase() === b.to.toLowerCase() && (a.data ?? "0x").toLowerCase() === (b.data ?? "0x").toLowerCase() && (a.value ?? "0") === (b.value ?? "0");
  for (const job of jobs.values()) {
    const pending = job.pending;
    if (job.binding !== binding || !pending || pending.challengeId || !pending.gasCeiling || testSignerAnswered.has(pending.id)) continue;
    if (pending.calls.length !== 1 || calls.length !== 1 || !same(pending.calls[0], calls[0]) || pending.gasCeiling.gasLimit !== ceiling.gasLimit || pending.gasCeiling.gasPriceWei !== ceiling.gasPriceWei) continue;
    testSignerAnswered.add(pending.id);
    return { call: pending.calls[0], gasCeiling: pending.gasCeiling };
  }
  throw new EarnAccessError("TEST_SIGNER_REQUEST_NOT_FOUND", "No matching pending Earn signature request for this session.", 409);
}

export function inspectEarnJob(context: EarnContext, id: string) {
  const job = checkedJob(context, id);
  return { status: "PENDING" as const, executionId: job.id, state: job.status, events: job.events, pending: job.pending ?? null, result: job.result ?? null, failure: diagnostics(job).failure ?? null };
}

export async function replyToEarnJob(context: EarnContext, id: string, input: { requestId: string; txHash?: string; userOperationHash?: string; cancelled?: boolean; uncertain?: boolean }) {
  const job = checkedJob(context, id);
  if (!job.pending || job.pending.id !== input.requestId) throw new EarnAccessError("SIGNATURE_REQUEST_NOT_AVAILABLE", "The signature request was already answered.", 409);
  if (input.cancelled) { if (input.uncertain) job.submitted = true; job.controller.abort(); job.reject?.(new Error("USER_CANCELLED")); delete job.pending; return; }
  if (input.userOperationHash && hashPattern.test(input.userOperationHash)) { job.submitted = true; job.events.push({ stage: "USER_OPERATION_SUBMITTED", hash: input.userOperationHash }); }
  if (input.txHash && hashPattern.test(input.txHash)) {
    const hash = input.txHash as `0x${string}`;
    // Clear before any await: a duplicate reply cannot resume the SDK twice.
    delete job.pending;
    job.submitted = true; job.status = "SUBMITTED"; job.events.push({ stage: "TRANSACTION_SUBMITTED", hash });
    job.resolve?.(hash);
  }
}

async function waitForSignature(job: Job, payload: EvmCallsPayload, context: EarnContext): Promise<`0x${string}`> {
  await assertEarnContextCurrent(context);
  await assertFreshJobPolicy(job, context);
  if (job.controller.signal.aborted || Date.parse(job.quote.expiresAt!) <= Date.now()) throw new Error("QUOTE_EXPIRED_OR_CANCELLED");
  if (payload.fromAddress.toLowerCase() !== context.wallet.address.toLowerCase() || payload.chain.chainId !== 5_042_002 || payload.calls.length !== 1) throw new Error("UNSUPPORTED_SIGNING_PAYLOAD");
  const calls = payload.calls.map((call) => ({ to: call.to, data: call.data, value: (call.value ?? 0n).toString() }));
  // Earn Kit uses increaseAllowance for Arc USDC and approve for vault shares.
  const stage = /^(0x095ea7b3|0x39509351)/i.test(calls[0].data ?? "") ? "APPROVAL" as const : "EARN" as const;
  const remaining = gasReserveWei(job.quote) - job.gasSpent;
  if (remaining <= 0n) throw new Error("FEE_RESERVE_EXHAUSTED");
  let gasCeiling: Pending["gasCeiling"];
  if (context.wallet.accountType === "EOA") {
    const fee = job.quote.gasFees.find((item) => stage === "APPROVAL" ? /^approv/i.test(item.name) : item.name.toLowerCase() === (job.quote.operation === "DEPOSIT" ? "deposit" : "withdraw"));
    if (!fee?.gasLimit || !fee.maxGasPriceWei) throw new Error("FEE_CEILING_UNAVAILABLE");
    const gasLimit = BigInt(fee.gasLimit);
    const maxGasPriceWei = BigInt(fee.maxGasPriceWei);
    const [gasPriceWei, estimate] = await Promise.all([
      arcClient.getGasPrice().catch(() => { throw new Error("GAS_PRICE_UNAVAILABLE"); }).then((price) => quotedSigningGasPrice(price, maxGasPriceWei)),
      arcClient.estimateGas({ account: getAddress(context.wallet.address), to: calls[0].to, data: calls[0].data, value: BigInt(calls[0].value ?? "0") }).catch(() => { throw new Error("GAS_ESTIMATE_UNAVAILABLE"); }),
    ]);
    if (estimate > gasLimit || gasLimit * gasPriceWei > remaining) throw new Error("FEE_RESERVE_EXCEEDED");
    gasCeiling = { gasLimit: gasLimit.toString(), gasPriceWei: gasPriceWei.toString() };
  }
  job.pending = { id: randomUUID(), stage, calls, gasBudgetWei: remaining.toString(), ...(gasCeiling ? { gasCeiling } : {}) };
  job.status = "AWAITING_SIGNATURE"; job.events.push({ stage: `${stage}_SIGNATURE_REQUESTED` });
  const hash = await new Promise<`0x${string}`>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SIGNATURE_TIMEOUT")), Math.max(1, Date.parse(job.quote.expiresAt!) - Date.now()));
    job.resolve = (value) => { clearTimeout(timer); resolve(value); };
    job.reject = (error) => { clearTimeout(timer); reject(error); };
  });
  const receipt = await arcClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success" || receipt.blockNumber <= job.startedBlock || job.receipts.has(hash)) throw new Error("TRANSACTION_NOT_VERIFIED");
  job.receipts.add(hash);
  if (context.wallet.accountType === "EOA") {
    const transaction = await arcClient.getTransaction({ hash }); const call = payload.calls[0];
    if (transaction.from.toLowerCase() !== context.wallet.address.toLowerCase() || transaction.to?.toLowerCase() !== call.to.toLowerCase() || transaction.input.toLowerCase() !== (call.data ?? "0x").toLowerCase() || transaction.value !== (call.value ?? 0n)) throw new Error("TRANSACTION_PAYLOAD_MISMATCH");
    job.gasSpent += receipt.gasUsed * receipt.effectiveGasPrice;
    if (job.gasSpent > gasReserveWei(job.quote)) throw new Error("FEE_RESERVE_EXCEEDED");
  } else if (stage === "EARN") verifyEarnReceipt(receipt, job.quote);
  else verifyApprovalReceipt(receipt, payload.calls[0], context.wallet.address);
  job.events.push({ stage: `${stage}_CONFIRMED`, hash });
  // A verified approval leaves nothing in flight; a later pre-signature failure is FAILED, not UNKNOWN.
  if (stage === "APPROVAL") job.submitted = false;
  await assertEarnContextCurrent(context);
  return hash;
}

async function assertFreshJobPolicy(job: Job, context: EarnContext) {
  const live = await freshEarnInputs(context, job.quote.vaultAddress);
  const fees = nativeWeiToUsdcCeil((BigInt(job.quote.fees.minorUnits) * 10n ** 12n - job.gasSpent).toString());
  const policy = assessEarnOperation(live.workspace, live.positions, job.quote.operation, job.quote.amount, fees);
  if (policy.status === "BLOCKED" || BigInt(fees.minorUnits) > BigInt(live.workspace.liquidUsdc.minorUnits) || (job.quote.operation !== "DEPOSIT" && BigInt(job.quote.amount.minorUnits) > BigInt(live.position.redeemable.minorUnits))) throw new Error("FRESH_POLICY_BLOCKED");
}

async function embeddedEarnAdapter(job: Job, context: EarnContext) {
  const client = circleUserWalletClient();
  if (!client || !context.userToken || !context.wallet.walletId) throw new Error("EMBEDDED_SESSION_REQUIRED");
  const cappedClient = new Proxy(client, { get(target, key) {
    if (key === "createUserTransactionContractExecutionChallenge") return async (input: Parameters<typeof client.createUserTransactionContractExecutionChallenge>[0]) => {
      diagnostics(job).diagnosticStage = "CHALLENGE_PREPARATION";
      await assertEarnContextCurrent(context);
      await assertFreshJobPolicy(job, context);
      if (job.controller.signal.aborted || Date.parse(job.quote.expiresAt!) <= Date.now() || input.walletId !== context.wallet.walletId) throw new Error("EMBEDDED_SESSION_EXPIRED");
      const gasPrice = boundedArcGasPrice(await arcClient.getGasPrice());
      const remaining = gasReserveWei(job.quote) - job.gasSpent;
      const gasLimit = remaining / gasPrice;
      if (gasLimit < 21_000n) throw new Error("FEE_RESERVE_EXHAUSTED");
      if (!input.callData) throw new Error("ENCODED_CALL_REQUIRED");
      job.embeddedCall = { to: getAddress(input.contractAddress), data: input.callData, value: parseUnits(input.amount ?? "0", 18) };
      const fee = boundedCircleChallengeFee(context.wallet.accountType, gasLimit, gasPrice);
      diagnostics(job).diagnosticStage = "CHALLENGE_CREATION";
      try {
        return await target.createUserTransactionContractExecutionChallenge({ ...input, fee });
      } catch (error) {
        // Capture numeric provider code before App Kit translates the SDK error.
        diagnostics(job).failure = safeEarnFailure(error, "CHALLENGE_CREATION");
        throw error;
      }
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  return createCircleUserWalletAdapter({ client: cappedClient, userToken: context.userToken, walletId: context.wallet.walletId, walletAddress: getAddress(context.wallet.address), chain: "Arc_Testnet", accountType: "SCA", timeoutMs: 300_000,
    onChallenge: ({ challengeId }) => { const stage = /^(0x095ea7b3|0x39509351)/i.test(job.embeddedCall?.data ?? "") ? "APPROVAL" : "EARN"; job.pending = { id: randomUUID(), stage, challengeId, calls: [], gasBudgetWei: "0" }; job.events.push({ stage: `${stage}_PIN_REQUESTED` }); job.status = "AWAITING_SIGNATURE"; },
    onProgress: async (progress) => {
      if (progress.stage === "transaction") { job.submitted = true; job.status = "SUBMITTED"; delete job.pending; }
      job.events.push({ stage: `CIRCLE_${progress.stage.toUpperCase()}_${progress.status}`, ...(progress.txHash ? { hash: progress.txHash } : {}) });
      if (progress.txHash && progress.status === "CONFIRMED" && !job.receipts.has(progress.txHash)) {
        try {
          const receipt = await arcClient.getTransactionReceipt({ hash: progress.txHash });
          if (receipt.blockNumber <= job.startedBlock || !job.embeddedCall) throw new Error("STALE_RECEIPT");
          if (/^(0x095ea7b3|0x39509351)/i.test(job.embeddedCall.data)) verifyApprovalReceipt(receipt, job.embeddedCall, context.wallet.address); else verifyEarnReceipt(receipt, job.quote);
          job.events.push({ stage: /^(0x095ea7b3|0x39509351)/i.test(job.embeddedCall.data) ? "APPROVAL_CONFIRMED" : "EARN_CONFIRMED", hash: receipt.transactionHash });
          job.receipts.add(progress.txHash); job.gasSpent += receipt.gasUsed * receipt.effectiveGasPrice;
          if (job.gasSpent > gasReserveWei(job.quote)) throw new Error("FEE_RESERVE_EXCEEDED");
        } catch { job.controller.abort(); }
      }
    },
  });
}

async function runEarnJob(job: Job, context: EarnContext) {
  try {
    diagnostics(job).diagnosticStage = "ADAPTER_SETUP";
    const adapter = context.wallet.provider === "CIRCLE_USER_CONTROLLED" ? await embeddedEarnAdapter(job, context) : createViemAdapter({ capabilities: { addressContext: "user-controlled", supportedChains: [ArcTestnet] }, address: getAddress(context.wallet.address), getPublicClient: () => arcClient, signing: externalSigning({ sign: async (payload) => {
      // Earn Kit rewraps signer errors as RPC_ENDPOINT_ERROR; keep Hodd's own code.
      try { return { txHash: await waitForSignature(job, payload, context) }; }
      catch (error) { diagnostics(job).failure ??= safeEarnFailure(error, "SIGNING_PREPARATION"); throw error; }
    } }) });
    const params = { from: { adapter, chain: "Arc_Testnet" as const }, vaultAddress: job.quote.vaultAddress, amount: formatUnits(BigInt(job.quote.amount.minorUnits), 6), config: { ...operationConfig(), batchTransactions: false } };
    diagnostics(job).diagnosticStage = "EARN_SDK";
    const result = job.quote.operation === "DEPOSIT" ? await earnKit.earn.deposit(params) : await earnKit.earn.withdraw(params);
    diagnostics(job).diagnosticStage = "RECEIPT_VERIFICATION";
    const receipt = await arcClient.waitForTransactionReceipt({ hash: result.txHash as `0x${string}`, timeout: 120_000 });
    if (job.controller.signal.aborted || receipt.blockNumber <= job.startedBlock) throw new Error("EXECUTION_REQUIRES_REVIEW");
    verifyEarnReceipt(receipt, job.quote);
    const live = await freshEarnInputs(context, job.quote.vaultAddress);
    const residual = await getEarnPosition(context.wallet.address, live.vault);
    const status = job.quote.operation === "REDEEM_ALL" && /[1-9]/.test(residual.shares) ? "PARTIAL" : "COMPLETE";
    job.result = earnExecutionResultSchema.parse({ executionId: job.id, operation: job.quote.operation, status, txHash: receipt.transactionHash, explorerUrl: `https://testnet.arcscan.app/tx/${receipt.transactionHash}`, vaultAddress: job.quote.vaultAddress, amount: job.quote.amount, residualPosition: residual });
    job.status = status; job.events.push({ stage: status, hash: receipt.transactionHash });
    try { await recordEarnEvidence(context, job.quote, job.result, job.startedBlock, receipt.blockNumber); }
    catch { job.events.push({ stage: "PROVIDER_EVIDENCE_NOT_SAVED" }); }
  } catch (error) {
    diagnostics(job).failure ??= safeEarnFailure(error, diagnostics(job).diagnosticStage ?? "EARN_SDK");
    job.status = job.submitted ? "UNKNOWN" : "FAILED"; job.events.push({ stage: job.status });
  } finally {
    delete job.pending; delete job.resolve; delete job.reject;
    delete diagnostics(job).diagnosticStage;
    // An uncertain submit deliberately keeps its lease across server restarts.
    if (job.status !== "UNKNOWN") await unlink(job.lease).catch(() => undefined);
  }
}

export async function startEarnJob(context: EarnContext, quoteId: string, acknowledged: boolean) {
  assertBoundedEarnFeeProvider(context.wallet);
  const stored = await durableEarnQuotes.read(quoteId, context.binding);
  if (stored.policyDigest !== context.policyDigest) throw new EarnAccessError("WORKSPACE_CHANGED", "Request a new quote after changing your workspace.", 409);
  const live = await freshEarnInputs(context, stored.quote.vaultAddress);
  const liveWarnings = [...live.vault.earnKitWarnings, ...live.vault.warnings.map((item) => `${item.level}: ${item.type}`)];
  if (liveWarnings.some((warning) => !stored.quote.warnings.includes(warning))) throw new EarnAccessError("WARNINGS_CHANGED", "New vault warnings require a new quote and explicit acknowledgement.", 409);
  const policy = assessEarnOperation(live.workspace, live.positions, stored.quote.operation, stored.quote.amount, stored.quote.fees);
  if (policy.status === "BLOCKED" || (stored.quote.operation !== "DEPOSIT" && BigInt(stored.quote.amount.minorUnits) > BigInt(live.position.redeemable.minorUnits))) throw new EarnAccessError("POLICY_BLOCKED", "Fresh treasury policy or liquidity no longer permits this quote.", 409);
  const directory = join(process.cwd(), ".hodd-local", "leases"); await mkdir(directory, { recursive: true });
  const startedBlock = await arcClient.getBlockNumber();
  // Global per-wallet lock: two users or two distinct quotes cannot overspend the same wallet.
  const lease = join(directory, digest(context.wallet.address.toLowerCase()));
  try { await writeFile(lease, quoteId, { flag: "wx", mode: 0o600 }); }
  catch { throw new EarnAccessError("WALLET_BUSY", "Another wallet execution needs completion or manual review.", 409); }
  let quote: EarnQuote;
  try { quote = (await durableEarnQuotes.consume(quoteId, context.binding, acknowledged)).quote; }
  catch { await unlink(lease).catch(() => undefined); throw new EarnAccessError("QUOTE_NOT_AVAILABLE", "The quote expired, was consumed or needs warning acknowledgement.", 409); }
  const job: Job = { id: quoteId, binding: context.binding, policyDigest: context.policyDigest, quote, status: "AWAITING_SIGNATURE", events: [{ stage: "USER_CONFIRMED" }], controller: new AbortController(), submitted: false, gasSpent: 0n, lease, startedBlock, receipts: new Set() };
  jobs.set(job.id, job);
  void runEarnJob(job, context);
  return inspectEarnJob(context, job.id);
}
