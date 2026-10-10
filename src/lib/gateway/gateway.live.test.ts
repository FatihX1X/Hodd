// @vitest-environment node
// Opt-in live Arc Testnet check of Hodd's own Gateway code (no SDK): build the
// spec, estimate, sign EIP-712, submit with forwarding, verify the Arc mint to a
// third-party recipient. Run: HODD_GATEWAY_LIVE=1 pnpm vitest run src/lib/gateway/gateway.live.test.ts
import { readFileSync } from "node:fs";
import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const live = process.env.HODD_GATEWAY_LIVE === "1";
const env = (name: string) => {
  for (const file of [".env.development.local", ".env.test.local"]) {
    try { const line = readFileSync(file, "utf8").split(/\r?\n/).find((item) => item.startsWith(`${name}=`)); if (line) return line.slice(name.length + 1).trim().replace(/^"|"$/g, ""); } catch { /* optional */ }
  }
  return "";
};

describe.runIf(live)("Circle Gateway live (Arc Testnet)", () => {
  it("mints straight to a third-party recipient on Arc", async () => {
    const { ARC_GATEWAY_CHAIN } = await import("./chains");
    const { buildArcTransferSpec, burnIntentTypedData } = await import("./intent");
    const { estimateForwardedTransfer, gatewayBalances, gatewayTransferStatus, submitForwardedTransfer } = await import("./api");
    const { findGatewayMint, verifyGatewayMint } = await import("./receipts");
    const { arcClient } = await import("@/lib/earn/gateway");
    const account = privateKeyToAccount(env("HODD_TEST_SIGNER_PRIVATE_KEY") as `0x${string}`);
    const recipient = env("HODD_TEST_WALLET_ADDRESS");
    const value = 50_000n;
    const before = (await gatewayBalances(account.address)).get(26) ?? 0n;
    const startBlock = await arcClient.getBlockNumber();
    const { intent, feeMinor } = await estimateForwardedTransfer(buildArcTransferSpec({ source: ARC_GATEWAY_CHAIN, depositor: account.address, recipient, valueMinor: value }));
    expect(before).toBeGreaterThanOrEqual(value + feeMinor);
    const typed = burnIntentTypedData(intent);
    const signature = await account.signTypedData(typed);
    expect(await verifyTypedData({ address: account.address, ...typed, signature })).toBe(true);
    const transferId = await submitForwardedTransfer(intent, signature);
    let hash: string | undefined;
    for (let attempt = 0; attempt < 60 && !hash; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 3_000)); hash = (await gatewayTransferStatus(transferId)).transactionHash; }
    expect(hash).toMatch(/^0x[\da-f]{64}$/i);
    let evidence;
    for (let attempt = 0; attempt < 20 && !evidence; attempt += 1) { evidence = await verifyGatewayMint(hash as `0x${string}`, { recipient, valueMinor: value, afterBlock: startBlock }).catch(() => undefined); if (!evidence) await new Promise((resolve) => setTimeout(resolve, 2_000)); }
    expect(evidence?.logIndex).toBeGreaterThanOrEqual(0);
    const found = await findGatewayMint({ recipient, valueMinor: value, afterBlock: startBlock });
    expect(found?.hash.toLowerCase()).toBe(hash!.toLowerCase());
    console.log(JSON.stringify({ transferId, mint: hash, block: evidence?.blockNumber, maxFee: intent.maxFee }));
  }, 240_000);
});
