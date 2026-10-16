// @vitest-environment node
// READ-ONLY live check of Hodd's USYC pool code against Arc Testnet. It only calls eth_call / eth_estimateGas /
// eth_gasPrice: no key, no signature, no transaction is ever sent.
// Run: HODD_USYC_LIVE=1 [HODD_USYC_POOL_ADDRESS=0x…] corepack pnpm exec vitest run src/lib/usyc/usyc.live.test.ts
import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";

vi.mock("server-only", () => ({}));
const live = process.env.HODD_USYC_LIVE === "1";
// Any wallet works: users need no allowlisting, only the pool does. This one holds USDC on Arc Testnet.
const WALLET = "0x93A7F9a958171303DE74Ab7f6778D25F96316564";
const show = (label: string, value: unknown) => console.log(`\n[usyc-live] ${label}\n${JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2)}`);

describe.runIf(live)("Hodd's USYC pool on Arc Testnet (read-only)", () => {
  it("reads the wallet's pool position and builds a deposit quote without sending anything", async () => {
    const { readUsycStatus } = await import("./status");
    const { quoteDeposit } = await import("./quotes");
    const { poolAbi, usycPoolAddress } = await import("./constants");
    const pool = usycPoolAddress();
    const position = await readUsycStatus(WALLET);
    show("readUsycStatus", position);
    if (!pool) { expect(position).toBeNull(); return; }
    expect(position).toMatchObject({ pool });
    if (position!.circle !== "OK" || position!.depositsPaused) return;
    const deposit = await quoteDeposit(WALLET, 1_000_000n);
    show("quoteDeposit(1 USDC)", deposit);
    expect(deposit.steps.map((step) => step.stage)).toEqual(["APPROVE", "DEPOSIT"]);
    expect(decodeFunctionData({ abi: poolAbi, data: deposit.steps[1].call.data as `0x${string}` }).functionName).toBe("deposit");
    expect(deposit.steps[1].call.to).toBe(pool);
  }, 120_000);
});
