import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectInjectedWallet } from "./connectors";
import { WalletPreflightError } from "./preflight";

const fakeGas = vi.hoisted(() => ({ estimate: vi.fn(), price: vi.fn(), send: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({ estimateGas: fakeGas.estimate, getGasPrice: fakeGas.price }),
  createWalletClient: () => ({ sendTransaction: fakeGas.send }),
}));
beforeEach(() => { vi.clearAllMocks(); fakeGas.estimate.mockResolvedValue(21000n); fakeGas.price.mockResolvedValue(20000000000n); fakeGas.send.mockResolvedValue(`0x${"1".repeat(64)}`); });

vi.mock("@circle-fin/adapter-viem-v2", () => ({ createViemAdapterFromProvider: vi.fn(async () => ({})) }));
afterEach(() => { delete window.ethereum; });
describe("Browser wallet connections", () => {
  it("never reaches the wallet signing API when gas preflight fails", async () => {
    window.ethereum = { isRabby: true, request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0x4cef52" : ["0x0000000000000000000000000000000000000001"]) };
    const { runtime } = await connectInjectedWallet("RABBY");
    fakeGas.estimate.mockRejectedValueOnce(new Error("secret-RPC-context"));
    await expect(runtime.sendCalls!([{ to: runtime.connection.address as `0x${string}` }], "1000000000000000")).rejects.toBeInstanceOf(WalletPreflightError);
    expect(fakeGas.send).not.toHaveBeenCalled();
  });
  it("reports a wallet account read failure without sending a transaction", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => { if (method === "eth_chainId") return "0x4cef52"; if (method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000001"]; throw new Error("private provider context"); });
    window.ethereum = { isRabby: true, request };
    const { runtime } = await connectInjectedWallet("RABBY");
    await expect(runtime.sendCalls!([{ to: runtime.connection.address as `0x${string}` }], "600000000000000", undefined, undefined, { gasLimit: "30000", gasPriceWei: "20000000000" })).rejects.toMatchObject({ code: "WALLET_PROVIDER_UNAVAILABLE" });
    expect(fakeGas.send).not.toHaveBeenCalled();
  });
  it("does not classify errors after the signing boundary as preflight failures", async () => {
    window.ethereum = { isRabby: true, request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0x4cef52" : ["0x0000000000000000000000000000000000000001"]) };
    const { runtime } = await connectInjectedWallet("RABBY"); const uncertain = new Error("Lost wallet response");
    fakeGas.send.mockRejectedValueOnce(uncertain);
    await expect(runtime.sendCalls!([{ to: runtime.connection.address as `0x${string}` }], "1000000000000000")).rejects.toBe(uncertain);
    expect(fakeGas.send).toHaveBeenCalledTimes(1);
  });
  it("uses the bound Earn ceiling without a browser RPC and preserves the exact maximum fee", async () => {
    window.ethereum = { isRabby: true, request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0x4cef52" : ["0x0000000000000000000000000000000000000001"]) };
    const { runtime } = await connectInjectedWallet("RABBY");
    fakeGas.estimate.mockRejectedValue(new Error("Browser RPC unavailable"));
    const ceiling = { gasLimit: "30000", gasPriceWei: "20000000000" };
    await runtime.sendCalls!([{ to: runtime.connection.address as `0x${string}` }], "600000000000000", undefined, undefined, ceiling);
    expect(fakeGas.estimate).not.toHaveBeenCalled(); expect(fakeGas.price).not.toHaveBeenCalled();
    expect(fakeGas.send).toHaveBeenCalledWith(expect.objectContaining({ gas: 30000n, gasPrice: 20000000000n }));
    fakeGas.send.mockClear();
    await expect(runtime.sendCalls!([{ to: runtime.connection.address as `0x${string}` }], "599999999999999", undefined, undefined, ceiling)).rejects.toMatchObject({ code: "FEE_RESERVE_EXCEEDED" });
    expect(fakeGas.send).not.toHaveBeenCalled();
  });
  it("uses only the provider selected by the user", async () => {
    const meta = { isMetaMask: true, request: vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x4cef52" : ["0x0000000000000000000000000000000000000001"]) };
    const rabby = { isRabby: true, request: vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x4cef52" : ["0x0000000000000000000000000000000000000002"]) };
    window.ethereum = { providers: [meta, rabby], request: vi.fn() };
    const connected = await connectInjectedWallet("RABBY");
    expect(connected.runtime.connection).toMatchObject({ provider: "INJECTED_RABBY", custody: "USER_CONTROLLED", address: "0x0000000000000000000000000000000000000002" });
    expect(meta.request).not.toHaveBeenCalled();
  });
  it("honors a declined network switch without opening another request", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => { if (method === "eth_chainId") return "0x1"; throw { code: 4001 }; });
    window.ethereum = { isMetaMask: true, request };
    await expect(connectInjectedWallet("METAMASK")).rejects.toEqual({ code: 4001 });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_addEthereumChain" }));
  });
  it("invalidates signing when the account or network changes", async () => {
    let chain = "0x4cef52"; let address = "0x0000000000000000000000000000000000000001";
    window.ethereum = { isMetaMask: true, request: vi.fn(async ({ method }) => method === "eth_chainId" ? chain : [address]) };
    const { runtime } = await connectInjectedWallet("METAMASK");
    const calls = [{ to: runtime.connection.address as `0x${string}` }];
    address = "0x0000000000000000000000000000000000000002";
    await expect(runtime.sendCalls!(calls, "1")).rejects.toThrow("changed");
    address = runtime.connection.address; chain = "0x1";
    await expect(runtime.sendCalls!(calls, "1")).rejects.toThrow("changed");
  });
});
