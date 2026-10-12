import "server-only";
import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, encodeAbiParameters, encodeFunctionData, formatUnits, getAddress, keccak256, pad, toHex } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { boundedArcGasPrice, bufferedEarnGasLimit } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { USDC_ALLOWANCE_MAPPING_SLOT, USYC_DEPOSIT_GAS_FALLBACK, USYC_TELLER, USYC_USDC, tellerAbi, usdcAbi } from "./constants";
import { UsycError, notAllowlisted, usycPaused, usycUnavailable } from "./errors";
import type { UsycPosition, UsycQuote, UsycStep } from "./models";
import { readUsycStatus } from "./status";

const usdc = (minor: bigint) => formatUnits(minor > 0n ? minor : 0n, 6);
const feeMinor = (wei: bigint) => BigInt(nativeWeiToUsdcCeil(wei.toString()).minorUnits);

/** Storage slot of `allowance[owner][spender]` in Arc Testnet's USDC (mapping at slot 10). */
function allowanceSlot(owner: `0x${string}`, spender: `0x${string}`) {
  const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, USDC_ALLOWANCE_MAPPING_SLOT]));
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, inner]));
}

/** True when the node says the call itself would revert (as opposed to the node being unreachable or refusing the request). */
export function isRevert(error: unknown) {
  return error instanceof BaseError && Boolean(error.walk((cause) => cause instanceof ExecutionRevertedError || cause instanceof ContractFunctionRevertedError));
}

/** A step with its own server-chosen gas ceiling: 20% above the estimate at twice the network price (Arc's 20 gwei floor). */
function step(stage: UsycStep["stage"], to: `0x${string}`, data: `0x${string}`, gas: bigint, networkPrice: bigint): UsycStep & { feeMinor: bigint } {
  const gasLimit = bufferedEarnGasLimit(gas), gasPrice = boundedArcGasPrice(networkPrice), budget = gasLimit * gasPrice;
  return { stage, call: { to, data, value: "0" }, gasBudgetWei: budget.toString(), gasCeiling: { gasLimit: gasLimit.toString(), gasPriceWei: gasPrice.toString() }, feeMinor: feeMinor(budget) };
}
const publicStep = ({ feeMinor: _fee, ...rest }: UsycStep & { feeMinor: bigint }): UsycStep => rest;

function assertOpen(position: UsycPosition, allowed: boolean) {
  if (position.authority === "PAUSED") throw usycPaused();
  // Refused before anything else is checked or prepared.
  if (!allowed) throw notAllowlisted();
}

/**
 * Subscribe `amount` USDC: exact approval to the Teller, then `deposit(amount, wallet)`. Everything is checked
 * first (allowlist, daily limit, preview, balance including both network fees); nothing is prepared otherwise.
 * The deposit cannot be gas-estimated before the approval exists, so it is simulated with the exact allowance
 * set by a read-only state override (falling back to a documented constant when the node refuses overrides).
 */
export async function quoteSubscribe(walletAddress: string, amount: bigint, now = new Date()): Promise<UsycQuote> {
  if (amount <= 0n) throw new UsycError("INVALID_REQUEST", "Enter an amount greater than zero.", 400);
  const wallet = getAddress(walletAddress);
  const position = await readUsycStatus(wallet, now);
  assertOpen(position, position.allowlisted.subscribe);
  const left = BigInt(position.limitsRemaining.subscribe);
  if (amount > left) throw new UsycError("USYC_LIMIT_EXCEEDED", `Today's USYC subscription limit leaves ${usdc(left)} USDC for this wallet. Choose a smaller amount. Nothing was sent.`, 400);

  let preview: readonly [bigint, bigint, bigint], balance: bigint;
  try {
    [preview, balance] = await Promise.all([
      arcClient.readContract({ address: USYC_TELLER, abi: tellerAbi, functionName: "previewDepositData", args: [wallet, amount] }),
      arcClient.readContract({ address: USYC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [wallet] }),
    ]);
  } catch { throw usycUnavailable(); }
  const [shares, fee, price] = preview;
  if (shares === 0n || price <= 0n) throw new UsycError("USYC_AMOUNT_TOO_SMALL", "That amount is too small to buy any USYC. Choose a larger amount. Nothing was sent.", 400);
  if (balance < amount) throw new UsycError("USYC_FUNDS_INSUFFICIENT", `Your wallet has ${usdc(balance)} USDC on Arc Testnet, which is less than the ${usdc(amount)} USDC you asked to spend. Nothing was sent.`, 400);

  const approveData = encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [USYC_TELLER, amount] });
  const depositData = encodeFunctionData({ abi: tellerAbi, functionName: "deposit", args: [amount, wallet] });
  let approveGas: bigint, networkPrice: bigint;
  try { [approveGas, networkPrice] = await Promise.all([arcClient.estimateGas({ account: wallet, to: USYC_USDC, data: approveData, value: 0n }), arcClient.getGasPrice()]); }
  catch { throw usycUnavailable(); }
  let depositGas: bigint, simulated = true;
  try {
    depositGas = await arcClient.estimateGas({ account: wallet, to: USYC_TELLER, data: depositData, value: 0n, stateOverride: [{ address: USYC_USDC, stateDiff: [{ slot: allowanceSlot(wallet, USYC_TELLER), value: pad(toHex(amount), { size: 32 }) }] }] });
  } catch (error) {
    if (isRevert(error)) throw new UsycError("USYC_WOULD_FAIL", "Arc Testnet says this purchase would be rejected right now, for example because of a limit or an allowlist change. Nothing was sent.", 409);
    depositGas = USYC_DEPOSIT_GAS_FALLBACK; simulated = false;
  }

  const approve = step("APPROVE", USYC_USDC, approveData, approveGas, networkPrice);
  const subscribe = step("SUBSCRIBE", USYC_TELLER, depositData, depositGas, networkPrice);
  const networkFee = approve.feeMinor + subscribe.feeMinor;
  if (balance < amount + networkFee) {
    const most = balance > networkFee ? balance - networkFee : 0n;
    throw new UsycError("USYC_FUNDS_INSUFFICIENT", `Your wallet has ${usdc(balance)} USDC on Arc Testnet and the two network fees need about ${usdc(networkFee)} USDC. Buy at most ${usdc(most)} USDC of USYC so the fees are covered. Nothing was sent.`, 400);
  }
  return {
    kind: "SUBSCRIBE", wallet, amountMinor: amount.toString(), steps: [publicStep(approve), publicStep(subscribe)],
    preview: { sharesMinor: shares.toString(), assetsMinor: amount.toString(), feeMinor: fee.toString(), priceUsdcPerUsyc: price.toString(), afterHoursPricing: price !== BigInt(position.priceUsdcPerUsyc) },
    networkFeeMinor: networkFee.toString(), gasSimulated: simulated, observedAt: now.toISOString(),
  };
}

/**
 * Redeem `shares` USYC (or all of it) for USDC straight into the same wallet: `redeem(shares, wallet, wallet)`.
 * No Teller allowance is needed because the caller is the account. Refused before anything is prepared when the
 * wallet is not allowlisted, holds less, exceeds today's limit or the fund cannot pay that much right now.
 */
export async function quoteRedeem(walletAddress: string, request: { sharesMinor: bigint } | { all: true }, now = new Date()): Promise<UsycQuote> {
  const wallet = getAddress(walletAddress);
  const position = await readUsycStatus(wallet, now);
  assertOpen(position, position.allowlisted.redeem);
  const balance = BigInt(position.balanceShares);
  const shares = "all" in request ? balance : request.sharesMinor;
  if (shares <= 0n) throw new UsycError("USYC_BALANCE_INSUFFICIENT", "This wallet holds no USYC to redeem. Nothing was sent.", 400);
  if (shares > balance) throw new UsycError("USYC_BALANCE_INSUFFICIENT", `This wallet holds ${usdc(balance)} USYC, which is less than the ${usdc(shares)} USYC you asked to redeem. Nothing was sent.`, 400);

  let preview: readonly [bigint, bigint, bigint], usdcBalance: bigint;
  try {
    [preview, usdcBalance] = await Promise.all([
      arcClient.readContract({ address: USYC_TELLER, abi: tellerAbi, functionName: "previewRedeemData", args: [wallet, shares] }),
      arcClient.readContract({ address: USYC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [wallet] }),
    ]);
  } catch { throw usycUnavailable(); }
  const [assets, fee, price] = preview;
  if (assets === 0n || price <= 0n) throw new UsycError("USYC_AMOUNT_TOO_SMALL", "That amount is too small to redeem for any USDC. Choose a larger amount. Nothing was sent.", 400);
  const dailyLeft = BigInt(position.limitsRemaining.redeem);
  if (assets > dailyLeft) throw new UsycError("USYC_LIMIT_EXCEEDED", `Today's USYC redemption limit leaves ${usdc(dailyLeft)} USDC for this wallet. Redeem less, or try again tomorrow (UTC). Nothing was sent.`, 400);
  const most = BigInt(position.maxRedeemShares);
  if (shares > most) throw new UsycError("USYC_LIMIT_EXCEEDED", `The fund can pay out at most ${usdc(most)} USYC for this wallet right now. Redeem up to that amount. Nothing was sent.`, 409);

  const data = encodeFunctionData({ abi: tellerAbi, functionName: "redeem", args: [shares, wallet, wallet] });
  let gas: bigint, networkPrice: bigint;
  try { [gas, networkPrice] = await Promise.all([arcClient.estimateGas({ account: wallet, to: USYC_TELLER, data, value: 0n }), arcClient.getGasPrice()]); }
  catch (error) {
    if (isRevert(error)) throw new UsycError("USYC_WOULD_FAIL", "Arc Testnet says this redemption would be rejected right now, for example because of a limit or an allowlist change. Nothing was sent.", 409);
    throw usycUnavailable();
  }
  const redeem = step("REDEEM", USYC_TELLER, data, gas, networkPrice);
  if (usdcBalance < redeem.feeMinor) throw new UsycError("USYC_FUNDS_INSUFFICIENT", `Redeeming needs about ${usdc(redeem.feeMinor)} USDC in this wallet for the network fee, and it has ${usdc(usdcBalance)} USDC. Add a little USDC first. Nothing was sent.`, 400);
  return {
    kind: "REDEEM", wallet, amountMinor: shares.toString(), steps: [publicStep(redeem)],
    preview: { sharesMinor: shares.toString(), assetsMinor: assets.toString(), feeMinor: fee.toString(), priceUsdcPerUsyc: price.toString(), afterHoursPricing: false },
    networkFeeMinor: redeem.feeMinor.toString(), gasSimulated: true, observedAt: now.toISOString(),
  };
}
