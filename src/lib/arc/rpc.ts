import { ARC_TESTNET_RPC_URL } from "./constants";

/** One Arc Testnet RPC for every server read and receipt check. https only. */
export function arcRpcUrl(value = process.env.ARC_TESTNET_RPC_URL) {
  const configured = value?.trim();
  if (!configured) return ARC_TESTNET_RPC_URL;
  try { if (new URL(configured).protocol === "https:") return configured; } catch { /* fall back below */ }
  return ARC_TESTNET_RPC_URL;
}
