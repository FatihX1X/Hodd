// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chain, fakeArcClient, notFound, OUTSIDER, receipt, redeemed, subscribed, TREASURY, usdcApproval, usdcTransfer, usycTransfer, WALLET, zeroAddress } from "@/test/usyc-chain";

const m = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/gateway", () => ({ get arcClient() { return m.client; } }));
import { verifyUsycTransaction } from "./verify";
import { USYC_TELLER } from "./constants";

let client: ReturnType<typeof fakeArcClient>;
const hash = `0x${"b".repeat(64)}`;
beforeEach(() => { client = fakeArcClient(chain()); m.client = client; });
const verify = (step: "APPROVE" | "SUBSCRIBE" | "REDEEM", amount?: bigint, wallet: string = WALLET) => verifyUsycTransaction({ wallet, step, txHash: hash.toUpperCase().replace("0X", "0x"), amount });

describe("verifyUsycTransaction", () => {
  it("confirms a subscription from the exact USYC mint to the wallet", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usdcTransfer(WALLET, TREASURY, 10_000_000n), usycTransfer(zeroAddress, WALLET, 8_770_290n), subscribed(WALLET, WALLET, 10_000_000n, 8_770_290n)]));
    expect(await verify("SUBSCRIBE", 10_000_000n)).toEqual({ status: "CONFIRMED", step: "SUBSCRIBE", txHash: hash, mintedSharesMinor: "8770290", spentAssetsMinor: "10000000" });
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash });
  });

  it("adds the fee to the amount spent", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usycTransfer(zeroAddress, WALLET, 877_000n), subscribed(WALLET, WALLET, 999_000n, 877_000n, undefined, 1_000n)]));
    expect(await verify("SUBSCRIBE", 1_000_000n)).toMatchObject({ status: "CONFIRMED", spentAssetsMinor: "1000000" });
  });

  it("confirms a redemption from the USYC burn and the USDC paid to the wallet", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usycTransfer(WALLET, zeroAddress, 770_000n), usdcTransfer(TREASURY, WALLET, 877_603n), redeemed(WALLET, WALLET, 877_603n, 770_000n)]));
    expect(await verify("REDEEM", 770_000n)).toEqual({ status: "CONFIRMED", step: "REDEEM", txHash: hash, burnedSharesMinor: "770000", receivedAssetsMinor: "877603" });
  });

  it("confirms an exact approval to the Teller and nothing else", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usdcApproval(WALLET, USYC_TELLER, 5_000_000n)]));
    expect(await verify("APPROVE", 5_000_000n)).toMatchObject({ status: "CONFIRMED", step: "APPROVE" });
    expect(await verify("APPROVE", 6_000_000n)).toMatchObject({ status: "UNRELATED" });
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usdcApproval(WALLET, OUTSIDER, 5_000_000n)]));
    expect(await verify("APPROVE", 5_000_000n)).toMatchObject({ status: "UNRELATED" });
  });

  it("calls a transaction that did something else unrelated", async () => {
    // A plain USDC transfer, a subscription by someone else, a mint to someone else, a redemption that paid someone else.
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usdcTransfer(WALLET, TREASURY, 1_000_000n)]));
    expect((await verify("SUBSCRIBE")).status).toBe("UNRELATED");
    expect((await verify("REDEEM")).status).toBe("UNRELATED");
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usycTransfer(zeroAddress, OUTSIDER, 100n), subscribed(OUTSIDER, OUTSIDER, 100n, 100n)]));
    expect((await verify("SUBSCRIBE")).status).toBe("UNRELATED");
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usycTransfer(WALLET, zeroAddress, 100n), usdcTransfer(TREASURY, OUTSIDER, 114n), redeemed(WALLET, WALLET, 114n, 100n)]));
    expect((await verify("REDEEM")).status).toBe("UNRELATED");
  });

  it("calls a subscription unrelated when the mint does not match the event or the expected amount", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usycTransfer(zeroAddress, WALLET, 5n), subscribed(WALLET, WALLET, 10_000_000n, 8_770_290n)]));
    expect((await verify("SUBSCRIBE")).status).toBe("UNRELATED");
    client.getTransactionReceipt.mockResolvedValue(receipt("success", [usycTransfer(zeroAddress, WALLET, 8_770_290n), subscribed(WALLET, WALLET, 10_000_000n, 8_770_290n)]));
    expect((await verify("SUBSCRIBE", 9_000_000n)).status).toBe("UNRELATED");
    expect((await verify("SUBSCRIBE", 10_000_000n)).status).toBe("CONFIRMED");
  });

  it("reports a reverted transaction", async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt("reverted", []));
    expect(await verify("SUBSCRIBE")).toEqual({ status: "REVERTED", step: "SUBSCRIBE", txHash: hash });
  });

  it("reports an unknown hash as pending", async () => {
    client.getTransactionReceipt.mockRejectedValue(notFound());
    expect(await verify("REDEEM")).toEqual({ status: "PENDING", step: "REDEEM", txHash: hash });
  });

  it("answers an unreachable node as unavailable instead of guessing", async () => {
    client.getTransactionReceipt.mockRejectedValue(new Error("HTTP request failed secret-detail"));
    const error = await verify("REDEEM").catch((cause: Error) => cause);
    expect(error).toMatchObject({ code: "USYC_UNAVAILABLE", status: 503 });
    expect((error as Error).message).not.toContain("secret-detail");
  });
});
