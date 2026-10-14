// @vitest-environment node
// Opt-in LIVE run of the vault's USYC strategy on Arc Testnet, with a real Circle developer-controlled agent wallet as
// the operator and the dev test signer as the owner: the owner lifts the amount limits of a vault created with the
// earlier limits, then on a vault created without limits the agent deposits into Hodd's USYC pool, redeems part back
// into the vault (as for a bill), redeems the rest straight to the owner, and the owner sweeps the vault. Every agent
// call is built, decoded and verified with the same functions the runner uses. Sends real testnet transactions
// (about 1 USDC moves and comes back, plus fees).
// Run: HODD_VAULT_LIVE=1 corepack pnpm exec vitest run src/lib/autopilot/vault-usyc.live.test.ts --silent=false
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
const log = (step: string, value: unknown) => console.log(`[vault-usyc-live] ${step}`, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));

describe.runIf(live)("Autopilot vault mode with USYC (Arc Testnet, Circle agent as operator)", () => {
  it("lifts an older vault's limits, then invests in USYC, redeems for a bill and to the owner, and sweeps", async () => {
    const { agentAdapter, agentCircle } = await import("./circle");
    const { agentIdempotencyKey, createAgentWallet } = await import("./wallets");
    const { agentFeeConfig } = await import("./calls");
    const { arcClient } = await import("@/lib/earn/gateway");
    const { ARC_TESTNET_USDC } = await import("@/lib/earn/allowlist");
    const { boundedArcGasPrice } = await import("@/lib/earn/gas");
    const v = await import("./vault");
    const s = await import("./vault-state");

    const owner = privateKeyToAccount(process.env.HODD_TEST_SIGNER_PRIVATE_KEY as Hex);
    const ownerWallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network", { timeout: 20_000 }) });
    const ownerSend = async (label: string, call: { to: `0x${string}`; data: Hex }) => {
      const hash = await ownerWallet.sendTransaction({ to: call.to, data: call.data, value: 0n });
      const receipt = await arcClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      log(label, { hash, status: receipt.status, gasUsed: receipt.gasUsed }); expect(receipt.status).toBe("success"); return receipt;
    };
    const usdcOf = (address: string) => arcClient.readContract({ address: ARC_TESTNET_USDC, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)] });
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const circle = agentCircle();
    const walletSetId = process.env.CIRCLE_AGENT_WALLET_SET_ID?.trim() || (await circle.createWalletSet({ name: "Hodd Autopilot Testnet", idempotencyKey: agentIdempotencyKey("wallet-set", "hodd-autopilot-testnet") })).data?.walletSet?.id;
    const agent = await createAgentWallet(circle, SMOKE_USER, walletSetId!, "EOA");
    const operator = getAddress(agent.address);
    const { devc } = await agentAdapter().getSdk();
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
        await pause(2_000);
      }
      throw new Error("Circle transaction not final in time");
    }

    // 1. A vault created with the earlier limits: its owner lifts them with one call; the agent's checks still accept it.
    const legacy = await s.predictLegacyVault(owner.address, operator);
    if (await s.vaultDeployed(legacy)) {
      const before = await s.verifiedVault(legacy, owner.address, operator);
      if (!v.limitsLifted(before.limits)) await ownerSend("lift limits (legacy vault)", v.liftLimitsCall(legacy));
      expect(v.limitsLifted((await s.verifiedVault(legacy, owner.address, operator)).limits)).toBe(true);
      log("legacy vault", { legacy, lifted: true });
    } else log("legacy vault", { legacy, deployed: false });

    // 2. A new vault starts without amount limits.
    const vault = await s.predictVault(owner.address, operator);
    expect(vault).not.toBe(legacy);
    if (!(await s.vaultDeployed(vault))) await ownerSend("createVault (no limits)", v.createVaultCall(owner.address, operator));
    const config = await s.verifiedVault(vault, owner.address, operator);
    expect(v.limitsLifted(config.limits)).toBe(true);
    log("vault", { vault, limits: config.limits, strategies: config.strategies });

    // 3. Fund 1 USDC and the agent's fee money.
    await ownerSend("fund vault", { to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [vault, 1_000_000n] }) });
    if ((await usdcOf(operator)) < 300_000n) await ownerSend("agent fee money", { to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [operator, 500_000n] }) });
    log("usyc yield (bps a year)", { usycApyBps: await s.usycApyBps() });

    // 4. The agent deposits into the USYC pool.
    let usyc = await s.readVaultUsyc(vault);
    expect(usyc?.ready).toBe(true);
    expect(usyc!.depositRoomMinor).toBeGreaterThan(600_000n);
    await agentSend("depositToStrategy USYC", vault, { fn: "depositToStrategy", strategy: v.VAULT_USYC_POOL, assets: 600_000n, minShares: v.minSharesFor(await s.previewDeposit(600_000n, v.VAULT_USYC_POOL)) });
    await pause(3_000);
    usyc = await s.readVaultUsyc(vault);
    log("after deposit", usyc);
    expect(usyc!.valueMinor).toBeGreaterThan(590_000n);

    // 5. Redeem shares worth 0.2 USDC (plus the runner's 0.5% buffer) back into the vault, as a bill payment would.
    const shares = ((200_000n * usyc!.shares + usyc!.valueMinor - 1n) / usyc!.valueMinor) * 10_050n / 10_000n;
    const idleBefore = await usdcOf(vault);
    const back = await agentSend("redeemFromStrategy USYC", vault, { fn: "redeemFromStrategy", strategy: v.VAULT_USYC_POOL, shares, minAssets: v.minAssetsFor(await s.previewRedeem(shares)) });
    expect(await usdcOf(vault) - idleBefore).toBe(back.assetsMinor);
    expect(back.assetsMinor).toBeGreaterThanOrEqual(199_000n);

    // 6. Redeem the rest straight to the owner.
    await pause(3_000);
    usyc = await s.readVaultUsyc(vault);
    const ownerBefore = await usdcOf(owner.address);
    const out = await agentSend("redeemToOwner USYC", vault, { fn: "redeemToOwner", strategy: v.VAULT_USYC_POOL, shares: usyc!.redeemableShares, minAssets: v.minAssetsFor(await s.previewRedeem(usyc!.redeemableShares)) });
    expect(await usdcOf(owner.address) - ownerBefore).toBe(out.assetsMinor);

    // 7. The owner sweeps the vault's cash without the agent.
    await ownerSend("withdrawAll", { to: vault, data: encodeFunctionData({ abi: v.vaultAbi, functionName: "withdrawAll" }) });
    await pause(3_000);
    usyc = await s.readVaultUsyc(vault);
    log("end", { vaultIdle: await usdcOf(vault), usycShares: usyc?.shares });
    expect(await usdcOf(vault)).toBe(0n);
    expect(usyc?.shares).toBe(0n);
  }, 900_000);
});
