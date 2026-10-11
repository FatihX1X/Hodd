import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InjectedProvider } from "./connectors";

const fakeGas = vi.hoisted(() => ({ estimate: vi.fn(), price: vi.fn(), send: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({ estimateGas: fakeGas.estimate, getGasPrice: fakeGas.price }),
  createWalletClient: () => ({ sendTransaction: fakeGas.send }),
}));
// Every test gets a fresh connectors module: its EIP-6963 registry would otherwise keep earlier tests' announcements.
let connectInjectedWallet: typeof import("./connectors").connectInjectedWallet;
let WalletPreflightError: typeof import("./preflight").WalletPreflightError;
beforeEach(async () => {
  vi.clearAllMocks(); fakeGas.estimate.mockResolvedValue(21000n); fakeGas.price.mockResolvedValue(20000000000n); fakeGas.send.mockResolvedValue(`0x${"1".repeat(64)}`);
  vi.resetModules(); ({ connectInjectedWallet } = await import("./connectors")); ({ WalletPreflightError } = await import("./preflight"));
}, 30_000);

vi.mock("@circle-fin/adapter-viem-v2", () => ({ createViemAdapterFromProvider: vi.fn(async () => ({})) }));
const stopWallets: Array<() => void> = [];
afterEach(() => { delete window.ethereum; for (const stop of stopWallets.splice(0)) stop(); });
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

const account = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
// A wallet provider connected to one account on Arc Testnet; `request` records every call it receives.
const wallet = (owner: number, flags: Partial<InjectedProvider> = {}) => ({ ...flags, request: vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x4cef52" : method === "eth_signTypedData_v4" ? `0x${"1".repeat(130)}` : [account(owner)]) });
const arc = { chainId: 5_042_002, label: "Arc Testnet", rpc: "https://rpc.testnet.arc.io", nativeSymbol: "USDC", explorerTx: "https://testnet.arcscan.app/tx/" };
// Mimics an EIP-6963 extension: announces now, then re-announces on every request (after `delay` ms, or never when null).
const announce = (rdns: string, provider: InjectedProvider, { now = true, delay = 0 as number | null } = {}) => {
  const send = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: Object.freeze({ uuid: `uuid-${rdns}`, name: rdns, icon: "data:image/svg+xml,<svg/>", rdns }), provider }) }));
  const respond = () => { if (delay) setTimeout(send, delay); else send(); };
  if (delay !== null) { window.addEventListener("eip6963:requestProvider", respond); stopWallets.push(() => window.removeEventListener("eip6963:requestProvider", respond)); }
  if (now) send();
};
const adapterCalls = async () => vi.mocked((await import("@circle-fin/adapter-viem-v2")).createViemAdapterFromProvider).mock.calls;

describe("EIP-6963 wallet discovery", () => {
  it("keeps MetaMask and Rabby apart when Rabby owns window.ethereum", async () => {
    const rabby = wallet(2, { isMetaMask: true, isRabby: true }); const metamask = wallet(1, { isMetaMask: true });
    window.ethereum = rabby; announce("io.rabby", rabby); announce("io.metamask", metamask);
    const chosen = await connectInjectedWallet("METAMASK");
    expect(chosen.provider).toBe(metamask);
    expect(chosen.runtime.connection).toMatchObject({ provider: "INJECTED_METAMASK", label: "MetaMask", address: account(1) });
    expect(metamask.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" }); expect(rabby.request).not.toHaveBeenCalled();
    expect((await adapterCalls())[0][0].provider).toBe(metamask);
    // Gateway signing and cross-chain sends talk to the same MetaMask provider, never to the one owning window.ethereum.
    await chosen.runtime.signGatewayIntent!({ typedData: {}, intent: {} }); await chosen.runtime.sendOnChain!(arc, []);
    expect(metamask.request).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_signTypedData_v4" })); expect(metamask.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(rabby.request).not.toHaveBeenCalled();
    const other = await connectInjectedWallet("RABBY");
    expect(other.provider).toBe(rabby); expect(other.runtime.connection).toMatchObject({ provider: "INJECTED_RABBY", address: account(2) });
  });
  it("finds the announced MetaMask behind Brave Wallet", async () => {
    const brave = wallet(3, { isMetaMask: true, isBraveWallet: true }); const metamask = wallet(1, { isMetaMask: true });
    window.ethereum = brave; announce("com.brave.wallet", brave); announce("io.metamask", metamask);
    const { provider, runtime } = await connectInjectedWallet("METAMASK");
    expect(provider).toBe(metamask); expect(runtime.connection.address).toBe(account(1)); expect(brave.request).not.toHaveBeenCalled();
  });
  it("connects Rabby through its announcement while MetaMask owns window.ethereum", async () => {
    const metamask = wallet(1, { isMetaMask: true }); const rabby = wallet(2, { isMetaMask: true, isRabby: true });
    window.ethereum = metamask; announce("io.rabby", rabby);
    const { provider, runtime } = await connectInjectedWallet("RABBY");
    expect(provider).toBe(rabby); expect(runtime.connection).toMatchObject({ provider: "INJECTED_RABBY", label: "Rabby", address: account(2) });
    expect(metamask.request).not.toHaveBeenCalled();
  });
  it("prefers the announced provider over a window.ethereum that also claims the same wallet", async () => {
    const root = wallet(9, { isMetaMask: true }); const announcedMetaMask = wallet(1, { isMetaMask: true });
    window.ethereum = root; announce("io.metamask", announcedMetaMask);
    const { provider } = await connectInjectedWallet("METAMASK");
    expect(provider).toBe(announcedMetaMask); expect(root.request).not.toHaveBeenCalled();
  });
  it("keeps an announcement that arrived before the user clicked, even if the wallet never answers again", async () => {
    const metamask = wallet(1, { isMetaMask: true });
    announce("io.metamask", metamask, { delay: null });
    expect((await connectInjectedWallet("METAMASK")).provider).toBe(metamask);
  });
  it("waits briefly for a wallet that only answers the connect-time request", async () => {
    const rabby = wallet(2, { isRabby: true });
    announce("io.rabby", rabby, { now: false, delay: 50 });
    expect((await connectInjectedWallet("RABBY")).provider).toBe(rabby);
  });
  it("never treats another wallet's announcement as MetaMask or Rabby", async () => {
    announce("io.metamask.flask", wallet(1, { isMetaMask: true })); announce("com.coinbase.wallet", wallet(2, { isCoinbaseWallet: true }));
    // Announcements without a provider or identity are ignored, not trusted.
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid: "x", name: "MetaMask", icon: "", rdns: "io.metamask" } } }));
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: null }));
    await expect(connectInjectedWallet("METAMASK")).rejects.toThrow("MetaMask was not detected in this browser.");
    await expect(connectInjectedWallet("RABBY")).rejects.toThrow("Rabby was not detected in this browser.");
  });
});

describe("Legacy window.ethereum fallback", () => {
  it.each(["isRabby", "isBraveWallet", "isCoinbaseWallet", "isTrust", "isTrustWallet", "isOkxWallet", "isOKExWallet", "isPhantom"] as const)("does not mistake an %s wallet for MetaMask", async (flag) => {
    const impostor = wallet(3, { isMetaMask: true, [flag]: true }); window.ethereum = impostor;
    await expect(connectInjectedWallet("METAMASK")).rejects.toThrow("MetaMask was not detected in this browser.");
    expect(impostor.request).not.toHaveBeenCalled();
  });
  it("does not offer Brave Wallet as Rabby", async () => {
    const brave = wallet(3, { isMetaMask: true, isBraveWallet: true }); window.ethereum = brave;
    await expect(connectInjectedWallet("RABBY")).rejects.toThrow("Rabby was not detected in this browser.");
    expect(brave.request).not.toHaveBeenCalled();
  });
  it("still picks the real wallet out of a legacy providers list when nothing is announced", async () => {
    const rabby = wallet(2, { isMetaMask: true, isRabby: true }); const brave = wallet(3, { isMetaMask: true, isBraveWallet: true }); const metamask = wallet(1, { isMetaMask: true });
    window.ethereum = { providers: [rabby, brave, metamask], request: vi.fn() };
    expect((await connectInjectedWallet("METAMASK")).provider).toBe(metamask);
    expect((await connectInjectedWallet("RABBY")).provider).toBe(rabby);
    expect(brave.request).not.toHaveBeenCalled();
  });
});
