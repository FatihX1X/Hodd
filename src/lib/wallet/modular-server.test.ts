// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletConnection } from "@/lib/treasury/models";
const fake = vi.hoisted(() => ({ chain: vi.fn(), account: vi.fn(), prepare: vi.fn(), sign: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(), createPublicClient: () => ({ getChainId: fake.chain }) }));
vi.mock("viem/account-abstraction", () => ({ toWebAuthnAccount: () => ({ sign: fake.sign }), createBundlerClient: () => ({ prepareUserOperation: fake.prepare, sendUserOperation: fake.send }) }));
vi.mock("@circle-fin/modular-wallets-core", () => ({ toModularTransport: vi.fn(), toCircleSmartAccount: fake.account }));
vi.mock("@/lib/earn/durable-quotes", () => ({ digest: () => "call" }));
import { quoteModularPayment } from "./modular-server";
import { ARC_GAS_STATION_PAYMASTER } from "./fee-quote";
const wallet = { provider: "CIRCLE_MODULAR", accountType: "MSCA", address: "0x0000000000000000000000000000000000000001", passkey: { id: "public-id", publicKey: `0x04${"1".repeat(128)}` } } as WalletConnection;
const call = { to: "0x3600000000000000000000000000000000000000" as const, data: "0x1234" as const, value: "0" };
const prepared = () => ({ sender: wallet.address, nonce: 0n, callData: "0x5678", factory: "0x0000000000000000000000000000000000000002", factoryData: "0x99", callGasLimit: 40000n, verificationGasLimit: 80000n, preVerificationGas: 20000n, maxFeePerGas: 20000000000n, maxPriorityFeePerGas: 1000000000n, paymaster: ARC_GAS_STATION_PAYMASTER, paymasterData: "0xabcd", paymasterVerificationGasLimit: 10000n, paymasterPostOpGasLimit: 10000n, signature: "0x00" });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_CLIENT_KEY", "mock-public-key"); vi.stubEnv("NEXT_PUBLIC_CLIENT_URL", ""); fake.chain.mockResolvedValue(5042002); fake.account.mockResolvedValue({ address: wallet.address, entryPoint: { version: "0.7" }, encodeCalls: async () => "0x5678" }); fake.prepare.mockResolvedValue(prepared()); });
afterEach(() => vi.unstubAllEnvs());
describe("read-only server passkey quote", () => {
  it("includes deployment, verification and paymaster gas, with verified sponsorship and no server signing", async () => {
    const quote = await quoteModularPayment(wallet, call);
    expect(quote).toMatchObject({ source: "CIRCLE_MSCA", sponsorship: "VERIFIED", gasLimit: "160000", maxNativeFeeWei: "3200000000000000", maxWalletDebit: { minorUnits: "0" }, userOperation: { factoryData: "0x99", verificationGasLimit: "80000", paymasterVerificationGasLimit: "10000", paymasterPostOpGasLimit: "10000" } });
    expect(fake.prepare).toHaveBeenCalledWith({ calls: [{ ...call, value: 0n }], paymaster: true }); expect(fake.sign).not.toHaveBeenCalled(); expect(fake.send).not.toHaveBeenCalled();
  });
  it("never assumes sponsorship, accepts arbitrary paymasters, wrong payloads, missing gas components or a different wallet", async () => {
    for (const value of [{ ...prepared(), paymaster: "0x0000000000000000000000000000000000000003" }, { ...prepared(), callData: "0x1111" }, { ...prepared(), verificationGasLimit: undefined }, { ...prepared(), factoryData: undefined }]) { fake.prepare.mockResolvedValue(value); await expect(quoteModularPayment(wallet, call)).rejects.toThrow(); }
    fake.account.mockResolvedValue({ address: "0x0000000000000000000000000000000000000003" }); await expect(quoteModularPayment(wallet, call)).rejects.toThrow("WALLET_MISMATCH"); expect(fake.send).not.toHaveBeenCalled();
  });
  it("fails closed for missing public configuration, another chain or arbitrary RPC endpoint", async () => {
    expect(await quoteModularPayment({ ...wallet, passkey: undefined }, call)).toBeNull();
    fake.chain.mockResolvedValue(1); await expect(quoteModularPayment(wallet, call)).rejects.toThrow("WRONG_MODULAR_CHAIN");
    vi.stubEnv("NEXT_PUBLIC_CLIENT_URL", "https://other.example/rpc"); await expect(quoteModularPayment(wallet, call)).rejects.toThrow("ENDPOINT_NOT_ALLOWED");
  });
});
