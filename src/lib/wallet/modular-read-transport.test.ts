// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicClient } from "viem";
import { arcTestnet } from "viem/chains";
vi.mock("server-only", () => ({}));
import { modularReadTransport } from "./modular-read-transport";
afterEach(() => vi.unstubAllGlobals());
describe("Node-safe read-only modular transport", () => {
  it("works without window and keeps the fixed Circle endpoint/domain metadata", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ result: "0x4cef52" }) })); vi.stubGlobal("fetch", fetch);
    const client = createPublicClient({ chain: arcTestnet, transport: modularReadTransport("mock-client-key") });
    expect(typeof window).toBe("undefined"); expect(await client.getChainId()).toBe(5042002);
    expect(fetch).toHaveBeenCalledWith("https://modular-sdk.circle.com/v1/rpc/w3s/buidl/arcTestnet", expect.objectContaining({ redirect: "error", headers: expect.objectContaining({ "X-AppInfo": "platform=web;version=1.0.16;uri=localhost" }) }));
  });
  it("rejects writes before any HTTP call and sanitizes provider errors", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ error: { message: "mock-secret-do-not-return" } }) })); vi.stubGlobal("fetch", fetch);
    const transport = modularReadTransport("mock-client-key")({});
    for (const method of ["eth_sendUserOperation", "eth_sendTransaction", "circle_createAddressMapping", "personal_sign"]) await expect(transport.request({ method })).rejects.toThrow("WRITE_FORBIDDEN");
    expect(fetch).not.toHaveBeenCalled(); await expect(transport.request({ method: "eth_chainId" })).rejects.toThrow("INVALID_RESPONSE"); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
