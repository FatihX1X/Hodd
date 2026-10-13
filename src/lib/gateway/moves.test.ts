// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { GATEWAY_WALLET, gatewayChainByKey } from "./chains";
import { gatewayPermitDepositCall } from "./deposit-calls";
import { buildArcTransferSpec } from "./intent";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ gateway: 0n, wallet: 0n as bigint | null, fee: 27_233n, permit: { deadline: "1790000000", typedData: { primaryType: "Permit" } } as unknown, sealed: [] as Record<string, unknown>[] }));
const wallet = "0xB7a07a8184412A160bACe9DA3EeC914c0021a19C";
vi.mock("@/lib/execution/live-readiness", () => ({ assertLiveAmount: vi.fn(), assertLiveReady: vi.fn(async () => undefined) }));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: { getBlockNumber: vi.fn(async () => 100n) } }));
vi.mock("./handles", () => ({ sealGatewayHandle: (value: Record<string, unknown>) => { m.sealed.push(value); return "sealed"; }, openGatewayHandle: () => null }));
vi.mock("./balances", () => ({ walletUsdc: vi.fn(async () => { if (m.wallet === null) throw new Error("rpc down"); return m.wallet; }) }));
vi.mock("./permit", () => ({ gatewayDepositPermit: vi.fn(async () => m.permit) }));
vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return {
    ...actual,
    gatewayBalances: vi.fn(async () => new Map([[6, m.gateway]])),
    estimateForwardedTransfer: vi.fn(async (spec: ReturnType<typeof buildArcTransferSpec>) => ({ intent: { maxBlockHeight: "48422385", maxFee: m.fee.toString(), spec }, feeMinor: m.fee, forwardingFeeMinor: 17_233n })),
  };
});

const context = { userId: "user-1", binding: "binding-1", wallet: { address: wallet, accountType: "EOA", provider: "INJECTED_METAMASK" } } as never;
const quote = async (amountMinor: bigint) => (await import("./moves")).quoteGatewayMove(context, "TESTNET_LIVE", "Base_Sepolia", amountMinor);

beforeEach(() => { m.gateway = 0n; m.wallet = 0n; m.sealed = []; m.permit = { deadline: "1790000000", typedData: { primaryType: "Permit" } }; });

describe("quoteGatewayMove", () => {
  it("needs no deposit when the Gateway balance covers the amount and fees", async () => {
    m.gateway = 5_000_000n;
    const move = await quote(1_000_000n);
    expect(move.deposit).toBeNull();
    expect(move.stage).toBe("SIGN");
    expect(move.typedData).toBeDefined();
    expect(Number(m.sealed[0].exp) - Date.now()).toBeLessThanOrEqual(5 * 60_000);
  });

  it("deposits exactly the shortfall with a permit, and keeps the signed quote open for an hour", async () => {
    m.gateway = 300_000n; m.wallet = 9_000_000n;
    const move = await quote(1_000_000n);
    expect(move.deposit).toEqual({ amountMinor: (1_000_000n + 27_233n - 300_000n).toString(), permit: m.permit });
    expect(move.message).toMatch(/deposit 0\.727233 USDC into Gateway on Base Sepolia/);
    expect(Number(m.sealed[0].exp) - Date.now()).toBeGreaterThan(55 * 60_000);
  });

  it("falls back to approve and deposit when the token's permit domain cannot be confirmed", async () => {
    m.wallet = 9_000_000n; m.permit = null;
    expect((await quote(1_000_000n)).deposit).toEqual({ amountMinor: "1027233", permit: null });
  });

  it("refuses before anything is signed when wallet and Gateway together are short, and says the most it can bring", async () => {
    m.gateway = 100_000n; m.wallet = 500_000n;
    await expect(quote(1_000_000n)).rejects.toMatchObject({ code: "GATEWAY_BALANCE_INSUFFICIENT", message: expect.stringMatching(/You can bring up to 0\.572767 USDC from Base Sepolia now/) });
    expect(m.sealed).toHaveLength(0);
  });

  it("does not guess when the source wallet cannot be read", async () => {
    m.wallet = null;
    await expect(quote(1_000_000n)).rejects.toMatchObject({ code: "GATEWAY_WALLET_UNREADABLE" });
  });
});

describe("gatewayPermitDepositCall", () => {
  it("is one depositWithPermit call to the GatewayWallet for exactly the permitted amount", () => {
    const signature = `0x${"11".repeat(32)}${"22".repeat(32)}1b` as const;
    const call = gatewayPermitDepositCall(gatewayChainByKey("Base_Sepolia")!, wallet, 727_233n, 1_790_000_000n, signature);
    expect(call.to).toBe(GATEWAY_WALLET);
    const decoded = decodeFunctionData({ abi: parseAbi(["function depositWithPermit(address token, address owner, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)"]), data: call.data });
    expect(decoded.args).toEqual([gatewayChainByKey("Base_Sepolia")!.usdc, wallet, 727_233n, 1_790_000_000n, 27, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`]);
    expect(call.data.slice(0, 10)).toBe("0x8ef59739");
  });
});
