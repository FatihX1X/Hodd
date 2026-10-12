// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, erc20Abi, formatUnits, keccak256 } from "viem";
import { chain, fakeArcClient, OUTSIDER, WALLET, type FakeChain } from "@/test/usyc-chain";

const m = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/gateway", () => ({ get arcClient() { return m.client; } }));
import { quoteRedeem, quoteSubscribe } from "./quotes";
import { USDC_ALLOWANCE_MAPPING_SLOT, USYC_DEPOSIT_GAS_FALLBACK, USYC_TELLER, USYC_USDC, tellerAbi } from "./constants";
import { usycQuoteSchema } from "./models";

let state: FakeChain, client: ReturnType<typeof fakeArcClient>;
const use = (patch: Partial<FakeChain> = {}) => { state = chain(patch); client = fakeArcClient(state); m.client = client; };
beforeEach(() => use());
const buffered = (gas: bigint) => (gas * 120n + 99n) / 100n;
const nativeToUsdc = (wei: bigint) => (wei + 10n ** 12n - 1n) / 10n ** 12n;
const usdc = (value: number) => BigInt(Math.round(value * 1e6));
const refusal = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a refusal"); }, (error: { code: string; message: string; status: number }) => error);
const noWritesPrepared = () => { expect(client.estimateGas).not.toHaveBeenCalled(); expect(client.getGasPrice).not.toHaveBeenCalled(); };

describe("quoteSubscribe", () => {
  it("returns the exact approval then the deposit, each with its own gas ceiling", async () => {
    const amount = usdc(5), now = new Date("2026-10-12T13:00:00.000Z");
    const quote = await quoteSubscribe(WALLET, amount, now);
    expect(usycQuoteSchema.safeParse(quote).success).toBe(true);
    expect(quote).toMatchObject({ kind: "SUBSCRIBE", wallet: WALLET, amountMinor: "5000000", gasSimulated: true, observedAt: now.toISOString() });
    expect(quote.steps.map((step) => step.stage)).toEqual(["APPROVE", "SUBSCRIBE"]);
    const [approve, subscribe] = quote.steps;
    expect(approve.call.to).toBe(USYC_USDC);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.call.data as `0x${string}` })).toMatchObject({ functionName: "approve", args: [USYC_TELLER, amount] });
    expect(subscribe.call.to).toBe(USYC_TELLER);
    expect(decodeFunctionData({ abi: tellerAbi, data: subscribe.call.data as `0x${string}` })).toMatchObject({ functionName: "deposit", args: [amount, WALLET] });
    expect([approve.call.value, subscribe.call.value]).toEqual(["0", "0"]);
    // 20% over each estimate, at twice the 25 gwei network price.
    const price = 50_000_000_000n;
    expect(approve.gasCeiling).toEqual({ gasLimit: buffered(38_705n).toString(), gasPriceWei: price.toString() });
    expect(subscribe.gasCeiling).toEqual({ gasLimit: buffered(215_262n).toString(), gasPriceWei: price.toString() });
    expect(approve.gasBudgetWei).toBe((buffered(38_705n) * price).toString());
    expect(subscribe.gasBudgetWei).toBe((buffered(215_262n) * price).toString());
    expect(quote.networkFeeMinor).toBe((nativeToUsdc(buffered(38_705n) * price) + nativeToUsdc(buffered(215_262n) * price)).toString());
    // 5 USDC at the subscribe price of 1.1402, no fee.
    expect(quote.preview).toEqual({ sharesMinor: (amount * 10n ** 18n / state.mintPrice).toString(), assetsMinor: "5000000", feeMinor: "0", priceUsdcPerUsyc: state.mintPrice.toString(), afterHoursPricing: true });
  });

  it("simulates the deposit as if the exact approval were already mined, with a read-only state override", async () => {
    const amount = usdc(2);
    await quoteSubscribe(WALLET, amount);
    const deposit = client.estimateGas.mock.calls.map(([request]) => request).find((request) => request.to === USYC_TELLER)!;
    const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [WALLET, USDC_ALLOWANCE_MAPPING_SLOT]));
    const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [USYC_TELLER, inner]));
    expect(deposit.stateOverride).toEqual([{ address: USYC_USDC, stateDiff: [{ slot, value: `0x${amount.toString(16).padStart(64, "0")}` }] }]);
  });

  it("falls back to a documented gas constant, plus the usual 20%, when the node refuses the override", async () => {
    use({ depositEstimate: "rpc" });
    const quote = await quoteSubscribe(WALLET, usdc(1));
    expect(quote.gasSimulated).toBe(false);
    expect(quote.steps[1].gasCeiling.gasLimit).toBe(buffered(USYC_DEPOSIT_GAS_FALLBACK).toString());
    expect(USYC_DEPOSIT_GAS_FALLBACK).toBeGreaterThan(243_799n); // the first subscription measured on Arc Testnet
  });

  it("refuses when the node says the deposit would revert, without a quote", async () => {
    use({ depositEstimate: "revert" });
    expect(await refusal(quoteSubscribe(WALLET, usdc(1)))).toMatchObject({ code: "USYC_WOULD_FAIL", status: 409, message: expect.stringContaining("Nothing was sent") });
  });

  it("refuses an amount the balance cannot cover once both network fees are added, and says what is possible", async () => {
    use({ usdcBalance: usdc(5) });
    const fees = nativeToUsdc(buffered(38_705n) * 50_000_000_000n) + nativeToUsdc(buffered(215_262n) * 50_000_000_000n);
    const error = await refusal(quoteSubscribe(WALLET, usdc(5)));
    expect(error).toMatchObject({ code: "USYC_FUNDS_INSUFFICIENT", status: 400 });
    expect(error.message).toContain("Your wallet has 5 USDC");
    expect(error.message).toContain(`Buy at most ${formatUnits(usdc(5) - fees, 6)} USDC`);
    expect(error.message).toContain("Nothing was sent");
    // Spending a little less leaves room for the fees.
    expect((await quoteSubscribe(WALLET, usdc(5) - fees)).kind).toBe("SUBSCRIBE");
  });

  it("refuses an amount above the whole balance before any gas is estimated", async () => {
    use({ usdcBalance: usdc(1) });
    const error = await refusal(quoteSubscribe(WALLET, usdc(2)));
    expect(error).toMatchObject({ code: "USYC_FUNDS_INSUFFICIENT" });
    noWritesPrepared();
  });

  it("refuses above today's subscription limit", async () => {
    use({ subscribeLeft: usdc(3) });
    const error = await refusal(quoteSubscribe(WALLET, usdc(4)));
    expect(error).toMatchObject({ code: "USYC_LIMIT_EXCEEDED", status: 400 });
    expect(error.message).toContain("leaves 3 USDC");
    noWritesPrepared();
  });

  it("refuses a wallet that is not allowlisted before reading anything else or estimating gas", async () => {
    use({ canDeposit: false, canRedeem: false, canTransfer: false });
    const error = await refusal(quoteSubscribe(OUTSIDER, usdc(7)));
    expect(error).toMatchObject({ code: "USYC_NOT_ALLOWLISTED", status: 403, message: expect.stringContaining("not allowlisted") });
    noWritesPrepared();
    // Only the status read ran (its price probe uses 1 USDC); the requested 7 USDC was never previewed and no balance was read for it.
    expect(client.readContract.mock.calls.some(([request]) => request.functionName === "previewDepositData" && (request.args as unknown[])[1] === usdc(7))).toBe(false);
  });

  it("refuses everything while Circle's authority is paused", async () => {
    use({ paused: true });
    expect(await refusal(quoteSubscribe(WALLET, usdc(1)))).toMatchObject({ code: "USYC_PAUSED", status: 503 });
    noWritesPrepared();
  });

  it("refuses an amount too small to mint any USYC", async () => {
    expect(await refusal(quoteSubscribe(WALLET, 1n))).toMatchObject({ code: "USYC_AMOUNT_TOO_SMALL", status: 400 });
    noWritesPrepared();
  });

  it("reports a throttled RPC as retryable without leaking its text", async () => {
    use({ rpcDown: true });
    const error = await refusal(quoteSubscribe(WALLET, usdc(1)));
    expect(error).toMatchObject({ code: "USYC_UNAVAILABLE", status: 503 });
    expect(error.message).not.toMatch(/429|secret|HTTP/i);
  });

  it("shows a fee in the preview when the Teller charges one", async () => {
    use({ depositFee: 2_000n });
    const quote = await quoteSubscribe(WALLET, usdc(10));
    expect(quote.preview).toMatchObject({ feeMinor: "2000", assetsMinor: "10000000" });
    expect(BigInt(quote.preview.sharesMinor)).toBe((usdc(10) - 2_000n) * 10n ** 18n / state.mintPrice);
  });
});

describe("quoteRedeem", () => {
  it("returns one redeem(shares, wallet, wallet) call with its own gas ceiling and the USDC to receive", async () => {
    const quote = await quoteRedeem(WALLET, { sharesMinor: 2_000_000n });
    expect(usycQuoteSchema.safeParse(quote).success).toBe(true);
    expect(quote).toMatchObject({ kind: "REDEEM", wallet: WALLET, amountMinor: "2000000" });
    expect(quote.steps.map((step) => step.stage)).toEqual(["REDEEM"]);
    expect(quote.steps[0].call.to).toBe(USYC_TELLER);
    expect(decodeFunctionData({ abi: tellerAbi, data: quote.steps[0].call.data as `0x${string}` })).toMatchObject({ functionName: "redeem", args: [2_000_000n, WALLET, WALLET] });
    expect(quote.steps[0].gasCeiling).toEqual({ gasLimit: buffered(190_330n).toString(), gasPriceWei: "50000000000" });
    expect(quote.preview).toEqual({ sharesMinor: "2000000", assetsMinor: (2_000_000n * state.latestPrice / 10n ** 18n).toString(), feeMinor: "0", priceUsdcPerUsyc: state.latestPrice.toString(), afterHoursPricing: false });
    expect(quote.networkFeeMinor).toBe(nativeToUsdc(buffered(190_330n) * 50_000_000_000n).toString());
  });

  it("redeems the whole balance for 'Redeem all'", async () => {
    const quote = await quoteRedeem(WALLET, { all: true });
    expect(quote.amountMinor).toBe("8000290");
    expect(decodeFunctionData({ abi: tellerAbi, data: quote.steps[0].call.data as `0x${string}` })).toMatchObject({ args: [8_000_290n, WALLET, WALLET] });
  });

  it("refuses more than the balance, and an empty wallet", async () => {
    expect(await refusal(quoteRedeem(WALLET, { sharesMinor: 9_000_000n }))).toMatchObject({ code: "USYC_BALANCE_INSUFFICIENT", message: expect.stringContaining("holds 8.00029 USYC") });
    use({ usycBalance: 0n });
    expect(await refusal(quoteRedeem(WALLET, { all: true }))).toMatchObject({ code: "USYC_BALANCE_INSUFFICIENT" });
    noWritesPrepared();
  });

  it("refuses above today's redemption limit", async () => {
    use({ redeemLeft: usdc(1) });
    const error = await refusal(quoteRedeem(WALLET, { sharesMinor: 2_000_000n }));
    expect(error).toMatchObject({ code: "USYC_LIMIT_EXCEEDED", status: 400 });
    expect(error.message).toContain("leaves 1 USDC");
    noWritesPrepared();
  });

  it("refuses more than the Teller will pay out right now", async () => {
    use({ maxRedeem: 3_000_000n });
    const error = await refusal(quoteRedeem(WALLET, { all: true }));
    expect(error).toMatchObject({ code: "USYC_LIMIT_EXCEEDED", status: 409 });
    expect(error.message).toContain("at most 3 USYC");
    expect((await quoteRedeem(WALLET, { sharesMinor: 3_000_000n })).kind).toBe("REDEEM");
  });

  it("refuses a wallet that is not allowlisted for redeeming before anything else", async () => {
    use({ canRedeem: false });
    expect(await refusal(quoteRedeem(WALLET, { all: true }))).toMatchObject({ code: "USYC_NOT_ALLOWLISTED", status: 403 });
    noWritesPrepared();
  });

  it("refuses when the wallet has no USDC for the network fee", async () => {
    use({ usdcBalance: 0n });
    expect(await refusal(quoteRedeem(WALLET, { all: true }))).toMatchObject({ code: "USYC_FUNDS_INSUFFICIENT", message: expect.stringContaining("network fee") });
  });

  it("refuses when the node says the redemption would revert", async () => {
    use({ redeemEstimate: "revert" });
    expect(await refusal(quoteRedeem(WALLET, { all: true }))).toMatchObject({ code: "USYC_WOULD_FAIL", status: 409 });
  });

  it("reports an unreachable node as unavailable, not as a failed redemption", async () => {
    use({ redeemEstimate: "rpc" });
    expect(await refusal(quoteRedeem(WALLET, { all: true }))).toMatchObject({ code: "USYC_UNAVAILABLE", status: 503 });
  });

  it("refuses everything while Circle's authority is paused", async () => {
    use({ paused: true });
    expect(await refusal(quoteRedeem(WALLET, { all: true }))).toMatchObject({ code: "USYC_PAUSED" });
  });
});
