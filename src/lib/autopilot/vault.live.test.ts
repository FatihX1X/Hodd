// @vitest-environment node
// Opt-in LIVE run of Autopilot vault mode on Arc Testnet with a real Circle developer-controlled agent wallet as the
// vault's operator and the dev test signer as its owner: create the vault through the factory (owner signs), fund it,
// approve a bill recipient, then the agent deposits into Morpho, withdraws, pays the bill, redeems to the owner and
// sends idle cash to the owner; finally the owner takes the rest back with withdrawAll. Every agent call is built,
// decoded and verified with the same functions the runner uses. Sends real testnet transactions (about 1 USDC moves
// and comes back, plus fees).
// Run: HODD_VAULT_LIVE=1 corepack pnpm exec vitest run src/lib/autopilot/vault.live.test.ts --silent=false
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const live = process.env.HODD_VAULT_LIVE === "1";
if (live) {
  for (const file of [".env.local", ".env.development.local", ".env.test.local"]) {
    for (const line of readFileSync(file, "utf8").split(String.fromCharCode(10))) { const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, ""); }
  }
}
const SMOKE_USER = "00000000-0000-4000-8000-00000000a6e7";
const log = (step: string, value: unknown) => console.log(`[vault-live] ${step}`, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));

describe.runIf(live)("Autopilot vault mode (Arc Testnet, Circle agent as operator)", () => {
  it("creates a vault, invests, pays an approved bill and returns everything to the owner", async () => {
    const { agentAdapter, agentCircle } = await import("./circle");
    const { agentIdempotencyKey, createAgentWallet } = await import("./wallets");
    const { agentFeeConfig } = await import("./calls");
    const { arcClient, discoverAllowedVaults } = await import("@/lib/earn/gateway");
    const { ARC_TESTNET_USDC } = await import("@/lib/earn/allowlist");
    const { boundedArcGasPrice } = await import("@/lib/earn/gas");
    const v = await import("./vault");
    const s = await import("./vault-state");

    const owner = privateKeyToAccount(process.env.HODD_TEST_SIGNER_PRIVATE_KEY as Hex);
    const recipient = getAddress(process.env.HODD_TEST_WALLET_ADDRESS!);
    const ownerWallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network", { timeout: 20_000 }) });
    const ownerSend = async (label: string, call: { to: `0x${string}`; data: Hex }) => {
      const hash = await ownerWallet.sendTransaction({ to: call.to, data: call.data, value: 0n });
      const receipt = await arcClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      log(label, { hash, status: receipt.status, gasUsed: receipt.gasUsed }); expect(receipt.status).toBe("success"); return receipt;
    };
    const usdcOf = (address: string) => arcClient.readContract({ address: ARC_TESTNET_USDC, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)] });

    const circle = agentCircle();
    const walletSetId = process.env.CIRCLE_AGENT_WALLET_SET_ID?.trim() || (await circle.createWalletSet({ name: "Hodd Autopilot Testnet", idempotencyKey: agentIdempotencyKey("wallet-set", "hodd-autopilot-testnet") })).data?.walletSet?.id;
    const agent = await createAgentWallet(circle, SMOKE_USER, walletSetId!, "EOA");
    const operator = getAddress(agent.address);
    const { devc } = await agentAdapter().getSdk();
    /** The agent signs through Circle, exactly like the runner (Circle contract execution with an EIP-1559 fee ceiling). */
    async function agentSend(label: string, vault: `0x${string}`, op: Parameters<typeof v.encodeVaultCall>[1]) {
      const call = v.encodeVaultCall(vault, op);
      expect(v.decodeVaultCall(vault, call)).toEqual(op);
      const gasLimit = (await arcClient.estimateGas({ account: operator, to: call.to, data: call.data, value: 0n }) * 120n + 99n) / 100n;
      const id = randomUUID();
      const created = await devc.createContractExecutionTransaction({ walletId: agent.id, contractAddress: call.to, callData: call.data, amount: "0", idempotencyKey: id, refId: id, fee: agentFeeConfig(gasLimit.toString(), boundedArcGasPrice(await arcClient.getGasPrice()), await arcClient.estimateMaxPriorityFeePerGas()) });
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const tx = (await devc.getTransaction({ id: created.data!.id })).data?.transaction;
        if (tx && ["FAILED", "DENIED", "CANCELLED"].includes(tx.state)) throw new Error(`Circle transaction ${tx.state}`);
        if (tx?.txHash && ["COMPLETE", "CONFIRMED"].includes(tx.state)) {
          const receipt = await arcClient.getTransactionReceipt({ hash: tx.txHash as Hex });
          const transaction = await arcClient.getTransaction({ hash: tx.txHash as Hex });
          expect(getAddress(transaction.from)).toBe(operator); expect(transaction.input).toBe(call.data);
          const evidence = v.verifyVaultReceipt(receipt, vault, owner.address, op);
          log(label, { hash: tx.txHash, ...evidence });
          return evidence;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error("Circle transaction not final in time");
    }

    // 1. The vault: predicted, created by the owner through the factory, then checked setting by setting.
    const vault = await s.predictVault(owner.address, operator);
    log("vault", { owner: owner.address, operator, vault });
    if (!(await s.vaultDeployed(vault))) await ownerSend("createVault", v.createVaultCall(owner.address, operator));
    const config = await s.verifiedVault(vault, owner.address, operator);
    expect(config.paused).toBe(false);

    // 2. Fund: 1 USDC into the vault, fee money for the agent, approve the bill recipient with a 0.1 USDC cap.
    await ownerSend("fund vault", { to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [vault, 1_000_000n] }) });
    if ((await usdcOf(operator)) < 300_000n) await ownerSend("agent fee money", { to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [operator, 500_000n] }) });
    const approved = (await s.readRecipients(vault, [recipient])).get(recipient)!;
    if (!approved.approved) await ownerSend("approve recipient", { to: vault, data: encodeFunctionData({ abi: v.vaultAbi, functionName: "addRecipient", args: [recipient, 100_000n] }) });
    else if (approved.capMinor < 100_000n) await ownerSend("raise cap", { to: vault, data: encodeFunctionData({ abi: v.vaultAbi, functionName: "setRecipientCap", args: [recipient, 100_000n] }) });

    // 3. The agent: invest, withdraw part back into the vault, pay the bill, redeem part straight to the owner, send idle cash to the owner.
    const morpho = (await discoverAllowedVaults())[0];
    await agentSend("depositToStrategy", vault, { fn: "depositToStrategy", strategy: v.VAULT_MORPHO, assets: 500_000n, minShares: v.minSharesFor(await s.previewDeposit(500_000n)) });
    let funds = await s.readVaultFunds(vault, morpho);
    log("after deposit", { idle: funds.idle.balance.minorUnits, position: funds.position.currentBalance.minorUnits, redeemable: funds.position.redeemable.minorUnits, shares: funds.shares });
    expect(BigInt(funds.position.currentBalance.minorUnits)).toBeGreaterThan(490_000n);
    await agentSend("withdrawFromStrategy", vault, { fn: "withdrawFromStrategy", strategy: v.VAULT_MORPHO, assets: 200_000n, maxShares: v.maxSharesFor(await s.previewWithdraw(200_000n)) });
    const recipientBefore = await usdcOf(recipient);
    const paid = await agentSend("pay", vault, { fn: "pay", recipient, amount: 100_000n, ref: v.billRef("vault-live-test") });
    expect(await usdcOf(recipient) - recipientBefore).toBe(100_000n);
    expect("logIndex" in paid).toBe(true);
    // The contract refuses a payment above the recipient's cap, and a payment to anyone else.
    await expect(arcClient.estimateGas({ account: operator, to: vault, data: v.encodeVaultCall(vault, { fn: "pay", recipient, amount: 100_001n, ref: v.billRef("over-cap") }).data })).rejects.toThrow();
    await expect(arcClient.estimateGas({ account: operator, to: vault, data: v.encodeVaultCall(vault, { fn: "pay", recipient: getAddress("0x000000000000000000000000000000000000dEaD"), amount: 1n, ref: v.billRef("stranger") }).data })).rejects.toThrow();
    funds = await s.readVaultFunds(vault, morpho);
    const half = funds.shares / 2n;
    await agentSend("redeemToOwner", vault, { fn: "redeemToOwner", strategy: v.VAULT_MORPHO, shares: half, minAssets: v.minAssetsFor(await s.convertToAssets(half)) });
    await agentSend("transferToOwner", vault, { fn: "transferToOwner", amount: 100_000n });

    // 4. The owner takes the rest back without the agent.
    const ownerBefore = await usdcOf(owner.address);
    await ownerSend("withdrawAll", { to: vault, data: encodeFunctionData({ abi: v.vaultAbi, functionName: "withdrawAll" }) });
    funds = await s.readVaultFunds(vault, morpho);
    log("end", { vaultIdle: funds.idle.balance.minorUnits, vaultPosition: funds.position.currentBalance.minorUnits, ownerGainMinor: (await usdcOf(owner.address)) - ownerBefore });
    expect(BigInt(funds.idle.balance.minorUnits)).toBe(0n);
    expect(BigInt(funds.position.currentBalance.minorUnits)).toBeLessThanOrEqual(1n);
  }, 900_000);
});
