import "server-only";
import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, encodeAbiParameters, encodeFunctionData, formatUnits, getAddress, keccak256, pad, toHex } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { boundedArcGasPrice, bufferedEarnGasLimit } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { POOL_DEPOSIT_GAS_FALLBACK, POOL_SLIPPAGE_BPS, USDC_ALLOWANCE_MAPPING_SLOT, USYC_USDC, poolAbi, usdcAbi } from "./constants";
import { UsycError, circleNotPermitted, poolNotDeployed, usycPaused, usycUnavailable } from "./errors";
import type { UsycPosition, UsycQuote, UsycStep } from "./models";
import { readUsycStatus } from "./status";

const usdc = (minor: bigint) => formatUnits(minor > 0n ? minor : 0n, 6);
const feeMinor = (wei: bigint) => BigInt(nativeWeiToUsdcCeil(wei.toString()).minorUnits);
/** The bound written into the transaction: the pool's own preview less 0.5%. */
const bounded = (preview: bigint) => preview - (preview * POOL_SLIPPAGE_BPS + 9_999n) / 10_000n;

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
const publicStep = ({ stage, call, gasBudgetWei, gasCeiling }: UsycStep & { feeMinor: bigint }): UsycStep => ({ stage, call, gasBudgetWei, gasCeiling });

async function position(wallet: `0x${string}`, now: Date): Promise<UsycPosition> {
  const read = await readUsycStatus(wallet, now);
  if (!read) throw poolNotDeployed();
  if (read.circle === "PAUSED") throw usycPaused();
  if (read.circle === "NOT_PERMITTED") throw circleNotPermitted();
  return read;
}

/**
 * Deposit `amount` USDC into the pool: exact approval to the pool, then `deposit(amount, wallet, minShares)`.
 * Everything is checked first (Circle permits the pool, deposits open, caps and Circle's daily limit, balance
 * including both network fees); nothing is prepared otherwise. The deposit cannot be gas-estimated before the
 * approval exists, so it is simulated with the exact allowance set by a read-only state override (falling back
 * to a documented constant when the node refuses overrides).
 */
export async function quoteDeposit(walletAddress: string, amount: bigint, now = new Date()): Promise<UsycQuote> {
  if (amount <= 0n) throw new UsycError("INVALID_REQUEST", "Enter an amount greater than zero.", 400);
  const wallet = getAddress(walletAddress);
  const read = await position(wallet, now), pool = getAddress(read.pool);
  if (read.depositsPaused) throw new UsycError("USYC_DEPOSITS_PAUSED", "Hodd has paused new deposits into the USYC pool for now. Withdrawals still work. Nothing was sent.", 409);
  const most = BigInt(read.maxDepositUsdc);
  if (amount > most) throw new UsycError("USYC_LIMIT_EXCEEDED", most === 0n ? "The USYC pool cannot take deposits right now (its cap or Circle's daily limit is reached). Nothing was sent." : `The USYC pool can take at most ${usdc(most)} USDC right now. Choose a smaller amount. Nothing was sent.`, 400);

  let expected: bigint, balance: bigint;
  try {
    [expected, balance] = await Promise.all([
      arcClient.readContract({ address: pool, abi: poolAbi, functionName: "previewDeposit", args: [amount] }),
      arcClient.readContract({ address: USYC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [wallet] }),
    ]);
  } catch { throw usycUnavailable(); }
  const minShares = bounded(expected);
  if (expected === 0n || minShares === 0n) throw new UsycError("USYC_AMOUNT_TOO_SMALL", "That amount is too small to buy into the USYC pool. Choose a larger amount. Nothing was sent.", 400);
  if (balance < amount) throw new UsycError("USYC_FUNDS_INSUFFICIENT", `Your wallet has ${usdc(balance)} USDC on Arc Testnet, which is less than the ${usdc(amount)} USDC you asked to deposit. Nothing was sent.`, 400);

  const approveData = encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [pool, amount] });
  const depositData = encodeFunctionData({ abi: poolAbi, functionName: "deposit", args: [amount, wallet, minShares] });
  let approveGas: bigint, networkPrice: bigint;
  try { [approveGas, networkPrice] = await Promise.all([arcClient.estimateGas({ account: wallet, to: USYC_USDC, data: approveData, value: 0n }), arcClient.getGasPrice()]); }
  catch { throw usycUnavailable(); }
  let depositGas: bigint, simulated = true;
  try {
    depositGas = await arcClient.estimateGas({ account: wallet, to: pool, data: depositData, value: 0n, stateOverride: [{ address: USYC_USDC, stateDiff: [{ slot: allowanceSlot(wallet, pool), value: pad(toHex(amount), { size: 32 }) }] }] });
  } catch (error) {
    if (isRevert(error)) throw new UsycError("USYC_WOULD_FAIL", "Arc Testnet says this deposit would be rejected right now, for example because of a cap, Circle's daily limit or a price move. Nothing was sent.", 409);
    depositGas = POOL_DEPOSIT_GAS_FALLBACK; simulated = false;
  }

  const approve = step("APPROVE", USYC_USDC, approveData, approveGas, networkPrice);
  const deposit = step("DEPOSIT", pool, depositData, depositGas, networkPrice);
  const networkFee = approve.feeMinor + deposit.feeMinor;
  if (balance < amount + networkFee) {
    const left = balance > networkFee ? balance - networkFee : 0n;
    throw new UsycError("USYC_FUNDS_INSUFFICIENT", `Your wallet has ${usdc(balance)} USDC on Arc Testnet and the two network fees need about ${usdc(networkFee)} USDC. Deposit at most ${usdc(left)} USDC so the fees are covered. Nothing was sent.`, 400);
  }
  return {
    kind: "DEPOSIT", wallet, amountMinor: amount.toString(), steps: [publicStep(approve), publicStep(deposit)],
    preview: { usdcMinor: amount.toString(), shares: expected.toString(), minimum: minShares.toString(), afterHoursPricing: read.afterHoursPricing },
    networkFeeMinor: networkFee.toString(), gasSimulated: simulated, observedAt: now.toISOString(),
  };
}

/**
 * Withdraw from the pool as USDC to the same wallet: `redeem(shares, wallet, wallet, minAssets)`. `all` redeems
 * every share; an amount in USDC redeems the shares worth at least that much (never more than the user holds).
 * Refused before anything is prepared when Circle does not permit the pool, the user holds nothing or the
 * pool's shared daily limit or fund liquidity cannot pay that much right now.
 */
export async function quoteWithdraw(walletAddress: string, request: { amountMinor: bigint } | { all: true }, now = new Date()): Promise<UsycQuote> {
  const wallet = getAddress(walletAddress);
  const read = await position(wallet, now), pool = getAddress(read.pool);
  const held = BigInt(read.shares), value = BigInt(read.valueUsdc);
  if (held === 0n || value === 0n) throw new UsycError("USYC_BALANCE_INSUFFICIENT", "You have nothing in the USYC pool to withdraw. Nothing was sent.", 400);
  let shares: bigint;
  if ("all" in request) shares = held;
  else {
    if (request.amountMinor > value) throw new UsycError("USYC_BALANCE_INSUFFICIENT", `Your USYC pool balance is worth ${usdc(value)} USDC, which is less than the ${usdc(request.amountMinor)} USDC you asked for. Withdraw less, or withdraw everything. Nothing was sent.`, 400);
    // Shares worth at least the amount at the current preview (rounded up), never more than held.
    shares = (request.amountMinor * held + value - 1n) / value;
    if (shares > held) shares = held;
  }
  const most = BigInt(read.maxWithdrawShares);
  if (shares > most) throw new UsycError("USYC_LIMIT_EXCEEDED", most === 0n ? "The USYC pool cannot pay out right now (Circle's daily limit or the fund's liquidity is used up). Try again later. Nothing was sent." : `The USYC pool can pay out at most ${usdc(BigInt(read.maxWithdrawUsdc))} USDC to you right now. Withdraw up to that amount. Nothing was sent.`, 409);

  let expected: bigint, usdcBalance: bigint;
  try {
    [expected, usdcBalance] = await Promise.all([
      arcClient.readContract({ address: pool, abi: poolAbi, functionName: "previewRedeem", args: [shares] }),
      arcClient.readContract({ address: USYC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [wallet] }),
    ]);
  } catch { throw usycUnavailable(); }
  const minAssets = bounded(expected);
  if (expected === 0n || minAssets === 0n) throw new UsycError("USYC_AMOUNT_TOO_SMALL", "That amount is too small to withdraw. Choose a larger amount. Nothing was sent.", 400);

  const data = encodeFunctionData({ abi: poolAbi, functionName: "redeem", args: [shares, wallet, wallet, minAssets] });
  let gas: bigint, networkPrice: bigint;
  try { [gas, networkPrice] = await Promise.all([arcClient.estimateGas({ account: wallet, to: pool, data, value: 0n }), arcClient.getGasPrice()]); }
  catch (error) {
    if (isRevert(error)) throw new UsycError("USYC_WOULD_FAIL", "Arc Testnet says this withdrawal would be rejected right now, for example because of Circle's daily limit or a price move. Nothing was sent.", 409);
    throw usycUnavailable();
  }
  const withdraw = step("WITHDRAW", pool, data, gas, networkPrice);
  if (usdcBalance < withdraw.feeMinor) throw new UsycError("USYC_FUNDS_INSUFFICIENT", `Withdrawing needs about ${usdc(withdraw.feeMinor)} USDC in this wallet for the network fee, and it has ${usdc(usdcBalance)} USDC. Add a little USDC and try again. Nothing was sent.`, 400);
  return {
    kind: "WITHDRAW", wallet, amountMinor: shares.toString(), steps: [publicStep(withdraw)],
    preview: { usdcMinor: expected.toString(), shares: shares.toString(), minimum: minAssets.toString(), afterHoursPricing: false },
    networkFeeMinor: withdraw.feeMinor.toString(), gasSimulated: true, observedAt: now.toISOString(),
  };
}
