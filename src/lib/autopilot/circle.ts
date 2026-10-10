import "server-only";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
export function agentCredentials() {
  const apiKey = process.env.CIRCLE_API_KEY?.trim(), entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
  if (!apiKey?.startsWith("TEST") || !entitySecret || !/^[a-fA-F0-9]{64}$/.test(entitySecret)) throw new Error("AGENT_TESTNET_CREDENTIALS_REQUIRED");
  return {apiKey, entitySecret};
}
export const agentCircle = () => initiateDeveloperControlledWalletsClient(agentCredentials());
// Earn Kit quote adapter and its underlying server signer share the same Circle wallet.
export const agentAdapter = () => createCircleWalletsAdapter(agentCredentials());
