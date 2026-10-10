// @vitest-environment node
// Opt-in live smoke of the Autopilot custody path on Arc Testnet with a real
// Circle developer-controlled wallet: create (idempotent) → fund ≤1 USDC from the
// dev test signer → Morpho deposit (approval + router) → withdraw → return all to
// the owner. Uses the same quote, capture, validation, destination and receipt
// code as the runner; only the Supabase bookkeeping is skipped.
// Run: HODD_AUTOPILOT_LIVE=1 pnpm vitest run src/lib/autopilot/autopilot.live.test.ts
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const live = process.env.HODD_AUTOPILOT_LIVE === "1";
if (live) {
  // vitest runs with NODE_ENV=test, so Next would skip .env.local: read the git-ignored files directly.
  for (const file of [".env.local", ".env.development.local"]) {
    for (const line of readFileSync(file, "utf8").split(String.fromCharCode(10))) { const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, ""); }
  }
}
const SMOKE_USER = "00000000-0000-4000-8000-00000000a6e7";
const log = (step: string, value: unknown) => console.log(`[autopilot-live] ${step}`, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));

describe.runIf(live)("Autopilot custody path (Arc Testnet, Circle dev-controlled wallet)", () => {
  it("creates, funds, invests, withdraws and returns everything to the owner", async () => {
    const { agentAdapter, agentCircle } = await import("./circle");
    const { agentIdempotencyKey, createAgentWallet } = await import("./wallets");
    const { agentEarnQuote } = await import("./quotes");
    const { agentFeeConfig, validateAgentEarnCall } = await import("./calls");
    const { assertAgentDestination } = await import("./destination");
    const { captureNextEarnCall } = await import("@/lib/earn/capture");
    const { verifyApprovalReceipt, verifyEarnReceipt } = await import("@/lib/earn/receipts");
    const { arcClient, discoverAllowedVaults, getEarnPosition } = await import("@/lib/earn/gateway");
    const { ViemArcTreasuryReader } = await import("@/lib/arc/reader");
    const { boundedArcGasPrice } = await import("@/lib/earn/gas");
    const { nativeWeiToUsdcCeil } = await import("@/lib/earn/money");
    const { ARC_TESTNET_USDC } = await import("@/lib/earn/allowlist");

    const owner = privateKeyToAccount(process.env.HODD_TEST_SIGNER_PRIVATE_KEY as Hex);
    const circle = agentCircle();
    const walletSetId = process.env.CIRCLE_AGENT_WALLET_SET_ID?.trim() || (await circle.createWalletSet({ name: "Hodd Autopilot Testnet", idempotencyKey: agentIdempotencyKey("wallet-set", "hodd-autopilot-testnet") })).data?.walletSet?.id;
    expect(walletSetId).toBeTruthy();
    const agent = await createAgentWallet(circle, SMOKE_USER, walletSetId!, "EOA");
    const again = await createAgentWallet(circle, SMOKE_USER, walletSetId!, "EOA");
    expect(again.id).toBe(agent.id); // idempotent per user
    log("wallet", { walletSetId, id: agent.id, address: agent.address });
    const address = getAddress(agent.address);

    const reader = new ViemArcTreasuryReader();
    const sharesOf = (vault: string) => arcClient.readContract({ address: getAddress(vault), abi: erc20Abi, functionName: "balanceOf", args: [address] });
    const decimalsOf = (vault: string) => arcClient.readContract({ address: getAddress(vault), abi: erc20Abi, functionName: "decimals" });
    const { devc } = await agentAdapter().getSdk();
    async function submit(call: { to: `0x${string}`; data: `0x${string}` }, gasLimit: bigint, gasPriceWei: bigint) {
      const id = randomUUID();
      const created = await devc.createContractExecutionTransaction({ walletId: agent.id, contractAddress: call.to, callData: call.data, amount: "0", idempotencyKey: id, refId: id, fee: agentFeeConfig(gasLimit.toString(), gasPriceWei, await arcClient.estimateMaxPriorityFeePerGas()) });
      const txId = created.data?.id; expect(txId).toBeTruthy();
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const tx = (await devc.getTransaction({ id: txId! })).data?.transaction;
        if (tx && ["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) throw new Error(`Circle transaction ${tx.state}`);
        if (tx?.txHash && ["COMPLETE", "CONFIRMED"].includes(tx.state)) {
          expect(tx.walletId).toBe(agent.id); expect(tx.refId).toBe(id);
          return { hash: tx.txHash as Hex, receipt: await arcClient.getTransactionReceipt({ hash: tx.txHash as Hex }) };
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error("Circle transaction not final in time");
    }
    async function inputs() {
      const [vault] = await discoverAllowedVaults();
      const [cash, agentPosition, gasPrice] = await Promise.all([reader.readSnapshot(address), getEarnPosition(address, vault), arcClient.getGasPrice()]);
      return { wallet: { address }, vault, cash, agentPosition, feeReserveMinor: nativeWeiToUsdcCeil((1_500_000n * boundedArcGasPrice(gasPrice)).toString()).minorUnits } as never;
    }
    async function earn(operation: "DEPOSIT" | "WITHDRAW", amountMinor: bigint) {
      const i = await inputs();
      const quote = (await agentEarnQuote(i, { kind: operation === "DEPOSIT" ? "INVEST" : "RESERVE_REFILL", depositMinor: operation === "DEPOSIT" ? amountMinor.toString() : "0", withdrawMinor: operation === "WITHDRAW" ? amountMinor.toString() : "0", transferMinor: "0", remainingBudgetMinor: "1000000", protectedMinor: "0", explanation: "smoke" }))!;
      const hashes: string[] = [];
      for (let stage = 0; stage < 2; stage += 1) {
        const { stage: kind, call } = await captureNextEarnCall(quote, address);
        validateAgentEarnCall(call, quote, address, await sharesOf(quote.vaultAddress), await decimalsOf(quote.vaultAddress));
        const fee = quote.gasFees.find((item) => kind === "APPROVAL" ? /^approv/i.test(item.name) : /deposit|withdraw/i.test(item.name))!;
        const { hash, receipt } = await submit(call, BigInt(fee.gasLimit!), BigInt(fee.maxGasPriceWei!));
        hashes.push(hash);
        if (kind === "APPROVAL") { verifyApprovalReceipt(receipt, { to: call.to, data: call.data, value: 0n }, address); continue; }
        verifyEarnReceipt(receipt, quote); log(operation, { amountMinor, hashes }); return hashes;
      }
      throw new Error("Earn did not reach the router call");
    }

    // Fund the agent with exactly 1 USDC from the owner (dev test signer), if it holds less.
    let cash = BigInt((await reader.readSnapshot(address)).balance.minorUnits);
    if (cash < 900_000n) {
      const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network") });
      const hash = await wallet.writeContract({ address: ARC_TESTNET_USDC, abi: erc20Abi, functionName: "transfer", args: [address, 1_000_000n] });
      await arcClient.waitForTransactionReceipt({ hash }); log("funded", { hash });
      for (let attempt = 0; attempt < 15 && cash < 900_000n; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 2_000)); cash = BigInt((await reader.readSnapshot(address)).balance.minorUnits); }
    }
    expect(cash).toBeGreaterThanOrEqual(900_000n);

    if (process.env.SKIP_DEPOSIT !== "1") await earn("DEPOSIT", 500_000n);
    const position = await getEarnPosition(address, (await discoverAllowedVaults())[0]);
    expect(BigInt(position.currentBalance.minorUnits)).toBeGreaterThan(0n);
    await earn("WITHDRAW", BigInt(position.redeemable.minorUnits) > 499_000n ? 499_000n : BigInt(position.redeemable.minorUnits));

    // Return all liquid USDC to the verified owner, keeping only this transfer's gas.
    const gasPrice = boundedArcGasPrice(await arcClient.getGasPrice());
    const balance = BigInt((await reader.readSnapshot(address)).balance.minorUnits);
    const gasLimit = 120_000n; const fee = BigInt(nativeWeiToUsdcCeil((gasLimit * gasPrice).toString()).minorUnits);
    const amount = balance - fee - 1_000n;
    assertAgentDestination({ token: ARC_TESTNET_USDC, destination: owner.address, verifiedOwner: owner.address, boundOwner: owner.address, chainId: 5042002 });
    expect(() => assertAgentDestination({ token: ARC_TESTNET_USDC, destination: "0x62dCe01b1a7B9a6f592f148d305E0D5751478386", verifiedOwner: owner.address, boundOwner: owner.address, chainId: 5042002 })).toThrow();
    const back = await submit({ to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [owner.address, amount] }) }, gasLimit, gasPrice);
    expect(back.receipt.status).toBe("success");
    log("returned", { amountMinor: amount, hash: back.hash, residualMinor: BigInt((await reader.readSnapshot(address)).balance.minorUnits) });
  }, 900_000);
});
