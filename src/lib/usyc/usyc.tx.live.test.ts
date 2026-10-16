// @vitest-environment node
// Opt-in LIVE round trip through Hodd's USYC pool on Arc Testnet with the dev test signer: quote → approve →
// deposit 1 USDC → verify → withdraw everything → verify. Uses the app's own quote and verify code and signs each
// step inside the quote's gas ceiling. Sends real testnet transactions.
// Run: HODD_USYC_TX_LIVE=1 corepack pnpm exec vitest run src/lib/usyc/usyc.tx.live.test.ts --silent=false
import { readFileSync } from "node:fs";
import { createWalletClient, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const live = process.env.HODD_USYC_TX_LIVE === "1";
if (live) {
  // vitest runs with NODE_ENV=test, so Next would skip .env.local: read the git-ignored files directly.
  for (const file of [".env.local", ".env.development.local"]) {
    for (const line of readFileSync(file, "utf8").split(String.fromCharCode(10))) { const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, ""); }
  }
}
const log = (step: string, value: unknown) => console.log(`[usyc-tx-live] ${step}`, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));

describe.runIf(live)("USYC pool round trip (Arc Testnet, dev test signer)", () => {
  it("deposits 1 USDC and withdraws everything back to the same wallet", async () => {
    const { quoteDeposit, quoteWithdraw } = await import("./quotes");
    const { verifyUsycTransaction } = await import("./verify");
    const { readUsycStatus } = await import("./status");
    const { USYC_USDC, usdcAbi } = await import("./constants");
    const { arcClient } = await import("@/lib/earn/gateway");
    const { arcRpcUrl } = await import("@/lib/arc/rpc");

    const account = privateKeyToAccount(process.env.HODD_TEST_SIGNER_PRIVATE_KEY as Hex);
    const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(arcRpcUrl(), { timeout: 20_000 }) });
    const usdcOf = () => arcClient.readContract({ address: USYC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [account.address] });
    async function send(step: { stage: string; call: { to: string; data: string }; gasCeiling: { gasLimit: string; gasPriceWei: string } }) {
      const hash = await wallet.sendTransaction({ type: "legacy", to: getAddress(step.call.to), data: step.call.data as Hex, value: 0n, gas: BigInt(step.gasCeiling.gasLimit), gasPrice: BigInt(step.gasCeiling.gasPriceWei) });
      const receipt = await arcClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      log(step.stage, { hash, status: receipt.status, gasUsed: receipt.gasUsed });
      return hash;
    }

    const before = await usdcOf();
    log("start", { wallet: account.address, usdc: before });
    const amount = 1_000_000n;
    const deposit = await quoteDeposit(account.address, amount);
    log("deposit quote", deposit.preview);
    const approveHash = await send(deposit.steps[0]);
    expect((await verifyUsycTransaction({ wallet: account.address, step: "APPROVE", txHash: approveHash, amount })).status).toBe("CONFIRMED");
    const depositHash = await send(deposit.steps[1]);
    const deposited = await verifyUsycTransaction({ wallet: account.address, step: "DEPOSIT", txHash: depositHash, amount });
    log("deposit verified", deposited);
    expect(deposited.status).toBe("CONFIRMED");

    const held = await readUsycStatus(account.address);
    log("position", held);
    expect(BigInt(held!.shares)).toBeGreaterThanOrEqual(BigInt(deposit.preview.minimum));

    const withdraw = await quoteWithdraw(account.address, { all: true });
    log("withdraw quote", withdraw.preview);
    const withdrawHash = await send(withdraw.steps[0]);
    const withdrawn = await verifyUsycTransaction({ wallet: account.address, step: "WITHDRAW", txHash: withdrawHash, amount: BigInt(withdraw.amountMinor) });
    log("withdraw verified", withdrawn);
    expect(withdrawn.status).toBe("CONFIRMED");

    const after = await readUsycStatus(account.address);
    const usdcAfter = await usdcOf();
    log("end", { shares: after!.shares, usdc: usdcAfter, roundTripCostMinor: before - usdcAfter });
    expect(after!.shares).toBe("0");
    // Price spread (after-hours pricing) plus network fees: well under 1% of the deposit plus 0.1 USDC of gas.
    expect(before - usdcAfter).toBeLessThan(amount / 100n + 100_000n);
  }, 600_000);
});
