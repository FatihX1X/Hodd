// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chain, fakeArcClient, notFound, OUTSIDER, POOL, receipt, redeemed, shareTransfer, subscribed, usdcApproval, usdcTransfer, USYC_TELLER, WALLET, zeroAddress } from "@/test/usyc-chain";

const m = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/gateway", () => ({ get arcClient() { return m.client; } }));
import { verifyUsycTransaction } from "./verify";

let client: ReturnType<typeof fakeArcClient>;
const hash = `0x${"b".repeat(64)}`;
const OTHER_POOL = "0x1111111111111111111111111111111111111111";
beforeEach(() => { client = fakeArcClient(chain()); m.client = client; vi.stubEnv("HODD_USYC_POOL_ADDRESS", POOL); });
afterEach(() => vi.unstubAllEnvs());
const verify = (step: "APPROVE" | "DEPOSIT" | "WITHDRAW", amount?: bigint, wallet: string = WALLET) => verifyUsycTransaction({ wallet, step, txHash: hash.toUpperCase().replace("0X", "0x"), amount });
// A pool deposit of 10 USDC: USDC in from the wallet, USDC on to the Teller, shares minted to the wallet.
const deposit = (wallet: string = WALLET, usdcIn = 10_000_000n, shares = 8_770_290_000_000n, minted = shares, pool: string = POOL) => receipt("success", [
  usdcTransfer(wallet, pool, usdcIn), usdcTransfer(pool, USYC_TELLER, usdcIn), shareTransfer(zeroAddress, wallet, minted, pool), subscribed(wallet, wallet, usdcIn, 8_770_290n, shares, pool),
]);
const withdrawal = (wallet: string = WALLET, shares = 770_000_000_000n, usdcOut = 877_603n, paidTo: string = wallet, burned = shares) => receipt("success", [
  shareTransfer(wallet, zeroAddress, burned), usdcTransfer(USYC_TELLER, POOL, usdcOut), usdcTransfer(POOL, paidTo, usdcOut), redeemed(wallet, shares, 770_000n, usdcOut),
]);

describe("verifyUsycTransaction", () => {
  it("confirms a pool deposit from the USDC paid in and the exact share mint to the wallet", async () => {
    client.getTransactionReceipt.mockResolvedValue(deposit());
    expect(await verify("DEPOSIT", 10_000_000n)).toEqual({ status: "CONFIRMED", step: "DEPOSIT", txHash: hash, depositedUsdcMinor: "10000000", receivedShares: "8770290000000" });
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash });
  });

  it("confirms a withdrawal from the share burn and the USDC the pool paid to the wallet", async () => {
    client.getTransactionReceipt.mockResolvedValue(withdrawal());
    expect(await verify("WITHDRAW", 770_000_000_000n)).toEqual({ status: "CONFIRMED", step: "WITHDRAW", txHash: hash, burnedShares: "770000000000", receivedUsdcMinor: "877603" });
  });

  it("confirms an exact approval to the pool and nothing else", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usdcApproval(WALLET, POOL, 5_000_000n)]));
    expect(await verify("APPROVE", 5_000_000n)).toMatchObject({ status: "CONFIRMED", step: "APPROVE" });
    expect(await verify("APPROVE", 6_000_000n)).toMatchObject({ status: "UNRELATED" });
    // An approval to the Teller (the old direct flow) or to anyone else is not an approval to the pool.
    for (const spender of [USYC_TELLER, OUTSIDER]) {
      client.getTransactionReceipt.mockResolvedValue(receipt("success", [usdcApproval(WALLET, spender, 5_000_000n)]));
      expect(await verify("APPROVE", 5_000_000n)).toMatchObject({ status: "UNRELATED" });
    }
  });

  it("calls a transaction that did something else unrelated", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usdcTransfer(WALLET, OUTSIDER, 1_000_000n)]));
    expect((await verify("DEPOSIT")).status).toBe("UNRELATED");
    expect((await verify("WITHDRAW")).status).toBe("UNRELATED");
    // Someone else's deposit, a deposit into another contract that emits the same events, a withdrawal paid elsewhere.
    client.getTransactionReceipt.mockResolvedValue(deposit(OUTSIDER));
    expect((await verify("DEPOSIT")).status).toBe("UNRELATED");
    client.getTransactionReceipt.mockResolvedValue(deposit(WALLET, 10_000_000n, 8_770_290_000_000n, 8_770_290_000_000n, OTHER_POOL));
    expect((await verify("DEPOSIT")).status).toBe("UNRELATED");
    client.getTransactionReceipt.mockResolvedValue(withdrawal(WALLET, 770_000_000_000n, 877_603n, OUTSIDER));
    expect((await verify("WITHDRAW")).status).toBe("UNRELATED");
  });

  it("calls a deposit unrelated when the mint does not match the event or the expected amount", async () => {
    client.getTransactionReceipt.mockResolvedValue(deposit(WALLET, 10_000_000n, 8_770_290_000_000n, 5n));
    expect((await verify("DEPOSIT")).status).toBe("UNRELATED");
    client.getTransactionReceipt.mockResolvedValue(deposit());
    expect((await verify("DEPOSIT", 9_000_000n)).status).toBe("UNRELATED");
    expect((await verify("DEPOSIT", 10_000_000n)).status).toBe("CONFIRMED");
  });

  it("calls a withdrawal unrelated when the burn or the amount does not match", async () => {
    client.getTransactionReceipt.mockResolvedValue(withdrawal(WALLET, 770_000_000_000n, 877_603n, WALLET, 1n));
    expect((await verify("WITHDRAW")).status).toBe("UNRELATED");
    client.getTransactionReceipt.mockResolvedValue(withdrawal());
    expect((await verify("WITHDRAW", 1n)).status).toBe("UNRELATED");
  });

  it("reports a reverted transaction", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("reverted", []));
    expect(await verify("DEPOSIT")).toEqual({ status: "REVERTED", step: "DEPOSIT", txHash: hash });
  });

  it("reports an unknown hash as pending", async () => {
    client.getTransactionReceipt.mockRejectedValue(notFound());
    expect(await verify("WITHDRAW")).toEqual({ status: "PENDING", step: "WITHDRAW", txHash: hash });
  });

  it("answers an unreachable node as unavailable instead of guessing", async () => {
    client.getTransactionReceipt.mockRejectedValue(new Error("HTTP request failed secret-detail"));
    const error = await verify("WITHDRAW").catch((cause: Error) => cause);
    expect(error).toMatchObject({ code: "USYC_UNAVAILABLE", status: 503 });
    expect((error as Error).message).not.toContain("secret-detail");
  });

  it("refuses to verify while the pool is not deployed", async () => {
    vi.stubEnv("HODD_USYC_POOL_ADDRESS", "");
    expect(await verify("DEPOSIT").catch((cause: Error) => cause)).toMatchObject({ code: "USYC_POOL_NOT_DEPLOYED" });
    expect(client.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
