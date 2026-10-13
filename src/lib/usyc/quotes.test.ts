// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, erc20Abi, formatUnits, keccak256 } from "viem";
import { chain, depositShares, fakeArcClient, POOL, redeemValue, WALLET, type FakeChain } from "@/test/usyc-chain";

const m = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/gateway", () => ({ get arcClient() { return m.client; } }));
import { quoteDeposit, quoteWithdraw } from "./quotes";
import { POOL_DEPOSIT_GAS_FALLBACK, USDC_ALLOWANCE_MAPPING_SLOT, USYC_USDC, poolAbi } from "./constants";
import { usycQuoteSchema } from "./models";

let state: FakeChain, client: ReturnType<typeof fakeArcClient>;
const use = (patch: Partial<FakeChain> = {}) => { state = chain(patch); client = fakeArcClient(state); m.client = client; };
beforeEach(() => { use(); vi.stubEnv("HODD_USYC_POOL_ADDRESS", POOL); });
afterEach(() => vi.unstubAllEnvs());
const buffered = (gas: bigint) => (gas * 120n + 99n) / 100n;
const nativeToUsdc = (wei: bigint) => (wei + 10n ** 12n - 1n) / 10n ** 12n;
const usdc = (value: number) => BigInt(Math.round(value * 1e6));
/** The pool preview less 0.5%, rounded so the bound never exceeds 99.5% of the preview. */
const bound = (preview: bigint) => preview - (preview * 50n + 9_999n) / 10_000n;
const refusal = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a refusal"); }, (error: { code: string; message: string; status: number }) => error);
const noWritesPrepared = () => { expect(client.estimateGas).not.toHaveBeenCalled(); expect(client.getGasPrice).not.toHaveBeenCalled(); };
const PRICE = 50_000_000_000n; // twice the 25 gwei network price

describe("quoteDeposit", () => {
  it("returns the exact approval to the pool then deposit(amount, wallet, minShares), each with its own gas ceiling", async () => {
    const amount = usdc(5), now = new Date("2026-10-13T13:00:00.000Z");
    const quote = await quoteDeposit(WALLET, amount, now);
    expect(usycQuoteSchema.safeParse(quote).success).toBe(true);
    expect(quote).toMatchObject({ kind: "DEPOSIT", wallet: WALLET, amountMinor: "5000000", gasSimulated: true, observedAt: now.toISOString() });
    expect(quote.steps.map((step) => step.stage)).toEqual(["APPROVE", "DEPOSIT"]);
    const [approve, deposit] = quote.steps;
    expect(approve.call.to).toBe(USYC_USDC);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.call.data as `0x${string}` })).toMatchObject({ functionName: "approve", args: [POOL, amount] });
    expect(deposit.call.to).toBe(POOL);
    const shares = depositShares(state, amount);
    expect(decodeFunctionData({ abi: poolAbi, data: deposit.call.data as `0x${string}` })).toMatchObject({ functionName: "deposit", args: [amount, WALLET, bound(shares)] });
    expect([approve.call.value, deposit.call.value]).toEqual(["0", "0"]);
    expect(approve.gasCeiling).toEqual({ gasLimit: buffered(38_705n).toString(), gasPriceWei: PRICE.toString() });
    expect(deposit.gasCeiling).toEqual({ gasLimit: buffered(331_000n).toString(), gasPriceWei: PRICE.toString() });
    expect(deposit.gasBudgetWei).toBe((buffered(331_000n) * PRICE).toString());
    expect(quote.networkFeeMinor).toBe((nativeToUsdc(buffered(38_705n) * PRICE) + nativeToUsdc(buffered(331_000n) * PRICE)).toString());
    expect(quote.preview).toEqual({ usdcMinor: "5000000", shares: shares.toString(), minimum: bound(shares).toString(), afterHoursPricing: true });
    expect(BigInt(quote.preview.minimum) * 10_000n).toBeLessThanOrEqual(shares * 9_950n);
  });

  it("simulates the deposit as if the exact approval to the pool were already mined, with a read-only state override", async () => {
    const amount = usdc(2);
    await quoteDeposit(WALLET, amount);
    const deposit = client.estimateGas.mock.calls.map(([request]) => request).find((request) => request.to === POOL)!;
    const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [WALLET, USDC_ALLOWANCE_MAPPING_SLOT]));
    const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [POOL, inner]));
    expect(deposit.stateOverride).toEqual([{ address: USYC_USDC, stateDiff: [{ slot, value: `0x${amount.toString(16).padStart(64, "0")}` }] }]);
  });

  it("falls back to a documented gas constant, plus the usual 20%, when the node refuses the override", async () => {
    use({ depositEstimate: "rpc" });
    const quote = await quoteDeposit(WALLET, usdc(1));
    expect(quote.gasSimulated).toBe(false);
    expect(quote.steps[1].gasCeiling.gasLimit).toBe(buffered(POOL_DEPOSIT_GAS_FALLBACK).toString());
    expect(POOL_DEPOSIT_GAS_FALLBACK).toBeGreaterThan(331_000n); // a pool deposit measured on an Arc Testnet fork
  });

  it("refuses when the node says the deposit would revert, without a quote", async () => {
    use({ depositEstimate: "revert" });
    expect(await refusal(quoteDeposit(WALLET, usdc(1)))).toMatchObject({ code: "USYC_WOULD_FAIL", status: 409, message: expect.stringContaining("Nothing was sent") });
  });

  it("refuses an amount the balance cannot cover once both network fees are added, and says what is possible", async () => {
    use({ usdcBalance: usdc(5) });
    const fees = nativeToUsdc(buffered(38_705n) * PRICE) + nativeToUsdc(buffered(331_000n) * PRICE);
    const error = await refusal(quoteDeposit(WALLET, usdc(5)));
    expect(error).toMatchObject({ code: "USYC_FUNDS_INSUFFICIENT", status: 400 });
    expect(error.message).toContain("Your wallet has 5 USDC");
    expect(error.message).toContain(`Deposit at most ${formatUnits(usdc(5) - fees, 6)} USDC`);
    expect((await quoteDeposit(WALLET, usdc(5) - fees)).kind).toBe("DEPOSIT");
  });

  it("refuses an amount above the whole balance before any gas is estimated", async () => {
    use({ usdcBalance: usdc(1) });
    expect(await refusal(quoteDeposit(WALLET, usdc(2)))).toMatchObject({ code: "USYC_FUNDS_INSUFFICIENT" });
    noWritesPrepared();
  });

  it("refuses above what the pool can take now (caps, Circle's daily limit)", async () => {
    use({ maxDeposit: usdc(3) });
    const error = await refusal(quoteDeposit(WALLET, usdc(4)));
    expect(error).toMatchObject({ code: "USYC_LIMIT_EXCEEDED", status: 400 });
    expect(error.message).toContain("at most 3 USDC");
    noWritesPrepared();
    use({ maxDeposit: 0n });
    expect((await refusal(quoteDeposit(WALLET, usdc(1)))).message).toContain("cannot take deposits right now");
  });

  it("refuses while Hodd has paused deposits", async () => {
    use({ depositsPaused: true });
    expect(await refusal(quoteDeposit(WALLET, usdc(1)))).toMatchObject({ code: "USYC_DEPOSITS_PAUSED", status: 409, message: expect.stringContaining("Withdrawals still work") });
    noWritesPrepared();
  });

  it("refuses while Circle does not permit the pool, before previewing the amount or estimating gas", async () => {
    use({ canDeposit: false });
    expect(await refusal(quoteDeposit(WALLET, usdc(7)))).toMatchObject({ code: "USYC_POOL_NOT_PERMITTED", status: 409 });
    noWritesPrepared();
    expect(client.readContract.mock.calls.some(([request]) => request.functionName === "previewDeposit")).toBe(false);
  });

  it("refuses everything while Circle's authority is paused", async () => {
    use({ paused: true });
    expect(await refusal(quoteDeposit(WALLET, usdc(1)))).toMatchObject({ code: "USYC_PAUSED", status: 503 });
    noWritesPrepared();
  });

  it("refuses while the pool is not deployed", async () => {
    vi.stubEnv("HODD_USYC_POOL_ADDRESS", "");
    expect(await refusal(quoteDeposit(WALLET, usdc(1)))).toMatchObject({ code: "USYC_POOL_NOT_DEPLOYED", status: 409 });
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("refuses zero and an amount too small to buy any share", async () => {
    expect(await refusal(quoteDeposit(WALLET, 0n))).toMatchObject({ code: "INVALID_REQUEST" });
    use({ poolUsyc: 10n ** 15n, supply: 1n });
    expect(await refusal(quoteDeposit(WALLET, 1n))).toMatchObject({ code: "USYC_AMOUNT_TOO_SMALL", status: 400 });
    noWritesPrepared();
  });

  it("reports a throttled RPC as retryable without leaking its text", async () => {
    use({ rpcDown: true });
    const error = await refusal(quoteDeposit(WALLET, usdc(1)));
    expect(error).toMatchObject({ code: "USYC_UNAVAILABLE", status: 503 });
    expect(error.message).not.toMatch(/429|secret|HTTP/i);
  });
});

describe("quoteWithdraw", () => {
  it("withdraws everything with one redeem(shares, wallet, wallet, minAssets) call", async () => {
    const quote = await quoteWithdraw(WALLET, { all: true });
    expect(usycQuoteSchema.safeParse(quote).success).toBe(true);
    const expected = redeemValue(state, state.shares);
    expect(quote).toMatchObject({ kind: "WITHDRAW", wallet: WALLET, amountMinor: state.shares.toString(), gasSimulated: true });
    expect(quote.steps.map((step) => step.stage)).toEqual(["WITHDRAW"]);
    expect(quote.steps[0].call.to).toBe(POOL);
    expect(decodeFunctionData({ abi: poolAbi, data: quote.steps[0].call.data as `0x${string}` })).toMatchObject({ functionName: "redeem", args: [state.shares, WALLET, WALLET, bound(expected)] });
    expect(quote.steps[0].gasCeiling).toEqual({ gasLimit: buffered(211_000n).toString(), gasPriceWei: PRICE.toString() });
    expect(quote.preview).toEqual({ usdcMinor: expected.toString(), shares: state.shares.toString(), minimum: bound(expected).toString(), afterHoursPricing: false });
    expect(quote.networkFeeMinor).toBe(nativeToUsdc(buffered(211_000n) * PRICE).toString());
  });

  it("turns a USDC amount into the shares worth at least that much", async () => {
    const amount = usdc(2);
    const quote = await quoteWithdraw(WALLET, { amountMinor: amount });
    const shares = BigInt(quote.amountMinor);
    expect(shares).toBeLessThan(state.shares);
    // The amount asked for, give or take the pool's rounding down of a few base units.
    expect(BigInt(quote.preview.usdcMinor)).toBeGreaterThanOrEqual(amount - 3n);
    expect(redeemValue(state, shares - 1_000_000n)).toBeLessThan(amount);
  });

  it("redeems every share when the amount is the whole value", async () => {
    const value = redeemValue(state, state.shares);
    expect((await quoteWithdraw(WALLET, { amountMinor: value })).amountMinor).toBe(state.shares.toString());
  });

  it("refuses more than the position is worth, and an empty position", async () => {
    const error = await refusal(quoteWithdraw(WALLET, { amountMinor: usdc(100) }));
    expect(error).toMatchObject({ code: "USYC_BALANCE_INSUFFICIENT", message: expect.stringContaining("withdraw everything") });
    use({ shares: 0n, maxRedeem: 0n });
    expect(await refusal(quoteWithdraw(WALLET, { all: true }))).toMatchObject({ code: "USYC_BALANCE_INSUFFICIENT" });
    noWritesPrepared();
  });

  it("refuses more than the pool can pay out now, and says how much it can", async () => {
    use({ maxRedeem: 3_000_000_000_000n });
    const error = await refusal(quoteWithdraw(WALLET, { all: true }));
    expect(error).toMatchObject({ code: "USYC_LIMIT_EXCEEDED", status: 409 });
    expect(error.message).toContain(`at most ${formatUnits(redeemValue(state, 3_000_000_000_000n), 6)} USDC`);
    expect((await quoteWithdraw(WALLET, { amountMinor: usdc(1) })).kind).toBe("WITHDRAW");
    use({ maxRedeem: 0n });
    expect((await refusal(quoteWithdraw(WALLET, { all: true }))).message).toContain("cannot pay out right now");
  });

  it("still lets the user withdraw while Hodd has paused deposits", async () => {
    use({ depositsPaused: true });
    expect((await quoteWithdraw(WALLET, { all: true })).kind).toBe("WITHDRAW");
  });

  it("refuses while Circle does not permit the pool or has paused USYC", async () => {
    use({ canRedeem: false });
    expect(await refusal(quoteWithdraw(WALLET, { all: true }))).toMatchObject({ code: "USYC_POOL_NOT_PERMITTED" });
    use({ paused: true });
    expect(await refusal(quoteWithdraw(WALLET, { all: true }))).toMatchObject({ code: "USYC_PAUSED" });
    noWritesPrepared();
  });

  it("refuses when the wallet has no USDC for the network fee", async () => {
    use({ usdcBalance: 0n });
    expect(await refusal(quoteWithdraw(WALLET, { all: true }))).toMatchObject({ code: "USYC_FUNDS_INSUFFICIENT", message: expect.stringContaining("network fee") });
  });

  it("refuses when the node says the withdrawal would revert", async () => {
    use({ redeemEstimate: "revert" });
    expect(await refusal(quoteWithdraw(WALLET, { all: true }))).toMatchObject({ code: "USYC_WOULD_FAIL", status: 409 });
  });

  it("reports an unreachable node as unavailable, not as a failed withdrawal", async () => {
    use({ redeemEstimate: "rpc" });
    expect(await refusal(quoteWithdraw(WALLET, { all: true }))).toMatchObject({ code: "USYC_UNAVAILABLE", status: 503 });
  });
});
