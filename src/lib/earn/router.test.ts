import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import { EARN_EXECUTE_ABI, EARN_ROUTER, validateEarnCall } from "./router";
import type { EarnQuote } from "./models";

const wallet = "0xB7a07a8184412A160bACe9DA3EeC914c0021a19C";
const vault = "0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88";
const usdc = "0x3600000000000000000000000000000000000000";
const other = "0x00000000000000000000000000000000000000ff";
const now = Date.parse("2026-10-09T10:00:00Z");
const money = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const quote = (operation: EarnQuote["operation"] = "DEPOSIT") => ({ operation, vaultAddress: vault, walletAddress: wallet, amount: money("500000") }) as EarnQuote;
const erc20 = parseAbi(["function increaseAllowance(address,uint256)", "function approve(address,uint256)"]);
const vaultAbi = parseAbi(["function deposit(uint256,address)", "function withdraw(uint256,address,address)", "function redeem(uint256,address,address)"]);
type Overrides = { target?: string; inner?: `0x${string}`; beneficiary?: string; amount?: bigint; deadline?: bigint; tokenIn?: string; tokenOut?: string; inputToken?: string };

// Mirrors a real Earn Kit 1.15.3 capture on Arc Testnet (deposit of 0.5 USDC).
function execute(overrides: Overrides = {}) {
  const inner = overrides.inner ?? encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [500000n, EARN_ROUTER] });
  const data = encodeFunctionData({ abi: EARN_EXECUTE_ABI, functionName: "execute", args: [{
    instructions: [{ target: (overrides.target ?? vault) as `0x${string}`, data: inner, value: 0n, tokenIn: (overrides.tokenIn ?? usdc) as `0x${string}`, amountToApprove: 500000n, tokenOut: (overrides.tokenOut ?? vault) as `0x${string}`, minTokenOut: 497095861064954228n }],
    tokens: [{ token: usdc, beneficiary: (overrides.beneficiary ?? wallet) as `0x${string}` }, { token: vault, beneficiary: wallet }],
    execId: 1n, deadline: overrides.deadline ?? BigInt(now / 1000 + 600), metadata: "0x",
  }, [{ permitType: 0, token: (overrides.inputToken ?? usdc) as `0x${string}`, amount: overrides.amount ?? 500000n, permitCalldata: "0x" }], "0x1234"] });
  return { to: EARN_ROUTER, value: "0", data };
}

describe("Earn router call validation", () => {
  it("accepts the captured deposit shape and returns the router deadline", () => {
    expect(validateEarnCall(execute(), quote(), wallet, { nowMs: now })).toEqual({ stage: "EARN", deadline: BigInt(now / 1000 + 600) });
  });
  it("accepts a bounded USDC approval to the router", () => {
    const call = { to: usdc, value: "0", data: encodeFunctionData({ abi: erc20, functionName: "increaseAllowance", args: [EARN_ROUTER, 500000n] }) } as const;
    expect(validateEarnCall(call, quote(), wallet, { nowMs: now })).toEqual({ stage: "APPROVAL" });
  });
  it("rejects approvals to another spender, token or above the quote", () => {
    expect(() => validateEarnCall({ to: usdc, value: "0", data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [other, 1n] }) }, quote(), wallet)).toThrow("APPROVAL_SPENDER_MISMATCH");
    expect(() => validateEarnCall({ to: vault, value: "0", data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [EARN_ROUTER, 1n] }) }, quote(), wallet)).toThrow("APPROVAL_TOKEN_MISMATCH");
    expect(() => validateEarnCall({ to: usdc, value: "0", data: encodeFunctionData({ abi: erc20, functionName: "increaseAllowance", args: [EARN_ROUTER, 500002n] }) }, quote(), wallet)).toThrow("APPROVAL_AMOUNT_EXCEEDED");
  });
  it("rejects another router, vault, beneficiary, amount, value or a near deadline", () => {
    expect(() => validateEarnCall({ ...execute(), to: other }, quote(), wallet, { nowMs: now })).toThrow("ROUTER_MISMATCH");
    expect(() => validateEarnCall(execute({ target: other }), quote(), wallet, { nowMs: now })).toThrow("ROUTER_INSTRUCTION_MISMATCH");
    expect(() => validateEarnCall(execute({ beneficiary: other }), quote(), wallet, { nowMs: now })).toThrow("ROUTER_BENEFICIARY_MISMATCH");
    expect(() => validateEarnCall(execute({ amount: 600000n }), quote(), wallet, { nowMs: now })).toThrow("ROUTER_INPUT_MISMATCH");
    expect(() => validateEarnCall(execute({ inner: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [500000n, other] }) }), quote(), wallet, { nowMs: now })).toThrow("ROUTER_DEPOSIT_MISMATCH");
    expect(() => validateEarnCall({ ...execute(), value: "1" }, quote(), wallet, { nowMs: now })).toThrow("CALL_VALUE_NOT_ALLOWED");
    expect(() => validateEarnCall(execute({ deadline: BigInt(now / 1000 + 10) }), quote(), wallet, { nowMs: now })).toThrow("ROUTER_DEADLINE_TOO_CLOSE");
  });
  it("binds withdrawals to the router as receiver and owner and to the share balance", () => {
    const inner = encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [500000n, EARN_ROUTER, EARN_ROUTER] });
    const call = execute({ inner, tokenIn: vault, tokenOut: usdc, inputToken: vault, amount: 480000000000000000n });
    expect(validateEarnCall(call, quote("WITHDRAW"), wallet, { nowMs: now, shareBalance: 490000000000000000n })).toMatchObject({ stage: "EARN" });
    expect(() => validateEarnCall(call, quote("WITHDRAW"), wallet, { nowMs: now, shareBalance: 1n })).toThrow("ROUTER_INPUT_MISMATCH");
    const stolen = execute({ inner: encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [500000n, other, EARN_ROUTER] }), tokenIn: vault, tokenOut: usdc, inputToken: vault, amount: 1n });
    expect(() => validateEarnCall(stolen, quote("WITHDRAW"), wallet, { nowMs: now, shareBalance: 10n })).toThrow("ROUTER_WITHDRAW_MISMATCH");
  });
});
