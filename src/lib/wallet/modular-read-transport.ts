import "server-only";
import { randomUUID } from "node:crypto";
import { custom } from "viem";

// Only the read/estimation methods required by the installed Circle MSCA SDK.
// No signing, UserOperation submission, recovery or address-mapping writes.
const methods = new Set(["eth_chainId", "eth_getBalance", "eth_blockNumber", "eth_call", "eth_getBlockByNumber", "eth_maxPriorityFeePerGas", "eth_gasPrice", "eth_getCode", "eth_supportedEntryPoints", "eth_estimateUserOperationGas", "eth_getUserOperationByHash", "eth_getUserOperationReceipt", "circle_getAddress", "circle_getAddressMapping", "circle_getUserOperationGasPrice", "pm_getPaymasterData", "pm_getPaymasterStubData"]);

export function modularReadTransport(clientKey: string, appHost = "localhost") {
  return custom({ request: async ({ method, params }) => {
    if (!methods.has(method)) throw new Error("MODULAR_SERVER_WRITE_FORBIDDEN");
    const response = await fetch("https://modular-sdk.circle.com/v1/rpc/w3s/buidl/arcTestnet", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      // Same metadata format as SDK 1.0.16, but without referencing window.
      // The host matches the client key's allowed domain (the live app, or localhost).
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clientKey}`, "X-AppInfo": `platform=web;version=1.0.16;uri=${appHost}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params: params ?? [] }),
    });
    if (!response.ok) throw new Error("MODULAR_SERVER_RPC_UNAVAILABLE");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || "error" in data || !("result" in data)) throw new Error("MODULAR_SERVER_RPC_INVALID_RESPONSE");
    return data.result;
  } }, { key: "Modular wallets transport", retryCount: 0 });
}
