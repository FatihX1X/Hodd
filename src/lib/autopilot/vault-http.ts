import "server-only";
import { decodeEventLog, encodeFunctionData, erc20Abi, getAddress } from "viem";
import { EarnAccessError } from "@/lib/earn/security";
import { arcClient, discoverAllowedVaults } from "@/lib/earn/gateway";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { boundedArcGasPrice, bufferedEarnGasLimit } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import type { TreasuryWorkspace } from "@/lib/treasury/models";
import { agentDb } from "./store";
import type { AgentWallet } from "./models";
import { createVaultCall, HODDIE_VAULT_FACTORY, liftLimitsCall, limitsLifted, VAULT_STRATEGIES, vaultAbi } from "./vault";
import { predictLegacyVault, predictVault, readRecipients, readVaultFunds, vaultDeployed, verifiedVault } from "./vault-state";
import { vaultBillPlan, VAULT_PAY_WINDOW_MS } from "./vault-decision";
import { vaultInputs } from "./vault-runner";

/** The agent wallet pays the operator calls' network fees in USDC: Invest tops it up to this when it is below the floor. */
export const AGENT_GAS_FLOAT_MINOR = 500_000n;
export const AGENT_GAS_FLOOR_MINOR = 200_000n;
const usdcText = (minor: bigint) => (Number(minor > 0n ? minor : 0n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
const minorOf = (wei: bigint) => BigInt(nativeWeiToUsdcCeil(wei.toString()).minorUnits);
type Call = { to: `0x${string}`; data: `0x${string}`; value: "0" };
export type OwnerCall = { kind: "CREATE_VAULT" | "AGENT_GAS" | "FUND" | "APPROVE_BILL" | "WITHDRAW_ALL" | "LIFT_LIMITS"; call: Call; gasBudgetWei: string; gasCeiling: { gasLimit: string; gasPriceWei: string }; amountMinor: string };

/** A call the owner's wallet signs, with a server-estimated gas ceiling (the browser never simulates it). */
async function ownerCall(owner: `0x${string}`, kind: OwnerCall["kind"], call: Call, amountMinor = 0n): Promise<OwnerCall> {
  let gas: bigint, price: bigint;
  try { [gas, price] = await Promise.all([arcClient.estimateGas({ account: owner, to: call.to, data: call.data, value: 0n }), arcClient.getGasPrice().then(boundedArcGasPrice)]); }
  catch { throw new EarnAccessError("AGENT_VAULT_CALL_WOULD_FAIL", "Arc Testnet says this vault step would be rejected right now. Nothing was sent.", 409); }
  const gasLimit = bufferedEarnGasLimit(gas);
  return { kind, call, gasBudgetWei: (gasLimit * price).toString(), gasCeiling: { gasLimit: gasLimit.toString(), gasPriceWei: price.toString() }, amountMinor: amountMinor.toString() };
}
const transfer = (to: string, amount: bigint): Call => ({ to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(to), amount] }), value: "0" });
const usdcBalance = (address: string) => arcClient.readContract({ address: ARC_TESTNET_USDC, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)] });

/**
 * The vault this owner and agent use: the stored one, else the current parameters' address if it exists, else one
 * already created with the earlier limits, else the current address (created with the next Invest).
 */
export async function ownerVault(wallet: AgentWallet) {
  const owner = getAddress(wallet.owner_address), agent = getAddress(wallet.address);
  let address = wallet.vault_address ? getAddress(wallet.vault_address) : null;
  // The current parameters first: anyone can create the older vault for an owner, and it must not shadow a new one.
  if (!address) { const current = await predictVault(owner, agent); address = current; if (!(await vaultDeployed(current))) { const legacy = await predictLegacyVault(owner, agent); if (await vaultDeployed(legacy)) address = legacy; } }
  const deployed = await vaultDeployed(address);
  if (deployed) await verifiedVault(address, owner, agent);
  return { address, deployed, owner, agent };
}

/** Records the vault once it exists with exactly the predicted settings. */
export async function registerVault(wallet: AgentWallet) {
  if (wallet.vault_address) return getAddress(wallet.vault_address);
  const vault = await ownerVault(wallet);
  if (!vault.deployed) return null;
  const { error } = await agentDb().from("agent_wallets").update({ vault_address: vault.address.toLowerCase() }).eq("user_id", wallet.user_id).is("vault_address", null);
  if (error) throw new Error("AGENT_WALLET_STORE_UNAVAILABLE");
  return vault.address;
}

/**
 * One tap Invest in vault mode: create the vault if it does not exist yet, keep a little USDC with the agent for its
 * network fees, and send the amount into the vault. The owner signs each call; nothing is held by Hodd.
 */
export async function vaultInvestCalls(wallet: AgentWallet, amount: bigint) {
  const vault = await ownerVault(wallet);
  const [ownerBalance, agentCash] = await Promise.all([usdcBalance(vault.owner), usdcBalance(vault.agent)]);
  const calls: OwnerCall[] = [];
  if (!vault.deployed) calls.push(await ownerCall(vault.owner, "CREATE_VAULT", createVaultCall(vault.owner, vault.agent)));
  if (agentCash < AGENT_GAS_FLOOR_MINOR) calls.push(await ownerCall(vault.owner, "AGENT_GAS", transfer(vault.agent, AGENT_GAS_FLOAT_MINOR - agentCash), AGENT_GAS_FLOAT_MINOR - agentCash));
  const fund = await ownerCall(vault.owner, "FUND", transfer(vault.address, amount), amount);
  calls.push(fund);
  const needed = calls.reduce((sum, item) => sum + BigInt(item.amountMinor) + minorOf(BigInt(item.gasBudgetWei)), 0n);
  if (ownerBalance < needed) throw new EarnAccessError("AGENT_FUNDS_INSUFFICIENT", `Your wallet has ${usdcText(ownerBalance)} USDC on Arc Testnet; this needs about ${usdcText(needed)} USDC including the vault setup and network fees. Choose a smaller amount. Nothing was sent.`, 400);
  let holdings = 0n;
  if (vault.deployed) { const morpho = (await discoverAllowedVaults())[0]; const funds = await readVaultFunds(vault.address, morpho); holdings = BigInt(funds.idle.balance.minorUnits) + BigInt(funds.position.currentBalance.minorUnits) + (funds.usyc?.valueMinor ?? 0n); }
  return { vaultAddress: vault.address, calls, fund, holdingsMinor: holdings };
}

/** Did the owner's transfer reach the vault? Registers the vault on the way when it now exists. */
export async function vaultFundingStatus(wallet: AgentWallet, txHash: `0x${string}`) {
  const vault = await ownerVault(wallet);
  let receipt; try { receipt = await arcClient.getTransactionReceipt({ hash: txHash }); } catch { return { status: "PENDING" as const }; }
  if (receipt.status !== "success") return { status: "REVERTED" as const };
  const arrived = receipt.logs.reduce((sum, log) => {
    if (getAddress(log.address) !== ARC_TESTNET_USDC) return sum;
    try { const e = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics }); return e.eventName === "Transfer" && getAddress(e.args.from) === vault.owner && getAddress(e.args.to) === vault.address ? sum + e.args.value : sum; } catch { return sum; }
  }, 0n);
  if (arrived === 0n) return { status: "UNRELATED" as const };
  if (!vault.deployed) return { status: "VAULT_NOT_DEPLOYED" as const, amountMinor: arrived.toString() };
  await registerVault(wallet);
  return { status: "ARRIVED" as const, amountMinor: arrived.toString() };
}

/**
 * Owner-only vault calls: approve a bill's recipient (cap = the bill amount), remove an older vault's amount limits,
 * or take everything back.
 */
export async function vaultOwnerAction(wallet: AgentWallet, workspace: TreasuryWorkspace, input: { op: "approve-bill"; obligationId: string } | { op: "withdraw-all" } | { op: "lift-limits" }) {
  if (!wallet.vault_address) throw new EarnAccessError("AGENT_VAULT_NOT_DEPLOYED", "Invest once to create your Autopilot vault first.", 409);
  const vault = getAddress(wallet.vault_address), owner = getAddress(wallet.owner_address);
  const config = await verifiedVault(vault, owner, wallet.address);
  if (input.op === "withdraw-all") return { status: "READY" as const, call: await ownerCall(owner, "WITHDRAW_ALL", { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "withdrawAll" }), value: "0" }) };
  if (input.op === "lift-limits") return limitsLifted(config.limits) ? { status: "ALREADY" as const } : { status: "READY" as const, call: await ownerCall(owner, "LIFT_LIMITS", liftLimitsCall(vault)) };
  const bill = workspace.obligations.find((item) => item.id === input.obligationId && (item.status === "UPCOMING" || item.status === "OVERDUE"));
  if (!bill) throw new EarnAccessError("AGENT_BILL_UNAVAILABLE", "That bill is not open any more.", 404);
  if (!bill.recipientAddress) throw new EarnAccessError("AGENT_BILL_NO_RECIPIENT", "Add the recipient's Arc address to this bill first.", 409);
  const amount = BigInt(bill.amount.minorUnits), recipient = getAddress(bill.recipientAddress);
  if (amount > config.limits.maxPaymentPerTx) throw new EarnAccessError("AGENT_BILL_OVER_LIMIT", `Your vault pays at most ${usdcText(config.limits.maxPaymentPerTx)} USDC per bill. Remove the vault's amount limits first, or pay this one yourself.`, 409);
  const current = (await readRecipients(vault, [recipient])).get(recipient)!;
  if (current.approved && current.capMinor >= amount) return { status: "ALREADY" as const };
  const data = current.approved ? encodeFunctionData({ abi: vaultAbi, functionName: "setRecipientCap", args: [recipient, amount] }) : encodeFunctionData({ abi: vaultAbi, functionName: "addRecipient", args: [recipient, amount] });
  return { status: "READY" as const, call: await ownerCall(owner, "APPROVE_BILL", { to: vault, data, value: "0" }) };
}

/** What the Autopilot page shows about the vault: balances in each strategy, contract limits, and who pays each bill. */
export async function vaultView(wallet: AgentWallet, now = new Date()) {
  if (!wallet.vault_address) {
    const vault = await ownerVault(wallet).catch(() => null);
    return { vault: vault ? { address: vault.address, deployed: vault.deployed, factory: HODDIE_VAULT_FACTORY } : null, balances: null, bills: [], needsYou: [] as { code: string; message: string }[] };
  }
  const v = await vaultInputs(wallet.user_id);
  const horizon = now.getTime() + v.workspace.policy.planningHorizonDays * 86_400_000;
  const bills = v.bills.filter((bill) => bill.obligation.status === "OVERDUE" || Date.parse(bill.obligation.dueAt) <= horizon).map((bill) => {
    const plan = vaultBillPlan(bill, v.config.limits.maxPaymentPerTx);
    return { id: bill.obligation.id, title: bill.obligation.title, amountMinor: bill.obligation.amount.minorUnits, dueAt: bill.obligation.dueAt, recipient: bill.obligation.recipientAddress ?? null, capMinor: bill.capMinor.toString(), plan, payFrom: plan === "PAYS" ? new Date(Math.max(now.getTime(), Date.parse(bill.obligation.dueAt) - VAULT_PAY_WINDOW_MS)).toISOString() : null };
  });
  const needsYou: { code: string; message: string }[] = [];
  const unapproved = bills.filter((bill) => bill.plan === "NEEDS_APPROVAL" || bill.plan === "CAP_TOO_LOW");
  if (unapproved.length) needsYou.push({ code: "APPROVE_BILLS", message: `${unapproved.length === 1 ? "One bill needs" : `${unapproved.length} bills need`} your approval before Autopilot can pay ${unapproved.length === 1 ? "it" : "them"}.` });
  if (BigInt(v.cash.balance.minorUnits) < BigInt(v.feeReserveMinor)) needsYou.push({ code: "AGENT_GAS", message: "The agent wallet is out of network-fee money. Invest again (it tops it up) or send it a few cents." });
  // A payment the owner started elsewhere and left open blocks the ledger, and with it every Autopilot bill payment.
  const ownerOpen = v.activePayments.filter((row) => row.rail !== "AUTOPILOT_VAULT");
  if (ownerOpen.length) needsYou.push({ code: "OPEN_PAYMENT", message: ownerOpen.some((row) => row.state === "UNKNOWN") ? "A payment you started on Obligations has an unknown outcome. Resolve it there (Check again, or tell Hodd you closed the wallet request); Autopilot pays no bill until then." : "A payment you started on Obligations is still open. Autopilot pays bills once it finishes." });
  if (v.config.paused) needsYou.push({ code: "VAULT_PAUSED", message: "Your vault is paused. Autopilot cannot act until you unpause it." });
  const lifted = limitsLifted(v.config.limits);
  if (!lifted) needsYou.push({ code: "LIFT_LIMITS", message: "Your vault still has the old amount limits (at most 1,000 USDC per deposit or payment, 2,000 a day). Remove them with one signature under Your vault: Autopilot is then limited only by where it can send money." });
  return {
    vault: { address: v.vaultAddress, deployed: true, factory: HODDIE_VAULT_FACTORY, paused: v.config.paused, limitsLifted: lifted, limits: { maxDepositPerTxMinor: v.config.limits.maxDepositPerTx.toString(), depositLimit24hMinor: v.config.limits.depositLimit24h.toString(), maxPaymentPerTxMinor: v.config.limits.maxPaymentPerTx.toString(), paymentLimit24hMinor: v.config.limits.paymentLimit24h.toString() }, strategies: [...VAULT_STRATEGIES], depositRoomMinor: v.funds.depositRoomMinor.toString(), paymentRoomMinor: v.funds.paymentRoomMinor.toString(), agentGasMinor: v.cash.balance.minorUnits },
    balances: { cashMinor: v.funds.idle.balance.minorUnits, positionMinor: v.funds.position.currentBalance.minorUnits, redeemableMinor: v.funds.position.redeemable.minorUnits, usycMinor: (v.funds.usyc?.valueMinor ?? 0n).toString(), usycRedeemableMinor: (v.funds.usyc?.redeemableMinor ?? 0n).toString(), usycAvailable: Boolean(v.funds.usyc?.ready), morphoApyBps: v.apy.morphoBps, usycApyBps: v.apy.usycBps, observedAt: v.funds.idle.observedAt },
    bills, needsYou,
  };
}
