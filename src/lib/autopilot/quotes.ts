import "server-only";
import { formatUnits } from "viem";
import { earnKit, operationConfig } from "@/lib/earn/gateway";
import { earnQuoteSchema, type EarnQuote } from "@/lib/earn/models";
import { earnStepGasLimit, boundedArcGasPrice } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil, addUsdc, decimalStringToMoney } from "@/lib/earn/money";
import { evaluateEarnQuotePolicy } from "@/lib/earn/policy";
import { agentAdapter } from "./circle";
import type { agentInputs } from "./inputs";
import type { Decision } from "./models";
/** Circle's withdrawable max when it is below the request by at most 0.01% (min 100 units); otherwise null. */
export function roundedWithdrawal(requested: bigint, providerMax: bigint): bigint | null {
  if(providerMax >= requested || providerMax <= 0n) return null;
  const tolerance=requested/10_000n > 100n ? requested/10_000n : 100n;
  return requested - providerMax <= tolerance ? providerMax : null;
}
export async function agentEarnQuote(i: Awaited<ReturnType<typeof agentInputs>>, d: Decision): Promise<EarnQuote | null> {
  if(d.depositMinor === "0" && d.withdrawMinor === "0") return null;
  const operation=d.depositMinor !== "0" ? "DEPOSIT" : "WITHDRAW";
  let amount=decimalStringToMoney(formatUnits(BigInt(operation === "DEPOSIT" ? d.depositMinor : d.withdrawMinor),6));
  const request=(value:bigint)=>({from:{adapter:agentAdapter(),chain:"Arc_Testnet" as const,address:i.wallet.address},vaultAddress:i.vault.address,amount:formatUnits(value,6),config:{...operationConfig(),batchTransactions:false}});
  let raw=operation === "DEPOSIT" ? await earnKit.earn.getDepositQuote(request(BigInt(amount.minorUnits))) : await earnKit.earn.getWithdrawalQuote(request(BigInt(amount.minorUnits)));
  // Hodd reads the position with convertToAssets; Circle rounds its withdrawable max a few units lower.
  // A tiny gap is re-quoted at Circle's exact max; anything larger stays blocked below.
  const providerMax="maxWithdrawable" in raw ? BigInt(decimalStringToMoney(raw.maxWithdrawable.amount).minorUnits) : null;
  const adjusted=operation === "WITHDRAW" && providerMax !== null ? roundedWithdrawal(BigInt(amount.minorUnits),providerMax) : null;
  if(adjusted !== null){amount={...amount,minorUnits:adjusted.toString()};raw=await earnKit.earn.getWithdrawalQuote(request(adjusted));}
  const gasFees=(raw.gasFees ?? []).map(f=>{
    if(!f.fees)throw new Error("AGENT_GAS_UNAVAILABLE");
    const gasLimit=earnStepGasLimit(f.name,BigInt(f.fees.gas),operation === "DEPOSIT" && (raw.gasFees ?? []).some(x=>/^approv/i.test(x.name)));
    const maxGasPriceWei=boundedArcGasPrice(BigInt(f.fees.gasPrice));
    return {name:f.name,gasLimit:gasLimit.toString(),maxGasPriceWei:maxGasPriceWei.toString(),amount:nativeWeiToUsdcCeil((gasLimit*maxGasPriceWei).toString())};
  });
  if(!gasFees.length)throw new Error("AGENT_GAS_UNAVAILABLE");
  const fees=addUsdc([...gasFees.map(f=>f.amount),...raw.fees.map(f=>{if(f.symbol!=="USDC")throw new Error("AGENT_QUOTE_ASSET_INVALID");return decimalStringToMoney(f.amount);})]);
  if(BigInt(fees.minorUnits)>BigInt(i.feeReserveMinor) || BigInt(fees.minorUnits)>BigInt(i.cash.balance.minorUnits))throw new Error("AGENT_FEE_RESERVE_EXCEEDED");
  const warnings="earnKitWarnings" in raw ? raw.earnKitWarnings ?? [] : [];
  const policy=evaluateEarnQuotePolicy(operation,amount,[fees],operation === "DEPOSIT" ? {...amount,minorUnits:(BigInt(amount.minorUnits)+BigInt(i.feeReserveMinor)).toString()} : i.agentPosition.redeemable,warnings);
  if(policy.status!=="PASS" || warnings.length || ("maxWithdrawable" in raw && BigInt(decimalStringToMoney(raw.maxWithdrawable.amount).minorUnits)<BigInt(amount.minorUnits)))throw new Error("AGENT_QUOTE_POLICY_BLOCKED");
  return earnQuoteSchema.parse({quoteId:null,operation,walletAddress:i.wallet.address,vaultAddress:i.vault.address,vaultName:i.vault.name,amount,expectedShares:"expectedShares" in raw?raw.expectedShares.amount:null,sharesToRedeem:"sharesToRedeem" in raw?raw.sharesToRedeem.amount:null,maxWithdrawable:i.agentPosition.redeemable,fees,gasFees,warnings:[],policy,expiresAt:new Date(Date.now()+5*60_000).toISOString(),requiresWarningAcknowledgement:false});
}
