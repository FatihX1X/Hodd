import "server-only";
import { createViemAdapter, externalSigning, type EvmCallsPayload } from "@circle-fin/adapter-viem-v2/next";
import { ArcTestnet } from "@circle-fin/app-kit/chains";
import { formatUnits, getAddress } from "viem";
import { arcClient, earnKit, operationConfig } from "./gateway";
import { safeEarnFailure } from "./diagnostics";
import type { EarnQuote } from "./models";
import { earnStageOf, type EarnCall, type EarnStage } from "./router";

export type CapturedEarnCall = Readonly<{ stage: EarnStage; call: EarnCall }>;
type Adapter = ReturnType<typeof createViemAdapter>;
export type EarnRun = (quote: EarnQuote, adapter: Adapter) => Promise<unknown>;

const runEarnKit: EarnRun = (quote, adapter) => {
  const params = { from: { adapter, chain: "Arc_Testnet" as const }, vaultAddress: quote.vaultAddress, amount: formatUnits(BigInt(quote.amount.minorUnits), 6), config: { ...operationConfig(), batchTransactions: false } };
  return quote.operation === "DEPOSIT" ? earnKit.earn.deposit(params) : earnKit.earn.withdraw(params);
};

export class EarnCaptureError extends Error {
  constructor(public readonly failure: ReturnType<typeof safeEarnFailure>) { super("CAPTURE_FAILED"); }
}

/**
 * Runs Earn Kit's public deposit/withdraw flow against current chain state with
 * a signer that records the first call it is asked to sign, then stops. Nothing
 * is signed or broadcast here. Earn Kit skips an approval whose allowance is
 * already on chain, so a run after a verified approval yields the router call.
 */
export async function captureNextEarnCall(quote: EarnQuote, walletAddress: string, run: EarnRun = runEarnKit): Promise<CapturedEarnCall> {
  const box: { payload?: EvmCallsPayload } = {};
  const stop = new Error("HODD_CALL_CAPTURED");
  const adapter = createViemAdapter({ capabilities: { addressContext: "user-controlled", supportedChains: [ArcTestnet] }, address: getAddress(walletAddress), getPublicClient: () => arcClient,
    signing: externalSigning({ sign: async (payload) => { box.payload ??= payload; throw stop; } }) });
  let failure: unknown;
  // Earn Kit rewraps signer errors; only the recorded payload counts.
  try { await run(quote, adapter); } catch (error) { failure = error; }
  const payload = box.payload;
  if (!payload) throw new EarnCaptureError(safeEarnFailure(failure, "CAPTURE"));
  if (payload.chain.chainId !== 5_042_002 || payload.fromAddress.toLowerCase() !== walletAddress.toLowerCase() || payload.calls.length !== 1) throw new EarnCaptureError({ code: "UNSUPPORTED_SIGNING_PAYLOAD", stage: "CAPTURE" });
  const [call] = payload.calls;
  const data = (call.data ?? "0x") as `0x${string}`;
  return { stage: earnStageOf(data), call: { to: getAddress(call.to), data, value: (call.value ?? 0n).toString() } };
}
