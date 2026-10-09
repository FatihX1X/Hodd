import { decodeFunctionData, getAddress, parseAbi } from "viem";
import { ARC_TESTNET_USDC } from "./allowlist";
import type { EarnQuote } from "./models";

/** Circle Earn Kit adapter (router) on Arc Testnet, app-kit 1.15.3. */
export const EARN_ROUTER = getAddress("0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b");
export type EarnStage = "APPROVAL" | "EARN";
export type EarnCall = Readonly<{ to: `0x${string}`; data: `0x${string}`; value: string }>;

// Earn Kit uses increaseAllowance for Arc USDC and approve for vault shares.
const APPROVAL_SELECTORS = /^(0x095ea7b3|0x39509351)/i;
export const earnStageOf = (data: string): EarnStage => APPROVAL_SELECTORS.test(data) ? "APPROVAL" : "EARN";

const approvalAbi = parseAbi(["function approve(address spender, uint256 amount)", "function increaseAllowance(address spender, uint256 addedValue)"]);
const vaultAbi = parseAbi(["function deposit(uint256 assets, address receiver)", "function mint(uint256 shares, address receiver)", "function withdraw(uint256 assets, address receiver, address owner)", "function redeem(uint256 shares, address receiver, address owner)"]);
export const EARN_EXECUTE_ABI = [{ type: "function", name: "execute", stateMutability: "payable", outputs: [], inputs: [
  { name: "params", type: "tuple", components: [
    { name: "instructions", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "data", type: "bytes" }, { name: "value", type: "uint256" }, { name: "tokenIn", type: "address" }, { name: "amountToApprove", type: "uint256" }, { name: "tokenOut", type: "address" }, { name: "minTokenOut", type: "uint256" }] },
    { name: "tokens", type: "tuple[]", components: [{ name: "token", type: "address" }, { name: "beneficiary", type: "address" }] },
    { name: "execId", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "metadata", type: "bytes" }] },
  { name: "tokenInputs", type: "tuple[]", components: [{ name: "permitType", type: "uint8" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }, { name: "permitCalldata", type: "bytes" }] },
  { name: "signature", type: "bytes" }] }] as const;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function fail(code: string): never { throw new Error(code); }

/**
 * Pre-signature check of a call Earn Kit produced. The signed router params
 * come from Circle's API; this independently enforces that only the
 * allowlisted vault is touched, every swept token returns to the user's own
 * wallet, the input equals the quote, and the router deadline leaves time to
 * sign. Receipt verification after mining stays the final proof.
 */
export function validateEarnCall(call: EarnCall, quote: EarnQuote, wallet: string, opts: { shareBalance?: bigint; nowMs?: number } = {}): { stage: EarnStage; deadline?: bigint } {
  if (BigInt(call.value) !== 0n) fail("CALL_VALUE_NOT_ALLOWED");
  const vault = getAddress(quote.vaultAddress); const deposit = quote.operation === "DEPOSIT";
  const stage = earnStageOf(call.data);
  if (stage === "APPROVAL") {
    if (!same(call.to, deposit ? ARC_TESTNET_USDC : vault)) fail("APPROVAL_TOKEN_MISMATCH");
    const { args } = decodeFunctionData({ abi: approvalAbi, data: call.data });
    if (!same(args[0], EARN_ROUTER)) fail("APPROVAL_SPENDER_MISMATCH");
    const ceiling = deposit ? BigInt(quote.amount.minorUnits) + 1n : (opts.shareBalance ?? -1n) + 1n;
    if (args[1] <= 0n || args[1] > ceiling) fail("APPROVAL_AMOUNT_EXCEEDED");
    return { stage };
  }
  if (!same(call.to, EARN_ROUTER)) fail("ROUTER_MISMATCH");
  let decoded;
  try { decoded = decodeFunctionData({ abi: EARN_EXECUTE_ABI, data: call.data }); } catch { fail("ROUTER_CALL_UNSUPPORTED"); }
  const [params, tokenInputs] = decoded.args;
  const nowSeconds = BigInt(Math.floor((opts.nowMs ?? Date.now()) / 1000));
  if (params.deadline <= nowSeconds + 30n) fail("ROUTER_DEADLINE_TOO_CLOSE");
  const [tokenIn, tokenOut] = deposit ? [ARC_TESTNET_USDC, vault] : [vault, ARC_TESTNET_USDC];
  if (!params.instructions.length) fail("ROUTER_INSTRUCTIONS_MISSING");
  for (const instruction of params.instructions) {
    if (!same(instruction.target, vault) || instruction.value !== 0n || !same(instruction.tokenIn, tokenIn) || !same(instruction.tokenOut, tokenOut)) fail("ROUTER_INSTRUCTION_MISMATCH");
    let inner;
    try { inner = decodeFunctionData({ abi: vaultAbi, data: instruction.data }); } catch { fail("ROUTER_INSTRUCTION_UNSUPPORTED"); }
    if (deposit) {
      if (inner.functionName !== "deposit" || inner.args[0] !== BigInt(quote.amount.minorUnits) || !same(inner.args[1], EARN_ROUTER)) fail("ROUTER_DEPOSIT_MISMATCH");
    } else {
      if ((inner.functionName !== "withdraw" && inner.functionName !== "redeem") || !same(inner.args[1], EARN_ROUTER) || !same(inner.args[2], EARN_ROUTER)) fail("ROUTER_WITHDRAW_MISMATCH");
      if (inner.functionName === "withdraw" && inner.args[0] !== BigInt(quote.amount.minorUnits)) fail("ROUTER_WITHDRAW_MISMATCH");
    }
  }
  if (!params.tokens.length || params.tokens.some((item) => !same(item.beneficiary, wallet) || (!same(item.token, ARC_TESTNET_USDC) && !same(item.token, vault)))) fail("ROUTER_BENEFICIARY_MISMATCH");
  if (!tokenInputs.length || tokenInputs.some((item) => item.permitType !== 0 || item.permitCalldata !== "0x" || !same(item.token, tokenIn))) fail("ROUTER_INPUT_MISMATCH");
  const input = tokenInputs.reduce((sum, item) => sum + item.amount, 0n);
  if (deposit ? input !== BigInt(quote.amount.minorUnits) : input > (opts.shareBalance ?? -1n)) fail("ROUTER_INPUT_MISMATCH");
  return { stage, deadline: params.deadline };
}
