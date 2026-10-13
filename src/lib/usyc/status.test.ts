// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toFunctionSelector } from "viem";
import { chain, fakeArcClient, POOL, redeemValue, usycOf, WALLET, type FakeChain } from "@/test/usyc-chain";

const m = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/gateway", () => ({ get arcClient() { return m.client; } }));
import { readUsycStatus } from "./status";
import { POOL_SHARE_DECIMALS, SELECTOR_DEPOSIT, SELECTOR_REDEEM, SELECTOR_TRANSFER, USYC_AUTHORITY, USYC_TELLER, USYC_TOKEN, usycPoolAddress } from "./constants";
import { usycPositionSchema } from "./models";

let state: FakeChain, client: ReturnType<typeof fakeArcClient>;
const use = (patch: Partial<FakeChain> = {}) => { state = chain(patch); client = fakeArcClient(state); m.client = client; };
beforeEach(() => { use(); vi.stubEnv("HODD_USYC_POOL_ADDRESS", POOL.toLowerCase()); });
afterEach(() => vi.unstubAllEnvs());

describe("USYC contract constants", () => {
  it("match the verified Arc Testnet deployment and the selectors the authority is asked about", () => {
    expect(SELECTOR_DEPOSIT).toBe(toFunctionSelector("deposit(uint256,address)"));
    expect(SELECTOR_REDEEM).toBe(toFunctionSelector("redeem(uint256,address,address)"));
    expect(SELECTOR_TRANSFER).toBe(toFunctionSelector("transfer(address,uint256)"));
    expect(USYC_TELLER).toBe("0x9fdF14c5B14173D74C08Af27AebFf39240dC105A");
    expect(USYC_TOKEN).toBe("0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C");
    expect(USYC_AUTHORITY.toLowerCase()).toBe("0xcc205224862c7641930c87679e98999d23c26113");
    expect(POOL_SHARE_DECIMALS).toBe(12);
  });

  it("only accept a well-formed pool address, checksummed", () => {
    expect(usycPoolAddress(POOL.toLowerCase())).toBe(POOL);
    expect(usycPoolAddress(` ${POOL} `)).toBe(POOL);
    for (const bad of ["", "0x123", "pool", null]) expect(usycPoolAddress(bad as string)).toBeNull();
  });
});

describe("readUsycStatus", () => {
  it("is null while the pool is not deployed, without reading the chain", async () => {
    expect(await readUsycStatus(WALLET, new Date(), null)).toBeNull();
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("reads the wallet's shares, their USYC and USDC value, limits and both prices", async () => {
    const now = new Date("2026-10-13T13:00:00.000Z");
    const position = await readUsycStatus(WALLET.toLowerCase(), now);
    expect(usycPositionSchema.safeParse(position).success).toBe(true);
    const value = redeemValue(state, state.shares);
    expect(position).toEqual({
      wallet: WALLET, pool: POOL, circle: "OK", depositsPaused: false, maxDepositUsdc: "1000000000",
      shares: "8000000000000", usycMinor: usycOf(state, state.shares).toString(), valueUsdc: value.toString(),
      maxWithdrawShares: "8000000000000", maxWithdrawUsdc: value.toString(),
      priceUsdcPerUsyc: state.latestPrice.toString(), subscribePriceUsdcPerUsyc: state.mintPrice.toString(),
      // The subscribe price differs from the latest price: the next price applies (after 14:00 New York or a stale oracle).
      afterHoursPricing: true, observedAt: now.toISOString(),
    });
    expect(value).toBeGreaterThan(9_000_000n); // 8 USYC at 1.1397
  });

  it("asks Circle about the pool, never about the user's wallet", async () => {
    await readUsycStatus(WALLET);
    const asked = client.readContract.mock.calls.map(([request]) => request).filter((request) => request.functionName === "canCall");
    expect(asked).toHaveLength(3);
    for (const request of asked) expect(request.args![0]).toBe(POOL);
    const previews = client.readContract.mock.calls.map(([request]) => request).filter((request) => request.address === USYC_TELLER);
    for (const request of previews) expect(request.args![0]).toBe(POOL);
  });

  it("reports a pool Circle has not allowlisted (any of deposit, redeem or receive missing)", async () => {
    for (const patch of [{ canDeposit: false }, { canRedeem: false }, { canTransfer: false }]) {
      use(patch);
      expect((await readUsycStatus(WALLET))!.circle).toBe("NOT_PERMITTED");
    }
  });

  it("reports a paused authority without asking it anything else, and still shows the holding", async () => {
    use({ paused: true });
    const position = await readUsycStatus(WALLET);
    expect(position).toMatchObject({ circle: "PAUSED", shares: "8000000000000" });
    expect(client.readContract.mock.calls.some(([request]) => request.functionName === "canCall")).toBe(false);
  });

  it("shows an empty position without valuing anything", async () => {
    use({ shares: 0n, maxRedeem: 0n });
    expect(await readUsycStatus(WALLET)).toMatchObject({ shares: "0", usycMinor: "0", valueUsdc: "0", maxWithdrawShares: "0", maxWithdrawUsdc: "0" });
    expect(client.readContract.mock.calls.some(([request]) => request.functionName === "usycOf" || request.functionName === "previewRedeem")).toBe(false);
  });

  it("values what can be withdrawn now separately when the pool can pay out less than the position", async () => {
    use({ maxRedeem: 3_000_000_000_000n });
    const position = (await readUsycStatus(WALLET))!;
    expect(position.maxWithdrawShares).toBe("3000000000000");
    expect(position.maxWithdrawUsdc).toBe(redeemValue(state, 3_000_000_000_000n).toString());
  });

  it("reports paused deposits", async () => {
    use({ depositsPaused: true });
    expect(await readUsycStatus(WALLET)).toMatchObject({ depositsPaused: true, maxDepositUsdc: "0" });
  });

  it("does not flag after-hours pricing while both prices are equal", async () => {
    use({ mintPrice: 1_139_744_957_475_496_722n });
    expect((await readUsycStatus(WALLET))!.afterHoursPricing).toBe(false);
  });

  it("answers an RPC failure with a plain error that carries no RPC text", async () => {
    use({ rpcDown: true });
    const failure = await readUsycStatus(WALLET).catch((error: Error) => error);
    expect(failure).toMatchObject({ code: "USYC_UNAVAILABLE", status: 503, message: expect.stringContaining("try again") });
    expect((failure as Error).message).not.toMatch(/429|secret|rpc\.testnet|HTTP/i);
  });

  it("refuses a zero oracle price instead of valuing at zero", async () => {
    use({ latestPrice: 0n });
    await expect(readUsycStatus(WALLET)).rejects.toMatchObject({ code: "USYC_UNAVAILABLE" });
  });
});
