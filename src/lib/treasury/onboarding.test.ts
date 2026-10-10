import { describe, expect, it } from "vitest";
import { onboardingStates } from "./onboarding";
import { createLiveStarterWorkspace } from "./starter";
import { sampleWorkspace } from "@/test/fixtures";
import type { TreasuryWorkspace, WalletReadState } from "./models";
import type { EarnPortfolioResponse } from "@/lib/earn/models";

const address = "0x0000000000000000000000000000000000000001";
const now = "2026-10-09T12:00:00.000Z";
const connected: TreasuryWorkspace = { ...createLiveStarterWorkspace(now), treasuryMode: "ARC_TESTNET_WALLET", walletConnection: { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address, label: "My wallet", connectedAt: now } };
const balance: Extract<WalletReadState, { status: "READY" }> = { status: "READY", snapshot: { address, chain: "ARC-TESTNET", chainId: 5042002, balance: { currency: "USDC", minorUnits: "1000000", decimals: 6 }, blockNumber: "1", observedAt: now } };
const portfolio: EarnPortfolioResponse = { status: "READY", observedAt: now, integration: { discovery: "READY", positionAccess: "READY", execution: "READ_ONLY", configuredWalletAddress: address, message: "Live data" }, vaults: [], positions: [{ walletAddress: address, vaultAddress: address, vaultName: "Morpho", currentBalance: { currency: "USDC", minorUnits: "1000000", decimals: 6 }, maxWithdrawable: { currency: "USDC", minorUnits: "1000000", decimals: 6 }, redeemable: { currency: "USDC", minorUnits: "1000000", decimals: 6 }, liquidityStatus: "READY", shares: "1", apyBps: 400, pnl: { status: "PENDING" }, observedAt: now }] };

describe("onboarding from real state", () => {
  it("starts with all steps pending for a signed-out visitor", () => {
    expect(onboardingStates(false, createLiveStarterWorkspace(now), { status: "IDLE" })).toEqual({ signedIn: false, connected: false, funded: false, billAdded: false, deposited: false });
  });
  it("advances sign-in and connection independently, never using fixture balances or bills", () => {
    expect(onboardingStates(true, sampleWorkspace, { status: "IDLE" })).toEqual({ signedIn: true, connected: false, funded: false, billAdded: false, deposited: false });
    expect(onboardingStates(true, connected, { status: "LOADING" })).toMatchObject({ connected: true, funded: false });
  });
  it("requires a fresh balance for the connected wallet", () => {
    expect(onboardingStates(true, connected, balance).funded).toBe(true);
    expect(onboardingStates(true, connected, { status: "ERROR", code: "RPC_UNAVAILABLE", message: "Unavailable", staleSnapshot: balance.snapshot }).funded).toBe(false);
    expect(onboardingStates(true, connected, { status: "READY", snapshot: { ...balance.snapshot, address: "0x0000000000000000000000000000000000000002" } }).funded).toBe(false);
  });
  it("marks completion with a user bill and a verified Morpho position", () => {
    const workspace = { ...connected, obligations: [{ ...sampleWorkspace.obligations[0], id: "my-bill" }] };
    expect(Object.values(onboardingStates(true, workspace, balance, portfolio)).every(Boolean)).toBe(true);
    expect(onboardingStates(true, workspace, balance, { ...portfolio, integration: { ...portfolio.integration, configuredWalletAddress: "0x0000000000000000000000000000000000000002" } }).deposited).toBe(false);
    expect(onboardingStates(true, workspace, balance, { ...portfolio, positions: [] }).deposited).toBe(false);
  });
});
