// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ estimate: vi.fn(), gas: vi.fn(), price: vi.fn(), chain: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: { getChainId: fake.chain, estimateGas: fake.gas, getGasPrice: fake.price } }));
vi.mock("@/lib/circle/user-wallet-server", () => ({ circleUserWalletClient: () => ({ estimateContractExecutionFee: fake.estimate }) }));
vi.mock("@/lib/earn/durable-quotes", () => ({ digest: () => "call-digest" }));
import { quotePaymentFees } from "./fees";
import type { PaymentContext } from "./server";
const context = (provider: string, accountType: string) => ({ userToken: "mock-session", wallet: { address: "0x0000000000000000000000000000000000000001", walletId: "public-wallet-id", provider, accountType } }) as PaymentContext;
const call = { to: "0x3600000000000000000000000000000000000000" as const, data: "0x1234" as const, value: "0" };
beforeEach(() => { vi.clearAllMocks(); fake.chain.mockResolvedValue(5042002); fake.gas.mockResolvedValue(21000n); fake.price.mockResolvedValue(20000000000n); fake.estimate.mockResolvedValue({ data: { high: { gasLimit: "100000", maxFee: "20.0000000001", priorityFee: "1", l1Fee: "0" } } }); });
describe("server payment fee estimates", () => {
  it("uses the official UCW estimate, not EOA estimation, and preserves exact fee rounding", async () => {
    const quote = await quotePaymentFees(context("CIRCLE_USER_CONTROLLED", "SCA"), call);
    expect(fake.gas).not.toHaveBeenCalled();
    expect(fake.estimate).toHaveBeenCalledWith({ userToken: "mock-session", source: { walletId: "public-wallet-id" }, contractAddress: call.to, callData: call.data });
    expect(quote).toMatchObject({ source: "CIRCLE_UCW", sponsorship: "NOT_ASSUMED", gasLimit: "200000", maxFeePerGasWei: "40000000002", maxNativeFeeWei: "8000000000400000", maxWalletDebit: { minorUnits: "8001" } });
  });
  it("estimates only actual EOA providers via Arc and cannot silently estimate passkeys as EOA", async () => {
    expect(await quotePaymentFees(context("INJECTED_RABBY", "EOA"), call)).toMatchObject({ source: "ARC_EOA", maxWalletDebit: { minorUnits: "1680" } });
    fake.gas.mockClear(); expect(await quotePaymentFees(context("CIRCLE_MODULAR", "MSCA"), call)).toBeNull(); expect(fake.gas).not.toHaveBeenCalled();
  });
  it("fails closed for missing fees, unexpected extra charges, absent session and wrong chain", async () => {
    const ctx = context("CIRCLE_USER_CONTROLLED", "SCA");
    fake.estimate.mockResolvedValue({ data: {} }); await expect(quotePaymentFees(ctx, call)).rejects.toThrow("UNAVAILABLE");
    fake.estimate.mockResolvedValue({ data: { high: { gasLimit: "1", maxFee: "20", priorityFee: "1", l1Fee: "0.1" } } }); await expect(quotePaymentFees(ctx, call)).rejects.toThrow("ADDITIONAL_FEE");
    await expect(quotePaymentFees({ ...ctx, userToken: null }, call)).rejects.toThrow("SESSION_REQUIRED");
    fake.chain.mockResolvedValue(1); await expect(quotePaymentFees(ctx, call)).rejects.toThrow("WRONG_FEE_CHAIN");
  });
});
