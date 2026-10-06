import { afterEach, describe, expect, it, vi } from "vitest";
import { connectCircleEmbeddedWallet, connectModularWallet } from "./connectors";
import { clearActiveWalletRuntime, getActiveWalletRuntime, setActiveWalletRuntime } from "./runtime";
import { ARC_GAS_STATION_PAYMASTER, walletFeeQuoteSchema } from "./fee-quote";

const fake = vi.hoisted(() => ({ hash: `0x${"1".repeat(64)}`, prepare: vi.fn(), submit: vi.fn(), receipt: vi.fn(), challenge: vi.fn(), chain: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(), createPublicClient: vi.fn(() => ({ getChainId: fake.chain })) }));
vi.mock("viem/account-abstraction", () => ({ toWebAuthnAccount: vi.fn(() => ({})), createBundlerClient: vi.fn(() => ({ prepareUserOperation: fake.prepare, sendUserOperation: fake.submit, waitForUserOperationReceipt: fake.receipt })) }));
vi.mock("@circle-fin/modular-wallets-core", () => ({ WebAuthnMode: { Register: "register", Login: "login" }, toCircleSmartAccount: vi.fn(async () => ({ address: "0x0000000000000000000000000000000000000001", encodeCalls: async () => "0x1234", getNonce: async () => 0n })), toWebAuthnCredential: vi.fn(async () => ({ id: "public-id", publicKey: `0x04${"1".repeat(128)}` })), toModularTransport: vi.fn(() => ({})), toPasskeyTransport: vi.fn(() => ({})) }));
vi.mock("@circle-fin/w3s-pw-web-sdk", () => ({ W3SSdk: class { getDeviceId() { return Promise.resolve("test-device"); } setAuthentication() {} execute(id: string, callback: (error?: unknown) => void) { fake.challenge(id); callback(); } } }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); clearActiveWalletRuntime(); });
const call = { to: "0x0000000000000000000000000000000000000002" as const, data: "0x1234" as const };
function passkeySetup() {
  vi.stubEnv("NEXT_PUBLIC_CLIENT_KEY", "test-client-configuration"); fake.chain.mockResolvedValue(5_042_002); fake.prepare.mockResolvedValue({ paymaster: ARC_GAS_STATION_PAYMASTER, signature: "0x00" }); fake.submit.mockResolvedValue(fake.hash); fake.receipt.mockResolvedValue({ success: true, receipt: { status: "success", transactionHash: fake.hash } });
}
describe("user-owned signing adapters", () => {
  it("separates passkey UserOperation submission from its transaction receipt", async () => {
    passkeySetup(); const runtime = await connectModularWallet("LOGIN"); const onUserOperation = vi.fn();
    expect(await runtime.sendCalls!([call], "1000000000000000000", onUserOperation)).toBe(fake.hash);
    expect(fake.prepare).toHaveBeenCalledWith(expect.objectContaining({ paymaster: true })); expect(onUserOperation).toHaveBeenCalledWith(fake.hash);
    expect(fake.submit).toHaveBeenCalledWith(expect.objectContaining({ signature: undefined }));
  });
  it("never falls back to unsponsored passkey execution", async () => {
    passkeySetup(); fake.prepare.mockResolvedValue({ paymaster: undefined }); const runtime = await connectModularWallet("REGISTER");
    await expect(runtime.sendCalls!([call], "1")).rejects.toThrow("sponsorship"); expect(fake.submit).not.toHaveBeenCalled();
  });
  it("blocks wrong network and reports cancelled passkey approvals", async () => {
    passkeySetup(); const runtime = await connectModularWallet("LOGIN"); fake.chain.mockResolvedValue(1);
    await expect(runtime.sendCalls!([call], "1")).rejects.toThrow("not Arc"); expect(fake.submit).not.toHaveBeenCalled();
    fake.chain.mockResolvedValue(5_042_002); fake.submit.mockRejectedValueOnce({ code: 4001 });
    await expect(runtime.sendCalls!([call], "1")).rejects.toEqual({ code: 4001 });
  });
  it("does not treat a failed UserOperation as a successful receipt", async () => {
    passkeySetup(); fake.receipt.mockResolvedValue({ success: false, receipt: { status: "success", transactionHash: fake.hash } });
    const runtime = await connectModularWallet("LOGIN"); await expect(runtime.sendCalls!([call], "1")).rejects.toThrow("did not succeed");
  });
  it("signs the server-bound sponsored operation without another estimate and never submits a stub signature", async () => {
    passkeySetup(); const runtime = await connectModularWallet("LOGIN"); const now = Date.now();
    const op = { sender: runtime.connection.address, nonce: "0", callData: "0x1234", callGasLimit: "10000", verificationGasLimit: "10000", preVerificationGas: "10000", maxFeePerGas: "20000000000", maxPriorityFeePerGas: "1000000000", paymaster: ARC_GAS_STATION_PAYMASTER, paymasterData: "0xabcd", paymasterVerificationGasLimit: "10000", paymasterPostOpGasLimit: "10000" };
    const quote = walletFeeQuoteSchema.parse({ provider: "CIRCLE_MODULAR", walletAddress: runtime.connection.address, source: "CIRCLE_MSCA", chainId: 5042002, operationDigest: "call", observedAt: new Date(now).toISOString(), expiresAt: new Date(now+300000).toISOString(), sponsorship: "VERIFIED", gasLimit: "50000", maxFeePerGasWei: op.maxFeePerGas, priorityFeePerGasWei: op.maxPriorityFeePerGas, maxNativeFeeWei: "1000000000000000", maxWalletDebit: { currency: "USDC", decimals: 6, minorUnits: "0" }, userOperation: op });
    const callback = vi.fn(async () => undefined);
    await runtime.sendCalls!([call], quote.maxNativeFeeWei, callback, quote);
    expect(fake.prepare).not.toHaveBeenCalled(); expect(fake.submit).toHaveBeenCalledWith(expect.objectContaining({ nonce: 0n, callGasLimit: 10000n, signature: undefined })); expect(callback).toHaveBeenCalledWith(fake.hash);
    await expect(runtime.sendCalls!([call], "1", callback, quote)).rejects.toThrow("changed or expired");
    await expect(runtime.sendCalls!([call], quote.maxNativeFeeWei, callback, { ...quote, expiresAt: new Date(now-1).toISOString() })).rejects.toThrow();
  });
  it("keeps PIN approval session data in its closure rather than the workspace", async () => {
    vi.stubEnv("NEXT_PUBLIC_CIRCLE_APP_ID", "test-app");
    const responses = [{ status: "READY", userToken: "test-session", encryptionKey: "test-encryption" }, { status: "EXISTS" }, { status: "READY", wallets: [{ id: "test-wallet", address: "0x0000000000000000000000000000000000000001", blockchain: "ARC-TESTNET", accountType: "SCA" }] }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => responses.shift() })));
    const runtime = await connectCircleEmbeddedWallet(); await runtime.approveChallenge!("test-challenge");
    expect(fake.challenge).toHaveBeenCalledWith("test-challenge"); expect(JSON.stringify(runtime.connection)).not.toContain("test-session"); expect(JSON.stringify(runtime.connection)).not.toContain("test-encryption");
  });
  it("invalidates expired, logged-out and reconnected runtime signers", async () => {
    passkeySetup(); const runtime = await connectModularWallet("LOGIN"); setActiveWalletRuntime({ ...runtime, expiresAt: Date.now() - 1 }); expect(getActiveWalletRuntime()).toBeNull();
    setActiveWalletRuntime(runtime); clearActiveWalletRuntime(); expect(getActiveWalletRuntime()).toBeNull();
    const reconnected = await connectModularWallet("LOGIN"); setActiveWalletRuntime(reconnected); expect(getActiveWalletRuntime()).toBe(reconnected);
  });
});
