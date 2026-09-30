import { afterEach, describe, expect, it, vi } from "vitest";
import { connectInjectedWallet } from "./connectors";

vi.mock("@circle-fin/adapter-viem-v2", () => ({ createViemAdapterFromProvider: vi.fn(async () => ({})) }));
afterEach(() => { delete window.ethereum; });
describe("Browser wallet connections", () => {
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
});
