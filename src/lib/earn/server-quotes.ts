import "server-only";
import { randomUUID } from "node:crypto";
import { createViemAdapter } from "@circle-fin/adapter-viem-v2/next";
import { ArcTestnet } from "@circle-fin/app-kit/chains";
import { formatUnits, getAddress } from "viem";
import { ViemArcTreasuryReader } from "@/lib/arc/reader";
import { arcClient, discoverAllowedVaults, earnKit, getEarnPosition, operationConfig, EarnGatewayError } from "./gateway";
import { addUsdc, decimalStringToMoney, minUsdc, nativeWeiToUsdcCeil } from "./money";
import { earnQuoteSchema, type EarnOperationIntent } from "./models";
import { assessEarnOperation } from "./server-policy";
import { durableEarnQuotes } from "./durable-quotes";
import { QUOTE_TTL_MS } from "./quote-store";
import type { earnServerContext } from "./server-context";
import { boundedArcGasPrice, earnStepGasLimit } from "./gas";
import { assertBoundedEarnFeeProvider } from "./circle-fees";

export type EarnContext = Awaited<ReturnType<typeof earnServerContext>>;
export const readEarnAdapter = (address: string) => createViemAdapter({ capabilities: { addressContext: "user-controlled", supportedChains: [ArcTestnet] }, address: getAddress(address), getPublicClient: () => arcClient });

export async function freshEarnInputs(context: EarnContext, vaultAddress: string) {
  const vaults = await discoverAllowedVaults();
  const vault = vaults.find((item) => item.address.toLowerCase() === vaultAddress.toLowerCase());
  if (!vault) throw new EarnGatewayError("VAULT_NOT_ALLOWED", "Only freshly verified allowlisted vaults can be used.");
  const [snapshot, positions] = await Promise.all([new ViemArcTreasuryReader("https://rpc.testnet.arc.io").readSnapshot(context.wallet.address), Promise.all(vaults.map((item) => getEarnPosition(context.wallet.address, item)))]);
  const position = positions.find((item) => item.vaultAddress === vault.address)!;
  return { vault, positions, position, workspace: { ...context.workspace, liquidUsdc: snapshot.balance } };
}

export async function prepareServerQuote(context: EarnContext, intent: EarnOperationIntent) {
  assertBoundedEarnFeeProvider(context.wallet);
  const live = await freshEarnInputs(context, intent.vaultAddress);
  const amount = intent.operation === "REDEEM_ALL" ? live.position.redeemable : decimalStringToMoney(intent.amount ?? "0");
  if (context.scope === "SMOKE_TEST" && intent.operation === "DEPOSIT" && BigInt(amount.minorUnits) > 1_000_000n) throw new EarnGatewayError("SMOKE_AMOUNT_LIMIT", "Smoke-test deposits are limited to 1 USDC.");
  if (BigInt(amount.minorUnits) <= 0n) throw new EarnGatewayError("INVALID_AMOUNT", "Enter a positive amount or connect a funded position.");
  const from = { adapter: readEarnAdapter(context.wallet.address), chain: "Arc_Testnet" as const };
  const params = { from, vaultAddress: live.vault.address, amount: formatUnits(BigInt(amount.minorUnits), 6), config: operationConfig() };
  const raw = intent.operation === "DEPOSIT" ? await earnKit.earn.getDepositQuote(params) : await earnKit.earn.getWithdrawalQuote(params);
  const asset = (value: { symbol: string; amount: string }) => {
    if (value.symbol !== "USDC") throw new EarnGatewayError("INVALID_QUOTE_ASSET", "Quote fees must be canonical USDC.");
    return decimalStringToMoney(value.amount);
  };
  // A deposit quoted behind a pending approval was not simulated against real allowance.
  const unsimulatedDeposit = intent.operation === "DEPOSIT" && (raw.gasFees ?? []).some((item) => /^approv/i.test(item.name));
  const gasFees = (raw.gasFees ?? []).map((item) => {
    if (!item.fees) return { name: item.name, amount: null };
    const gasLimit = earnStepGasLimit(item.name, BigInt(item.fees.gas), unsimulatedDeposit);
    const maxGasPriceWei = boundedArcGasPrice(BigInt(item.fees.gasPrice));
    return { name: item.name, gasLimit: gasLimit.toString(), maxGasPriceWei: maxGasPriceWei.toString(), amount: nativeWeiToUsdcCeil((gasLimit * maxGasPriceWei).toString()) };
  });
  const fees = addUsdc([...raw.fees.map(asset), ...gasFees.flatMap((item) => item.amount ? [item.amount] : [])]);
  const warnings = [...live.vault.earnKitWarnings, ...live.vault.warnings.map((item) => `${item.level}: ${item.type}`), ...("earnKitWarnings" in raw ? raw.earnKitWarnings ?? [] : [])];
  let policy = assessEarnOperation(live.workspace, live.positions, intent.operation, amount, fees);
  const maxWithdrawable = "maxWithdrawable" in raw ? asset(raw.maxWithdrawable) : null;
  if (intent.operation !== "DEPOSIT" && BigInt(amount.minorUnits) > BigInt(minUsdc(live.position.redeemable, maxWithdrawable ?? live.position.redeemable).minorUnits)) policy = { status: "BLOCKED", label: "Server liquidity policy", reason: "The amount exceeds fresh position, vault liquidity or quote limits." };
  if (!gasFees.length || gasFees.some((item) => item.amount === null)) policy = { status: "BLOCKED", label: "Fee reserve unavailable", reason: "A complete gas reserve could not be verified. No executable quote was created." };
  if (BigInt(fees.minorUnits) > BigInt(live.workspace.liquidUsdc.minorUnits)) policy = { status: "BLOCKED", label: "Fee reserve", reason: "Liquid USDC is insufficient to reserve the operation fees." };
  if (warnings.length && policy.status === "PASS") policy = { ...policy, status: "REVIEW", reason: "Policy passed; acknowledge the protocol and liquidity warnings separately." };
  const quote = earnQuoteSchema.parse({ quoteId: policy.status === "BLOCKED" ? null : randomUUID(), operation: intent.operation, walletAddress: context.wallet.address, vaultAddress: live.vault.address, vaultName: live.vault.name, amount, expectedShares: "expectedShares" in raw ? raw.expectedShares.amount : null, sharesToRedeem: "sharesToRedeem" in raw ? raw.sharesToRedeem.amount : null, maxWithdrawable, fees, gasFees, warnings, policy, expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(), requiresWarningAcknowledgement: warnings.length > 0 });
  if (quote.quoteId) await durableEarnQuotes.put({ quote, binding: context.binding, policyDigest: context.policyDigest });
  return quote;
}
