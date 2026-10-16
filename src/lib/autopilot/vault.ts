import { decodeEventLog, decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, stringToHex, type Hex, type TransactionReceipt } from "viem";
import { ARC_TESTNET_USDC, EARN_VAULT_ALLOWLIST } from "@/lib/earn/allowlist";

/**
 * HoddieVault: one non-custodial vault per user (contracts/src/HoddieVault.sol). The user's own wallet is the owner;
 * Hodd's Circle agent wallet is only the operator. The operator can put idle USDC into an allowlisted strategy, take it
 * back into the vault or straight to the owner, send idle USDC to the owner, and pay an owner-approved recipient within
 * that recipient's cap and the rolling 24-hour payment budget. The contract enforces all of it; the owner can always
 * withdrawAll(). Factory deployed and verified on Arc Testnet (2026-10-14).
 */
export const HODDIE_VAULT_FACTORY = getAddress("0x311578B21F269ca0E45f5c16324A3E51f69ce389");
/** The allowlisted Morpho vault, one of the two strategies Autopilot invests in. */
export const VAULT_MORPHO = EARN_VAULT_ALLOWLIST[0].address;
/** Hodd's pooled USYC vault (Circle-allowlisted), the other strategy. It has no exact-assets withdraw: exits redeem shares. */
export const VAULT_USYC_POOL = getAddress("0x97A7BAaA5416e0aC0674C395cec22FF606120b76");
export type StrategyKey = "MORPHO" | "USYC";
export const strategyAddress = (key: StrategyKey) => key === "MORPHO" ? VAULT_MORPHO : VAULT_USYC_POOL;
/**
 * "No limit" for the contract's amount budgets: the largest value its 24-hour windows accept (uint64). The agent is
 * bounded only by where it can send money (the two strategies, approved recipients up to their caps, the owner).
 */
export const VAULT_NO_LIMIT = 2n ** 64n - 1n;
/** Creation parameters of new vaults (USDC base units). Changing any of them yields a different vault address. */
export const VAULT_LIMITS = { maxDepositPerTx: VAULT_NO_LIMIT, depositLimit24h: VAULT_NO_LIMIT, maxPaymentPerTx: VAULT_NO_LIMIT, paymentLimit24h: VAULT_NO_LIMIT } as const;
/** What vaults created before 2026-10-15 started with; their owner lifts them with one setLimits call. */
export const LEGACY_VAULT_LIMITS = { maxDepositPerTx: 1_000_000_000n, depositLimit24h: 2_000_000_000n, maxPaymentPerTx: 1_000_000_000n, paymentLimit24h: 2_000_000_000n } as const;
export const VAULT_STRATEGIES = [VAULT_MORPHO, VAULT_USYC_POOL] as const;
/** True when none of the contract's amount budgets can bind in practice (more than all USDC in existence). */
export const limitsLifted = (limits: VaultLimits) => [limits.maxDepositPerTx, limits.depositLimit24h, limits.maxPaymentPerTx, limits.paymentLimit24h].every((value) => value >= 2n ** 63n);
/** Strategy deposits and withdrawals are bounded to at most this loss against the strategy's own preview (0.5%). */
export const VAULT_SLIPPAGE_BPS = 50n;

export const factoryAbi = parseAbi([
  "struct Limits { uint256 maxDepositPerTx; uint256 depositLimit24h; uint256 maxPaymentPerTx; uint256 paymentLimit24h; }",
  "function createVault(address owner, address operator, Limits limits, address[] strategies) returns (address vault)",
  "function predictVault(address owner, address operator, Limits limits, address[] strategies) view returns (address)",
  "function isVault(address vault) view returns (bool)",
  "event VaultCreated(address indexed owner, address indexed operator, address indexed vault)",
]);
export const vaultAbi = parseAbi([
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "function paused() view returns (bool)",
  "function asset() view returns (address)",
  "function maxDepositPerTx() view returns (uint256)",
  "function depositLimit24h() view returns (uint256)",
  "function maxPaymentPerTx() view returns (uint256)",
  "function paymentLimit24h() view returns (uint256)",
  "function strategies() view returns (address[])",
  "function isRecipient(address recipient) view returns (bool)",
  "function recipientCap(address recipient) view returns (uint256)",
  "function remainingDepositAllowance() view returns (uint256)",
  "function remainingPaymentAllowance() view returns (uint256)",
  "function depositToStrategy(address strategy, uint256 assets, uint256 minShares) returns (uint256 shares)",
  "function withdrawFromStrategy(address strategy, uint256 assets, uint256 maxShares) returns (uint256 shares)",
  "function redeemFromStrategy(address strategy, uint256 shares, uint256 minAssets) returns (uint256 assets)",
  "function redeemToOwner(address strategy, uint256 shares, uint256 minAssets) returns (uint256 assets)",
  "function transferToOwner(uint256 amount)",
  "function pay(address recipient, uint256 amount, bytes32 ref)",
  "function addRecipient(address recipient, uint256 maxPerPayment)",
  "function setRecipientCap(address recipient, uint256 maxPerPayment)",
  "function setLimits(uint256 maxDepositPerTx, uint256 depositLimit24h, uint256 maxPaymentPerTx, uint256 paymentLimit24h)",
  "function withdrawAll()",
  "event DepositedToStrategy(address indexed strategy, uint256 assets, uint256 shares)",
  "event WithdrawnFromStrategy(address indexed strategy, uint256 assets, uint256 shares)",
  "event RedeemedFromStrategy(address indexed strategy, uint256 shares, uint256 assets)",
  "event RedeemedToOwner(address indexed strategy, address indexed owner, uint256 shares, uint256 assets)",
  "event TransferredToOwner(address indexed owner, uint256 amount)",
  "event Payment(address indexed recipient, uint256 amount, bytes32 indexed ref)",
]);
export const strategyAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
]);

export type VaultLimits = { maxDepositPerTx: bigint; depositLimit24h: bigint; maxPaymentPerTx: bigint; paymentLimit24h: bigint };
/** The exact createVault arguments for this owner and agent (new vaults start without amount limits). */
export function vaultParams(owner: string, operator: string, limits: VaultLimits = VAULT_LIMITS) {
  return [getAddress(owner), getAddress(operator), { ...limits }, [...VAULT_STRATEGIES]] as const;
}
export function createVaultCall(owner: string, operator: string) {
  return { to: HODDIE_VAULT_FACTORY, data: encodeFunctionData({ abi: factoryAbi, functionName: "createVault", args: vaultParams(owner, operator) }), value: "0" } as const;
}
/** The owner's one call that removes the amount limits of an older vault. */
export function liftLimitsCall(vault: string) {
  return { to: getAddress(vault), data: encodeFunctionData({ abi: vaultAbi, functionName: "setLimits", args: [VAULT_NO_LIMIT, VAULT_NO_LIMIT, VAULT_NO_LIMIT, VAULT_NO_LIMIT] }), value: "0" } as const;
}
/** Bytes32 reference echoed in the Payment event, binding a payment to one bill. */
export const billRef = (obligationId: string) => keccak256(stringToHex(`hodd-bill:${obligationId}`));
const lessSlippage = (value: bigint) => value * (10_000n - VAULT_SLIPPAGE_BPS) / 10_000n;
const moreSlippage = (value: bigint) => (value * (10_000n + VAULT_SLIPPAGE_BPS) + 9_999n) / 10_000n;
export const minSharesFor = (preview: bigint) => { const min = lessSlippage(preview); return min > 0n ? min : 1n; };
export const maxSharesFor = (preview: bigint) => moreSlippage(preview);
export const minAssetsFor = (assets: bigint) => { const min = lessSlippage(assets); return min > 0n ? min : 1n; };

export type VaultCall = { to: `0x${string}`; data: Hex; value: "0" };
export type VaultInstruction =
  | { fn: "depositToStrategy"; strategy: `0x${string}`; assets: bigint; minShares: bigint }
  | { fn: "withdrawFromStrategy"; strategy: `0x${string}`; assets: bigint; maxShares: bigint }
  | { fn: "redeemFromStrategy"; strategy: `0x${string}`; shares: bigint; minAssets: bigint }
  | { fn: "redeemToOwner"; strategy: `0x${string}`; shares: bigint; minAssets: bigint }
  | { fn: "transferToOwner"; amount: bigint }
  | { fn: "pay"; recipient: `0x${string}`; amount: bigint; ref: Hex }
  // Moving what the custodial agent still holds into the owner's vault: plain ERC-20 transfers from the agent.
  | { fn: "moveShares"; amount: bigint }
  | { fn: "moveCash"; amount: bigint };
export function encodeVaultCall(vault: string, op: VaultInstruction): VaultCall {
  const to = getAddress(vault);
  switch (op.fn) {
    case "depositToStrategy": return { to, data: encodeFunctionData({ abi: vaultAbi, functionName: op.fn, args: [op.strategy, op.assets, op.minShares] }), value: "0" };
    case "withdrawFromStrategy": return { to, data: encodeFunctionData({ abi: vaultAbi, functionName: op.fn, args: [op.strategy, op.assets, op.maxShares] }), value: "0" };
    case "redeemFromStrategy": case "redeemToOwner": return { to, data: encodeFunctionData({ abi: vaultAbi, functionName: op.fn, args: [op.strategy, op.shares, op.minAssets] }), value: "0" };
    case "transferToOwner": return { to, data: encodeFunctionData({ abi: vaultAbi, functionName: op.fn, args: [op.amount] }), value: "0" };
    case "pay": return { to, data: encodeFunctionData({ abi: vaultAbi, functionName: op.fn, args: [op.recipient, op.amount, op.ref] }), value: "0" };
    case "moveShares": return { to: VAULT_MORPHO, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, op.amount] }), value: "0" };
    case "moveCash": return { to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, op.amount] }), value: "0" };
  }
}
/**
 * The operator call decoded back: only these six functions, only on this user's vault, only the Morpho vault or Hodd's
 * USYC pool as strategy (or a move of the agent's leftover Morpho shares or USDC into this vault).
 */
export function decodeVaultCall(vault: string, call: { to: string; data: string; value?: string }): VaultInstruction {
  if ((call.value ?? "0") !== "0") throw new Error("AGENT_VAULT_CALL_REFUSED");
  // A move into the vault: only a transfer of Morpho shares or USDC, and only to this vault.
  if (getAddress(call.to) === VAULT_MORPHO || getAddress(call.to) === ARC_TESTNET_USDC) {
    const move = decodeFunctionData({ abi: erc20Abi, data: call.data as Hex });
    if (move.functionName !== "transfer" || getAddress(move.args[0]) !== getAddress(vault)) throw new Error("AGENT_VAULT_CALL_REFUSED");
    return getAddress(call.to) === VAULT_MORPHO ? { fn: "moveShares", amount: move.args[1] } : { fn: "moveCash", amount: move.args[1] };
  }
  if (getAddress(call.to) !== getAddress(vault)) throw new Error("AGENT_VAULT_CALL_REFUSED");
  const decoded = decodeFunctionData({ abi: vaultAbi, data: call.data as Hex });
  const strategy = (value: unknown) => { const address = getAddress(String(value)); if (!(VAULT_STRATEGIES as readonly string[]).includes(address)) throw new Error("AGENT_VAULT_STRATEGY_REFUSED"); return address; };
  switch (decoded.functionName) {
    case "depositToStrategy": return { fn: decoded.functionName, strategy: strategy(decoded.args[0]), assets: decoded.args[1], minShares: decoded.args[2] };
    case "withdrawFromStrategy": return { fn: decoded.functionName, strategy: strategy(decoded.args[0]), assets: decoded.args[1], maxShares: decoded.args[2] };
    case "redeemFromStrategy": return { fn: decoded.functionName, strategy: strategy(decoded.args[0]), shares: decoded.args[1], minAssets: decoded.args[2] };
    case "redeemToOwner": return { fn: decoded.functionName, strategy: strategy(decoded.args[0]), shares: decoded.args[1], minAssets: decoded.args[2] };
    case "transferToOwner": return { fn: decoded.functionName, amount: decoded.args[0] };
    case "pay": return { fn: decoded.functionName, recipient: getAddress(decoded.args[0]), amount: decoded.args[1], ref: decoded.args[2] };
    default: throw new Error("AGENT_VAULT_CALL_REFUSED");
  }
}

export type VaultConfig = { owner: `0x${string}`; operator: `0x${string}`; paused: boolean; asset: `0x${string}`; limits: VaultLimits; strategies: `0x${string}`[] };
/**
 * Anyone can create a vault that names a user as owner with other settings, but Hodd only ever uses the address the
 * factory derives from its own parameters for this user and agent (or the one stored for them). That vault must still
 * have this owner, operator and asset, and allow both strategies. Its amount limits are the owner's to set.
 */
export function vaultMatches(config: VaultConfig, owner: string, operator: string) {
  const same = (a: string, b: string) => getAddress(a) === getAddress(b);
  return same(config.owner, owner) && same(config.operator, operator) && same(config.asset, ARC_TESTNET_USDC)
    && VAULT_STRATEGIES.every((strategy) => config.strategies.some((item) => same(item, strategy)));
}

type Log = TransactionReceipt["logs"][number];
const fromVault = (logs: readonly Log[], vault: string) => logs.filter((log) => getAddress(log.address) === getAddress(vault)).flatMap((log) => {
  try { return [decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics })]; } catch { return []; }
});
/**
 * What a verified operator call did, from the vault's own events (and, for a payment, the USDC transfer the recipient
 * received). Throws unless the receipt shows exactly the instruction that was signed.
 */
export function verifyVaultReceipt(receipt: Pick<TransactionReceipt, "logs" | "status">, vault: string, owner: string, op: VaultInstruction, agent?: string) {
  if (receipt.status !== "success") throw new Error("AGENT_VAULT_REVERTED");
  const events = fromVault(receipt.logs, vault);
  const one = <T,>(found: T[]) => { if (found.length !== 1) throw new Error("AGENT_VAULT_EVENT_MISMATCH"); return found[0]; };
  switch (op.fn) {
    case "moveShares": case "moveCash": {
      const token = op.fn === "moveShares" ? VAULT_MORPHO : ARC_TESTNET_USDC;
      if (!agent) throw new Error("AGENT_VAULT_EVENT_MISMATCH");
      one(receipt.logs.flatMap((log) => {
        if (getAddress(log.address) !== token) return [];
        try { const t = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics }); return t.eventName === "Transfer" && getAddress(t.args.from) === getAddress(agent) && getAddress(t.args.to) === getAddress(vault) && t.args.value === op.amount ? [log] : []; } catch { return []; }
      }));
      return { assetsMinor: op.fn === "moveCash" ? op.amount : 0n, shares: op.fn === "moveShares" ? op.amount : 0n };
    }
    case "depositToStrategy": {
      const e = one(events.flatMap((item) => item.eventName === "DepositedToStrategy" ? [item.args] : []));
      if (getAddress(e.strategy) !== op.strategy || e.assets !== op.assets || e.shares < op.minShares) throw new Error("AGENT_VAULT_EVENT_MISMATCH");
      return { assetsMinor: e.assets, shares: e.shares };
    }
    case "withdrawFromStrategy": {
      const e = one(events.flatMap((item) => item.eventName === "WithdrawnFromStrategy" ? [item.args] : []));
      if (getAddress(e.strategy) !== op.strategy || e.assets !== op.assets || e.shares > op.maxShares) throw new Error("AGENT_VAULT_EVENT_MISMATCH");
      return { assetsMinor: e.assets, shares: e.shares };
    }
    case "redeemFromStrategy": {
      const e = one(events.flatMap((item) => item.eventName === "RedeemedFromStrategy" ? [item.args] : []));
      if (getAddress(e.strategy) !== op.strategy || e.shares !== op.shares || e.assets < op.minAssets) throw new Error("AGENT_VAULT_EVENT_MISMATCH");
      return { assetsMinor: e.assets, shares: e.shares };
    }
    case "redeemToOwner": {
      const e = one(events.flatMap((item) => item.eventName === "RedeemedToOwner" ? [item.args] : []));
      if (getAddress(e.strategy) !== op.strategy || getAddress(e.owner) !== getAddress(owner) || e.shares !== op.shares || e.assets < op.minAssets) throw new Error("AGENT_VAULT_EVENT_MISMATCH");
      return { assetsMinor: e.assets, shares: e.shares };
    }
    case "transferToOwner": {
      const e = one(events.flatMap((item) => item.eventName === "TransferredToOwner" ? [item.args] : []));
      if (getAddress(e.owner) !== getAddress(owner) || e.amount !== op.amount) throw new Error("AGENT_VAULT_EVENT_MISMATCH");
      return { assetsMinor: e.amount, shares: 0n };
    }
    case "pay": {
      const e = one(events.flatMap((item) => item.eventName === "Payment" ? [item.args] : []));
      if (getAddress(e.recipient) !== op.recipient || e.amount !== op.amount || e.ref.toLowerCase() !== op.ref.toLowerCase()) throw new Error("AGENT_VAULT_EVENT_MISMATCH");
      // The canonical USDC transfer the recipient received: its log index is the payment's receipt reference.
      const transfer = one(receipt.logs.flatMap((log) => {
        if (getAddress(log.address) !== ARC_TESTNET_USDC) return [];
        try { const t = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics }); return t.eventName === "Transfer" && getAddress(t.args.from) === getAddress(vault) && getAddress(t.args.to) === op.recipient && t.args.value === op.amount ? [log] : []; } catch { return []; }
      }));
      return { assetsMinor: e.amount, shares: 0n, logIndex: transfer.logIndex ?? 0 };
    }
  }
}
