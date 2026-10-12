// @vitest-environment node
// READ-ONLY live check of Hodd's USYC code against Arc Testnet. It only calls eth_call / eth_estimateGas /
// eth_gasPrice / eth_getTransactionReceipt: no key, no signature, no transaction is ever sent.
// Run: HODD_USYC_LIVE=1 corepack pnpm exec vitest run src/lib/usyc/usyc.live.test.ts
import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";

vi.mock("server-only", () => ({}));
const live = process.env.HODD_USYC_LIVE === "1";
const ALLOWLISTED = "0x93A7F9a958171303DE74Ab7f6778D25F96316564";
const NOT_ALLOWLISTED = "0xdef09d06764ee3ca611ce186f47dbd3f546d2e7c";
const show = (label: string, value: unknown) => console.log(`\n[usyc-live] ${label}\n${JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2)}`);

describe.runIf(live)("USYC on Arc Testnet (read-only)", () => {
  it("reads both wallets and builds quotes without sending anything", async () => {
    const { readUsycStatus } = await import("./status");
    const { quoteRedeem, quoteSubscribe } = await import("./quotes");
    const { USYC_TELLER, tellerAbi } = await import("./constants");

    const allowed = await readUsycStatus(ALLOWLISTED);
    show("readUsycStatus(allowlisted wallet)", allowed);
    expect(allowed).toMatchObject({ authority: "OK", allowlisted: { subscribe: true, redeem: true, receive: true } });
    expect(BigInt(allowed.valueUsdc)).toBeGreaterThan(0n);

    const outsider = await readUsycStatus(NOT_ALLOWLISTED);
    show("readUsycStatus(non-allowlisted wallet)", outsider);
    expect(outsider.allowlisted).toEqual({ subscribe: false, redeem: false, receive: false });

    const subscribe = await quoteSubscribe(ALLOWLISTED, 1_000_000n);
    show("quoteSubscribe(allowlisted, 1 USDC)", subscribe);
    expect(subscribe.steps.map((step) => step.stage)).toEqual(["APPROVE", "SUBSCRIBE"]);
    expect(decodeFunctionData({ abi: tellerAbi, data: subscribe.steps[1].call.data as `0x${string}` }).functionName).toBe("deposit");
    expect(subscribe.steps[1].call.to).toBe(USYC_TELLER);

    const redeem = await quoteRedeem(ALLOWLISTED, { sharesMinor: 100_000n });
    show("quoteRedeem(allowlisted, 0.1 USYC)", redeem);
    const redeemAll = await quoteRedeem(ALLOWLISTED, { all: true });
    show("quoteRedeem(allowlisted, all)", redeemAll);
    expect(redeemAll.amountMinor).toBe(allowed.balanceShares);

    for (const [label, attempt] of [["quoteSubscribe", () => quoteSubscribe(NOT_ALLOWLISTED, 1_000_000n)], ["quoteRedeem", () => quoteRedeem(NOT_ALLOWLISTED, { all: true })]] as const) {
      const refusal = await attempt().then(() => null, (error: { code: string; message: string; status: number }) => ({ code: error.code, status: error.status, message: error.message }));
      show(`${label}(non-allowlisted)`, refusal);
      expect(refusal).toMatchObject({ code: "USYC_NOT_ALLOWLISTED", status: 403 });
    }
  }, 120_000);
});
