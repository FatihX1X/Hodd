/**
 * Morpho proposals made in Hoddie chat. The Treasury Engine sets the limits (deployable capital
 * and the policy cap for Morpho); the model only picks an operation and an amount inside them.
 * Nothing here signs or submits anything: the user still reviews a fresh server quote and signs
 * with their own wallet in the normal Earn dialog.
 */
import type { EarnOperation, EarnPortfolioResponse, EarnPosition, EarnVault } from "@/lib/earn/models";
import { formatMoney } from "@/lib/treasury/format";
import { minMoney, moneyToInput, multiplyBps, parseMoneyInput, subtractMoneyFloor } from "@/lib/treasury/money";
import type { Money, TreasuryAssessment, TreasuryWorkspace } from "@/lib/treasury/models";

export type EarnContext = Readonly<{ workspace: TreasuryWorkspace; operationalWorkspace: TreasuryWorkspace | null; assessment: TreasuryAssessment | null; portfolio: EarnPortfolioResponse | null }>;
export type EarnChange = Readonly<{ operation: EarnOperation; amount?: string; vaultAddress?: string }>;
export type EarnPlan = Readonly<{ operation: EarnOperation; vault: EarnVault; position?: EarnPosition; limit: Money; amount: Money | null; lines: string[] }>;

const zero = (template: Money): Money => ({ ...template, minorUnits: "0" });
const positive = (money: Money | null | undefined) => Boolean(money) && BigInt(money!.minorUnits) > 0n;
const verb = { DEPOSIT: "Deposit", WITHDRAW: "Withdraw", REDEEM_ALL: "Redeem all" } as const;

/** Largest deposit the engine allows now: deployable capital, capped by the room left under the Morpho policy cap. Same rule as the Strategies page. */
export function morphoDepositLimit({ workspace, operationalWorkspace, assessment }: EarnContext): Money | null {
  const morpho = operationalWorkspace?.strategies.find((strategy) => strategy.kind === "MORPHO");
  if (!operationalWorkspace || !assessment || !morpho) return null;
  if (!workspace.policy.enabledStrategies.MORPHO) return zero(assessment.deployableCapital);
  return minMoney(assessment.deployableCapital, subtractMoneyFloor(multiplyBps(operationalWorkspace.totalTreasury, workspace.policy.strategyCapsBps.MORPHO), morpho.balance));
}

export function writesEnabled(portfolio: EarnPortfolioResponse | null) { return portfolio?.integration.execution === "LOCAL_ENABLED"; }

/** Resolves a proposed Morpho operation against live vaults, positions and the engine's limits. Throws a readable Error when it is not allowed. */
export function planEarn(context: EarnContext, change: EarnChange): EarnPlan {
  const { portfolio } = context;
  if (!portfolio) throw new Error("Morpho vaults are not loaded. Connect your wallet, refresh, then ask again.");
  const depositLimit = morphoDepositLimit(context);
  if (!depositLimit) throw new Error("Treasury figures are paused, so no Morpho operation can be prepared.");
  const wanted = change.vaultAddress?.toLowerCase();
  const vault = wanted ? portfolio.vaults.find((item) => item.address.toLowerCase() === wanted) : portfolio.vaults[0];
  if (!vault) throw new Error(wanted ? "That vault is not on the verified allowlist." : "No verified Morpho vault is available.");
  const position = portfolio.positions.find((item) => item.vaultAddress.toLowerCase() === vault.address.toLowerCase());
  const { operation } = change;

  let limit: Money; let amount: Money | null = null;
  if (operation === "DEPOSIT") {
    if (vault.status !== "ACTIVE") throw new Error(`${vault.name} is low on liquidity, so deposits are paused.`);
    limit = depositLimit;
    if (!positive(limit)) throw new Error("Nothing is deployable under the current policy, so there is nothing to put into Morpho.");
  } else {
    if (position?.liquidityStatus !== "READY" || !positive(position.redeemable)) throw new Error("There is no redeemable Morpho position to withdraw from.");
    limit = position.redeemable;
  }
  if (operation !== "REDEEM_ALL") {
    if (!change.amount) throw new Error("An amount is required.");
    amount = parseMoneyInput(change.amount);
    if (BigInt(amount.minorUnits) > BigInt(limit.minorUnits)) throw new Error(`That is above the limit the Treasury Engine allows right now: at most ${formatMoney(limit)}.`);
  }
  const what = operation === "REDEEM_ALL" ? `${verb[operation]} from ${vault.name}` : `${verb[operation]} ${formatMoney(amount!)} ${operation === "DEPOSIT" ? "into" : "from"} ${vault.name}`;
  return { operation, vault, position, limit, amount, lines: [what, `Treasury Engine limit: ${formatMoney(limit)}`, "Next: a fresh server quote, then your own wallet signature."] };
}

/** Read-only Morpho context for the language service. Public vault addresses only; never the user's wallet address. */
export function earnSnapshot(context: EarnContext) {
  const { portfolio } = context;
  if (!portfolio) return null;
  const limit = morphoDepositLimit(context);
  return {
    writesEnabled: writesEnabled(portfolio),
    depositLimit: limit ? moneyToInput(limit) : null,
    vaults: portfolio.vaults.map((vault) => ({ address: vault.address, name: vault.name, status: vault.status, apyPercent: vault.apyBps / 100 })),
    positions: portfolio.positions.map((position) => ({ vaultAddress: position.vaultAddress, balance: moneyToInput(position.currentBalance), redeemable: position.liquidityStatus === "READY" ? moneyToInput(position.redeemable) : null })),
  };
}
