// @vitest-environment node
// Opt-in LIVE check of the one-tap Gateway move with the dev test signer on Arc Testnet: when the Gateway balance is
// short, sign the burn intent, sign an exact USDC permit, deposit with ONE transaction (depositWithPermit), wait for
// Gateway to credit it, submit the same signed intent, and verify the Arc mint to the signer itself.
// Sends real testnet transactions (a few tenths of a USDC plus fees).
// Run: HODD_GATEWAY_MOVE_LIVE=1 corepack pnpm exec vitest run src/lib/gateway/move.live.test.ts --silent=false
import { readFileSync } from "node:fs";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const live = process.env.HODD_GATEWAY_MOVE_LIVE === "1";
if (live) {
  for (const file of [".env.local", ".env.development.local"]) {
    for (const line of readFileSync(file, "utf8").split(String.fromCharCode(10))) { const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, ""); }
  }
}
const log = (step: string, value: unknown) => console.log(`[gateway-move-live] ${step}`, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.runIf(live)("One-tap Gateway move (Arc Testnet, dev test signer)", () => {
  it("deposits the shortfall with one permit transaction, then mints the signed transfer on Arc", async () => {
    const { ARC_GATEWAY_CHAIN } = await import("./chains");
    const { buildArcTransferSpec, burnIntentTypedData } = await import("./intent");
    const { estimateForwardedTransfer, gatewayBalances, gatewayTransferStatus, submitForwardedTransfer } = await import("./api");
    const { walletUsdc } = await import("./balances");
    const { gatewayDepositPermit } = await import("./permit");
    const { gatewayPermitDepositCall } = await import("./deposit-calls");
    const { verifyGatewayMint } = await import("./receipts");
    const { arcClient } = await import("@/lib/earn/gateway");
    const { arcRpcUrl } = await import("@/lib/arc/rpc");

    const account = privateKeyToAccount(process.env.HODD_TEST_SIGNER_PRIVATE_KEY as Hex);
    const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(arcRpcUrl(), { timeout: 20_000 }) });
    const source = ARC_GATEWAY_CHAIN;
    const gatewayBefore = (await gatewayBalances(account.address)).get(source.domain) ?? 0n;
    // Ask for 0.2 USDC more than Gateway holds, so the quote needs a deposit.
    const amount = gatewayBefore + 200_000n;
    const { intent, feeMinor } = await estimateForwardedTransfer(buildArcTransferSpec({ source, depositor: account.address, recipient: account.address, valueMinor: amount }));
    const shortfall = amount + feeMinor - gatewayBefore;
    log("plan", { gatewayBefore, amount, feeMinor, shortfall, walletUsdc: await walletUsdc(source, account.address) });

    // 1. Sign the transfer first (free), exactly like the dialog.
    const signature = await account.signTypedData(burnIntentTypedData(intent));
    // 2. Permit for exactly the shortfall, then ONE deposit transaction.
    const permit = await gatewayDepositPermit(source, account.address, shortfall);
    expect(permit).not.toBeNull();
    const typed = permit!.typedData as { domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, string> };
    const permitSignature = await account.signTypedData({ domain: typed.domain, types: { Permit: (typed.types as { Permit: { name: string; type: string }[] }).Permit }, primaryType: "Permit", message: { ...typed.message, value: BigInt(typed.message.value), nonce: BigInt(typed.message.nonce), deadline: BigInt(typed.message.deadline) } } as never);
    const call = gatewayPermitDepositCall(source, account.address, shortfall, BigInt(permit!.deadline), permitSignature);
    const startBlock = await arcClient.getBlockNumber();
    const depositHash = await wallet.sendTransaction({ to: call.to, data: call.data, value: 0n });
    const receipt = await arcClient.waitForTransactionReceipt({ hash: depositHash, timeout: 120_000 });
    log("deposit (one transaction)", { depositHash, status: receipt.status, gasUsed: receipt.gasUsed });
    expect(receipt.status).toBe("success");

    // 3. Wait for Gateway to credit it, then submit the intent signed before the deposit.
    let credited = gatewayBefore;
    for (let attempt = 0; attempt < 60 && credited < amount + feeMinor; attempt += 1) { await wait(5_000); credited = (await gatewayBalances(account.address)).get(source.domain) ?? 0n; }
    log("credited", { credited });
    expect(credited).toBeGreaterThanOrEqual(amount + feeMinor);
    const transferId = await submitForwardedTransfer(intent, signature);
    let hash: string | undefined;
    for (let attempt = 0; attempt < 60 && !hash; attempt += 1) { await wait(3_000); hash = (await gatewayTransferStatus(transferId)).transactionHash; }
    expect(hash).toMatch(/^0x[\da-f]{64}$/i);
    let evidence;
    for (let attempt = 0; attempt < 20 && !evidence; attempt += 1) { evidence = await verifyGatewayMint(hash as `0x${string}`, { recipient: account.address, valueMinor: amount, afterBlock: startBlock }).catch(() => undefined); if (!evidence) await wait(2_000); }
    log("minted", { transferId, mint: hash, block: evidence?.blockNumber });
    expect(evidence?.logIndex).toBeGreaterThanOrEqual(0);
  }, 600_000);
});
