// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toFunctionSelector } from "viem";
import { chain, fakeArcClient, OUTSIDER, WALLET, type FakeChain } from "@/test/usyc-chain";

const m = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/gateway", () => ({ get arcClient() { return m.client; } }));
import { readUsycStatus } from "./status";
import { SELECTOR_DEPOSIT, SELECTOR_REDEEM, SELECTOR_TRANSFER, USYC_AUTHORITY, USYC_TELLER, USYC_TOKEN } from "./constants";
import { usycPositionSchema } from "./models";

const E18 = 10n ** 18n;
let state: FakeChain, client: ReturnType<typeof fakeArcClient>;
const use = (patch: Partial<FakeChain> = {}) => { state = chain(patch); client = fakeArcClient(state); m.client = client; };
beforeEach(() => use());

describe("USYC contract constants", () => {
  it("match the verified Arc Testnet deployment and the selectors the authority is asked about", () => {
    expect(SELECTOR_DEPOSIT).toBe(toFunctionSelector("deposit(uint256,address)"));
    expect(SELECTOR_REDEEM).toBe(toFunctionSelector("redeem(uint256,address,address)"));
    expect(SELECTOR_TRANSFER).toBe(toFunctionSelector("transfer(address,uint256)"));
    expect(USYC_TELLER).toBe("0x9fdF14c5B14173D74C08Af27AebFf39240dC105A");
    expect(USYC_TOKEN).toBe("0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C");
    expect(USYC_AUTHORITY.toLowerCase()).toBe("0xcc205224862c7641930c87679e98999d23c26113");
  });
});

describe("readUsycStatus", () => {
  it("reads an allowlisted wallet: balance, value at the latest price, prices, limits and fee rates", async () => {
    const now = new Date("2026-10-12T13:00:00.000Z");
    const position = await readUsycStatus(WALLET.toLowerCase(), now);
    expect(usycPositionSchema.safeParse(position).success).toBe(true);
    expect(position).toMatchObject({
      wallet: WALLET, authority: "OK", allowlisted: { subscribe: true, redeem: true, receive: true },
      balanceShares: "8000290", valueUsdc: (8_000_290n * state.latestPrice / E18).toString(),
      priceUsdcPerUsyc: state.latestPrice.toString(), subscribePriceUsdcPerUsyc: state.mintPrice.toString(),
      fees: { subscribePercent: "0.04", redeemPercent: "0.03" },
      limitsRemaining: { subscribe: "999990000000", redeem: "999999122397" },
      maxRedeemShares: "8000290", observedAt: now.toISOString(),
    });
    expect(position.maxRedeemValueUsdc).toBe(position.valueUsdc);
    // The subscribe price differs from the latest price: the next price applies (after the 14:00 New York cutoff or a stale oracle).
    expect(position.afterHoursPricing).toBe(true);
  });

  it("does not flag after-hours pricing while both prices are equal", async () => {
    use({ mintPrice: 1_139_744_957_475_496_722n });
    expect((await readUsycStatus(WALLET)).afterHoursPricing).toBe(false);
  });

  it("reports a wallet that is not allowlisted, with no balance and no value", async () => {
    use({ canDeposit: false, canRedeem: false, canTransfer: false, usycBalance: 0n, usdcBalance: 53_638_309n });
    const position = await readUsycStatus(OUTSIDER);
    expect(position).toMatchObject({ authority: "OK", allowlisted: { subscribe: false, redeem: false, receive: false }, balanceShares: "0", valueUsdc: "0", maxRedeemShares: "0", maxRedeemValueUsdc: "0" });
  });

  it("needs the deposit AND the receive entitlement to subscribe, and the redeem AND receive entitlement to redeem", async () => {
    use({ canDeposit: true, canRedeem: true, canTransfer: false });
    expect((await readUsycStatus(WALLET)).allowlisted).toEqual({ subscribe: false, redeem: false, receive: false });
    use({ canDeposit: true, canRedeem: false, canTransfer: true });
    expect((await readUsycStatus(WALLET)).allowlisted).toEqual({ subscribe: true, redeem: false, receive: true });
  });

  it("reports a paused authority without asking it anything else, and still shows the holding", async () => {
    use({ paused: true });
    const position = await readUsycStatus(WALLET);
    expect(position.authority).toBe("PAUSED");
    expect(position.allowlisted).toEqual({ subscribe: false, redeem: false, receive: false });
    expect(position.balanceShares).toBe("8000290");
    expect(client.readContract.mock.calls.some(([request]) => request.functionName === "canCall")).toBe(false);
  });

  it("values the redeemable amount separately when the Teller can pay out less than the balance", async () => {
    use({ maxRedeem: 3_000_000n });
    const position = await readUsycStatus(WALLET);
    expect(position.maxRedeemShares).toBe("3000000");
    expect(position.maxRedeemValueUsdc).toBe((3_000_000n * state.latestPrice / E18).toString());
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
