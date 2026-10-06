// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import type { PaymentContext } from "@/lib/payments/server";
const fake = vi.hoisted(() => ({ rows: [] as unknown[], receipts: new Map(), chain: vi.fn(), query: vi.fn(), insert: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./gateway", () => ({ arcClient: { getChainId: fake.chain, getTransactionReceipt: async ({ hash }: { hash: string }) => { const receipt = fake.receipts.get(hash); if (!receipt) throw new Error("missing"); return receipt; } } }));
vi.mock("@/lib/payments/admin", () => ({ paymentAdmin: () => ({ from: () => ({ insert: fake.insert }) }) }));
import { hasVerifiedEarnProvider } from "./provider-evidence";
const wallet = { provider: "INJECTED_METAMASK" as const, accountType: "EOA" as const, custody: "USER_CONTROLLED" as const, chain: "ARC-TESTNET" as const, chainId: 5042002 as const, address: "0x0000000000000000000000000000000000000001" as const, label: "Smoke", connectedAt: "2026-10-06T00:00:00Z" };
const vault = "0xaabbef1d3971c710276ed41ec791bbe14cdb8e88";
const abi = parseAbi(["event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)", "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)"]);
const money = (minorUnits: string) => ({ currency: "USDC", decimals: 6, minorUnits });
function row(operation: string, block: number, amount: string) {
  const id = randomUUID(); const hash = `0x${block.toString(16).padStart(64, "0")}`;
  const quote = { quoteId: id, operation, walletAddress: wallet.address, vaultAddress: vault, vaultName: "Test", amount: money(amount), expectedShares: null, sharesToRedeem: null, maxWithdrawable: money(amount), fees: money("1000"), gasFees: [], warnings: [], policy: { status: "PASS", label: "Policy", reason: "Checked" }, expiresAt: "2026-10-06T00:05:00Z", requiresWarningAcknowledgement: false };
  const residualPosition = { walletAddress: wallet.address, vaultAddress: vault, vaultName: "Test", currentBalance: money("0"), maxWithdrawable: money("0"), redeemable: money("0"), liquidityStatus: "READY", shares: "0", apyBps: 0, pnl: { status: "UNAVAILABLE", reason: "No principal history" }, observedAt: "2026-10-06T00:00:00Z" };
  const result = { executionId: id, operation, status: "COMPLETE", txHash: hash, explorerUrl: `https://testnet.arcscan.app/tx/${hash}`, vaultAddress: vault, amount: money(amount), residualPosition };
  fake.receipts.set(hash, { status: "success", blockNumber: BigInt(block), logs: [{ address: vault, topics: operation === "DEPOSIT" ? encodeEventTopics({ abi, eventName: "Deposit", args: { sender: wallet.address, owner: wallet.address } }) : encodeEventTopics({ abi, eventName: "Withdraw", args: { sender: wallet.address, owner: wallet.address, receiver: wallet.address } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(amount), 100n]) }] });
  return { id, user_id: "11111111-1111-4111-8111-111111111111", wallet, quote, result, started_block: String(block-1), verified_block: String(block), sdk_versions: { appKit: "1.15.3", circleWalletAdapter: "1.8.0", modularWallet: "1.0.16", userControlledWallet: "10.8.1" } };
}
const context = { wallet, userId: "11111111-1111-4111-8111-111111111111", client: { from: fake.query } } as unknown as PaymentContext;
beforeEach(() => {
  vi.clearAllMocks(); fake.rows = []; fake.receipts.clear(); fake.chain.mockResolvedValue(5042002);
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn(async () => ({ data: fake.rows, error: null })) };
  fake.query.mockReturnValue(query);
});
describe("durable provider receipt readiness", () => {
  it("requires actual matching, ordered deposit, partial withdrawal and complete redemption receipts", async () => {
    const deposit = row("DEPOSIT", 11, "1000000"); const withdrawal = row("WITHDRAW", 12, "500000"); const redeem = row("REDEEM_ALL", 13, "500000");
    fake.rows = [deposit, withdrawal]; expect(await hasVerifiedEarnProvider(context)).toBe(false);
    fake.rows.push(redeem); expect(await hasVerifiedEarnProvider(context)).toBe(true);
    fake.receipts.delete(redeem.result.txHash); expect(await hasVerifiedEarnProvider(context)).toBe(false);
    expect(fake.query).toHaveBeenCalledWith("earn_provider_evidence");
    const query = fake.query.mock.results[0].value; expect(query.eq).toHaveBeenCalledWith("user_id", context.userId); expect(query.eq).toHaveBeenCalledWith("wallet_address", wallet.address);
  });
  it("cannot use manual flags, dummy hashes, a different wallet/provider, residual shares or the wrong chain", async () => {
    const deposit = row("DEPOSIT", 11, "1000000"); const withdrawal = row("WITHDRAW", 12, "500000"); const redeem = row("REDEEM_ALL", 13, "500000");
    fake.rows = [{ provider: "INJECTED_METAMASK", verified: true }]; expect(await hasVerifiedEarnProvider(context)).toBe(false);
    fake.rows = [deposit, withdrawal, { ...redeem, wallet: { ...wallet, provider: "INJECTED_RABBY" } }]; expect(await hasVerifiedEarnProvider(context)).toBe(false);
    fake.rows = [deposit, withdrawal, { ...redeem, result: { ...redeem.result, residualPosition: { ...redeem.result.residualPosition, shares: "0.000001" } } }]; expect(await hasVerifiedEarnProvider(context)).toBe(false);
    fake.rows = [deposit, withdrawal, redeem]; fake.chain.mockResolvedValue(1); expect(await hasVerifiedEarnProvider(context)).toBe(false);
  });
});
