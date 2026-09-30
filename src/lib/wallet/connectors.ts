"use client";

import { createPublicClient, type Transport } from "viem";
import { arcTestnet } from "viem/chains";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { getAddress } from "viem";
import type { WalletConnection } from "@/lib/treasury/models";
import type { ActiveWalletRuntime } from "./runtime";

export interface InjectedProvider {
  isMetaMask?: boolean; isRabby?: boolean; providers?: InjectedProvider[];
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global { interface Window { ethereum?: InjectedProvider } }

const ARC_CHAIN_HEX = "0x4cef52";
const connection = (provider: WalletConnection["provider"], address: string, label: string, accountType: WalletConnection["accountType"], walletId?: string): WalletConnection => ({ provider, custody: "USER_CONTROLLED", accountType, walletId, chain: "ARC-TESTNET", chainId: 5_042_002, address: getAddress(address), label, connectedAt: new Date().toISOString() });

function injectedProvider(kind: "METAMASK" | "RABBY") {
  const root = window.ethereum; const providers = root?.providers?.length ? root.providers : root ? [root] : [];
  return providers.find((item) => kind === "RABBY" ? item.isRabby : item.isMetaMask && !item.isRabby) ?? null;
}

async function ensureArcTestnet(provider: InjectedProvider) {
  const chain = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (chain === ARC_CHAIN_HEX) return;
  try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] }); }
  catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.io"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
  }
  if (String(await provider.request({ method: "eth_chainId" })).toLowerCase() !== ARC_CHAIN_HEX) throw new Error("Switch your wallet to Arc Testnet.");
}

export async function connectInjectedWallet(kind: "METAMASK" | "RABBY"): Promise<{ runtime: ActiveWalletRuntime; provider: InjectedProvider }> {
  const provider = injectedProvider(kind);
  if (!provider) throw new Error(`${kind === "RABBY" ? "Rabby" : "MetaMask"} was not detected in this browser.`);
  await ensureArcTestnet(provider);
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("The wallet did not return an account.");
  const walletConnection = connection(kind === "RABBY" ? "INJECTED_RABBY" : "INJECTED_METAMASK", accounts[0], kind === "RABBY" ? "Rabby" : "MetaMask", "EOA");
  const adapter = await createViemAdapterFromProvider({
    provider: provider as Parameters<typeof createViemAdapterFromProvider>[0]["provider"],
    capabilities: { addressContext: "user-controlled" },
  });
  return { runtime: { connection: walletConnection, adapter }, provider };
}

export async function connectModularWallet(mode: "REGISTER" | "LOGIN"): Promise<ActiveWalletRuntime> {
  const clientKey = process.env.NEXT_PUBLIC_CLIENT_KEY?.trim();
  const clientUrl = process.env.NEXT_PUBLIC_CLIENT_URL?.trim() || "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";
  if (!clientKey) throw new Error("Circle Modular Wallet client key is not configured.");
  const { WebAuthnMode, toCircleSmartAccount, toModularTransport, toPasskeyTransport, toWebAuthnCredential } = await import("@circle-fin/modular-wallets-core");
  const credential = await toWebAuthnCredential(mode === "REGISTER"
    ? { transport: toPasskeyTransport(clientUrl, clientKey), mode: WebAuthnMode.Register, username: `hodd-${crypto.randomUUID()}` }
    : { transport: toPasskeyTransport(clientUrl, clientKey), mode: WebAuthnMode.Login });
  const client = createPublicClient({ chain: arcTestnet, transport: toModularTransport(`${clientUrl}/arcTestnet`, clientKey) as unknown as Transport });
  // modular-wallets-core currently resolves its own compatible viem patch version.
  // The runtime objects are compatible even though the duplicated type identities are not.
  const account = await toCircleSmartAccount({ client: client as unknown as Parameters<typeof toCircleSmartAccount>[0]["client"], owner: toWebAuthnAccount({ credential }), name: "Hodd Treasury" });
  return { connection: connection("CIRCLE_MODULAR", account.address, "Circle Passkey", "MSCA"), adapter: null };
}

type CircleSession = { status: "READY"; userToken: string; encryptionKey: string } | { status: "ERROR"; message: string };
type CircleWallet = { id: string; address: string; blockchain: string; accountType: string };

export async function connectCircleEmbeddedWallet(onProgress?: (message: string) => void): Promise<ActiveWalletRuntime> {
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim();
  if (!appId) throw new Error("Circle User-Controlled Wallet App ID is not configured.");
  onProgress?.("Creating a user-controlled wallet session…");
  const sessionResponse = await fetch("/api/wallet/circle/session", { method: "POST", headers: { "Content-Type": "application/json" } });
  const session = await sessionResponse.json() as CircleSession;
  if (session.status !== "READY") throw new Error(session.message);
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  const sdk = new W3SSdk({ appSettings: { appId } });
  await sdk.getDeviceId();
  const approve = (challengeId: string) => new Promise<void>((resolve, reject) => {
    sdk.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey });
    sdk.execute(challengeId, (error) => error ? reject(error) : resolve());
  });
  const initializeResponse = await fetch("/api/wallet/circle/initialize", { method: "POST", headers: { "Content-Type": "application/json" } });
  const initialize = await initializeResponse.json() as { status: "CHALLENGE" | "EXISTS" | "ERROR"; challengeId?: string; message?: string };
  if (initialize.status === "ERROR") throw new Error(initialize.message || "The embedded wallet could not be initialized.");
  if (initialize.status === "CHALLENGE" && initialize.challengeId) { onProgress?.("Approve PIN setup and wallet creation in Circle’s secure dialog…"); await approve(initialize.challengeId); }
  onProgress?.("Loading the Arc Testnet wallet…");
  const walletsResponse = await fetch("/api/wallet/circle/wallets", { cache: "no-store" });
  const walletsData = await walletsResponse.json() as { status: "READY" | "ERROR"; wallets?: CircleWallet[]; message?: string };
  if (walletsData.status !== "READY") throw new Error(walletsData.message || "The embedded wallet could not be loaded.");
  const wallet = walletsData.wallets?.find((item) => item.blockchain === "ARC-TESTNET" && item.accountType === "SCA");
  if (!wallet) throw new Error("No Arc Testnet embedded wallet was found.");
  const walletConnection = connection("CIRCLE_USER_CONTROLLED", wallet.address, "Circle Embedded", "SCA", wallet.id);
  // Circle's UCW adapter is server-only. Never import it into the browser bundle.
  // The PIN wallet connects for public reads; execution awaits a verified server challenge flow.
  return { connection: walletConnection, adapter: null };
}
