"use client";

import { isExecutionAvailable } from "@/lib/earn/access-policy";
import { useState } from "react";
import clsx from "clsx";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ListChecks, LockKeyhole, Save, Scale, ShieldCheck, Target, TriangleAlert, Vault, Wallet, X } from "lucide-react";
import { LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { MoneyValue, PageBody, SectionCard, SectionHeading, StatusPill, buttonClass, inputClass, labelClass } from "./primitives";
import { StrategyTable } from "./strategy-table";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { InfoTip, Reservoir, Ring, moneyColor, type ReservoirPart } from "./visuals";
import { formatMoney, formatPercentFromBps } from "@/lib/treasury/format";
import { minMoney, multiplyBps, subtractMoneyFloor } from "@/lib/treasury/money";
import type { Money, StrategyKind } from "@/lib/treasury/models";
import { allocationByLiquidity, strategyColor, usdcNumber } from "@/lib/treasury/views";
import { EarnOperationDialog } from "./earn-operation-dialog";
import { UsycPoolCard } from "./usyc-pool-card";

const labels: Record<StrategyKind, string> = { LIQUID: "Liquid USDC", MORPHO: "Morpho", USYC: "USYC", BTC_RESERVE: "BTC Reserve" };
const EASE = [0.19, 1, 0.22, 1] as const;
const zero: Money = { currency: "USDC", decimals: 6, minorUnits: "0" };
const ratioOf = (part: Money, whole: Money) => { const w = usdcNumber(whole); return w > 0 ? usdcNumber(part) / w : null; };
const percent = (ratio: number | null) => ratio === null ? "—" : ratio > 0 && ratio < 0.01 ? "<1%" : `${Math.round(Math.min(ratio, 1) * 100)}%`;

/** A stacked band whose segments follow their values; it moves only in answer to what the user changes. */
function StackBar({ segments, label, className }: { segments: readonly { key: string; color: string; share: number }[]; label: string; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <LazyMotion features={domAnimation} strict>
      <div role="img" aria-label={label} className={clsx("flex h-3 w-full overflow-hidden bg-white/[0.08]", className)}>
        {segments.map((segment) => <m.div key={segment.key} className="h-full shrink-0" style={{ background: segment.color }} initial={false} animate={{ width: `${Math.max(0, Math.min(segment.share, 1)) * 100}%` }} transition={{ duration: reduced ? 0 : 0.35, ease: EASE }} />)}
      </div>
    </LazyMotion>
  );
}

export function InvestmentWorkspace() {
  const { workspace, operationalWorkspace, assessment, allocationPlan, earnState, updateTargets, storageIssue, readOnly, mode } = useTreasuryWorkspace();
  const [targets, setTargets] = useState<Record<StrategyKind, string>>(Object.fromEntries(Object.entries(workspace.targetAllocationsBps).map(([key, value]) => [key, String(value / 100)])) as Record<StrategyKind, string>);
  const [error, setError] = useState("");
  const saveTargets = (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const values = Object.fromEntries(Object.entries(targets).map(([key, value]) => [key, Number(value)])) as Record<StrategyKind, number>;
    if (mode === "LIVE") { values.USYC = 0; values.BTC_RESERVE = 0; }
    if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0 || value > 100)) return setError("Each target must be between 0 and 100");
    if (Object.values(values).reduce((sum, value) => sum + value, 0) !== 100) return setError("Target allocations must total exactly 100%");
    updateTargets(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Math.round(value * 100)])) as Record<StrategyKind, number>);
  };
  if (!assessment || !allocationPlan || !operationalWorkspace) return <PageBody><SectionCard><SectionHeading icon={<Wallet className="size-4" />} title="Allocation preview unavailable" description="A fresh Arc Testnet balance is required" /><div role="status" className="p-5 text-sm leading-6 text-white/65">Connect your own Arc Testnet wallet from Overview. Live balances are required before investment planning.</div></SectionCard></PageBody>;
  const morpho = operationalWorkspace.strategies.find((strategy) => strategy.kind === "MORPHO")!;
  const morphoCap = multiplyBps(operationalWorkspace.totalTreasury, workspace.policy.strategyCapsBps.MORPHO);
  const depositLimit = minMoney(assessment.deployableCapital, subtractMoneyFloor(morphoCap, morpho.balance));
  const portfolio = earnState.status === "READY" ? earnState.portfolio : null;
  // The server still independently enforces the loopback/origin/flag boundary.
  const executionEnabled = portfolio ? isExecutionAvailable(portfolio.integration.execution) : false;

  // The targets as they would be saved: what is typed, with unsupported strategies held at zero on Arc Testnet.
  const lockedKind = (kind: StrategyKind) => mode === "LIVE" && (kind === "USYC" || kind === "BTC_RESERVE");
  const kinds = Object.keys(labels) as StrategyKind[];
  const typedTarget = (kind: StrategyKind) => { if (lockedKind(kind)) return 0; const value = Number(targets[kind]); return Number.isFinite(value) && value > 0 ? value : 0; };
  const targetTotal = kinds.reduce((sum, kind) => sum + typedTarget(kind), 0);
  const targetsFit = Math.abs(targetTotal - 100) < 1e-9;
  const targetSummary = `Target mix: ${kinds.map((kind) => `${labels[kind]} ${typedTarget(kind)}%`).join(", ")}. Total ${targetTotal}%.`;

  // The treasury as it sits today, most liquid first, for the band in the side column.
  const heldRows = allocationByLiquidity(operationalWorkspace.strategies);
  const heldParts: ReservoirPart[] = heldRows.map((row) => ({ key: row.id, label: row.name, money: operationalWorkspace.strategies.find((strategy) => strategy.id === row.id)!.balance, color: row.color }));
  const deployableRatio = ratioOf(assessment.deployableCapital, operationalWorkspace.totalTreasury);

  // The engine plan as one band: protected, each approved line, then the liquid remainder.
  const planTotal = usdcNumber(assessment.protectedCapital) + allocationPlan.lines.reduce((sum, line) => sum + usdcNumber(line.approved), 0) + usdcNumber(allocationPlan.unallocatedToLiquid);
  const planShare = (money: Money) => planTotal > 0 ? usdcNumber(money) / planTotal : 0;
  const planSegments = [
    { key: "protected", color: moneyColor.protected, share: planShare(assessment.protectedCapital) },
    ...allocationPlan.lines.map((line) => ({ key: line.strategy, color: strategyColor[line.strategy], share: planShare(line.approved) })),
    { key: "liquid", color: strategyColor.LIQUID, share: planShare(allocationPlan.unallocatedToLiquid) },
  ];

  return <PageBody><div className="space-y-6"><StrategyTable workspace={operationalWorkspace} strategies={operationalWorkspace.strategies} /><div className="grid gap-6 lg:grid-cols-[1fr_340px]">
    <div className="space-y-6"><SectionCard><SectionHeading icon={<Vault className="size-4" />} title="Verified Morpho vaults" action={<div className="flex items-center gap-2"><StatusPill label={portfolio ? portfolio.integration.execution.replaceAll("_", " ") : earnState.status} tone={executionEnabled ? "success" : earnState.status === "ERROR" ? "danger" : "info"} /><InfoTip label="About these vaults">Live Circle App Kit discovery. Only vaults on the server allowlist are listed.</InfoTip></div>} />{portfolio ? <div className="divide-y divide-white/10">{portfolio.vaults.map((vault) => {
      const position = portfolio.positions.find((item) => item.vaultAddress.toLowerCase() === vault.address.toLowerCase());
      const withdrawLimit = position?.liquidityStatus === "READY" ? position.redeemable : zero;
      const held = position?.currentBalance ?? zero;
      const pnl = position?.pnl;
      return <article key={vault.address} aria-label={vault.name} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span aria-hidden="true" className="size-3 shrink-0 rounded-[2px]" style={{ background: moneyColor.MORPHO }} /><h3 className="text-lg font-medium">{vault.name}</h3><StatusPill label={vault.status.replace("_", " ")} tone={vault.status === "ACTIVE" ? "success" : "warning"} /></div>
            <p className={clsx("mt-2 flex items-center gap-1 text-[12px]", vault.circleGuarded ? "text-[#7fe3a8]" : "text-white/55")}>
              <ShieldCheck aria-hidden="true" className="size-3.5" />{vault.circleGuarded ? "Sentinel covered" : "Sentinel not covering"}
              <InfoTip label="About this vault"><span className="block">Verified at block {vault.verifiedBlock}. Circle Sentinel: {vault.circleGuarded ? "covered" : "not covered"}.</span><span className="mono mt-2 block break-all text-[10px] text-white/55">{vault.address}</span></InfoTip>
            </p>
          </div>
          <div className="flex gap-8">
            <div><p className={labelClass}>Current APY</p><p className="mono mt-1 text-3xl tabular-nums tracking-[-0.03em]" style={{ color: moneyColor.MORPHO }}>{formatPercentFromBps(vault.apyBps, 2)}</p></div>
            <div><p className={labelClass}>Liquidity</p><MoneyValue money={vault.liquidity} className="mt-2 block text-lg" /></div>
          </div>
        </div>
        <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-center gap-4">
            <Ring ratio={ratioOf(held, vault.liquidity)} label={`${vault.name}: your position as a share of the vault's liquidity`} color={moneyColor.MORPHO} size={80} stroke={7}><span className="mono text-[13px] tabular-nums">{percent(ratioOf(held, vault.liquidity))}</span></Ring>
            <div><p className={labelClass}>Your position</p><MoneyValue money={held} className="mt-1 block text-xl" /></div>
          </div>
          <div className="min-w-0">
            {position ? <dl className="grid grid-cols-3 gap-4 text-sm">
              <div><dt className={labelClass}>Redeemable</dt><dd className="mono mt-1 text-[13px] tabular-nums">{formatMoney(position.redeemable)}</dd></div>
              <div><dt className={labelClass}>P&amp;L</dt><dd className="mono mt-1 text-[13px] tabular-nums">{pnl?.status === "AVAILABLE" ? formatMoney({ ...pnl.totalYieldEarned }) : pnl?.status.toLowerCase()}</dd></div>
              <div><dt className={labelClass}>Shares</dt><dd className="mono mt-1 break-all text-[13px] tabular-nums">{position.shares}</dd></div>
            </dl> : <p className="text-xs text-white/55">{portfolio.integration.positionAccess === "READY" ? "No current position" : portfolio.integration.message}</p>}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <EarnOperationDialog operation="DEPOSIT" vault={vault} position={position} policyLimit={depositLimit} enabled={!readOnly && Boolean(executionEnabled)} />
          <EarnOperationDialog operation="WITHDRAW" vault={vault} position={position} policyLimit={withdrawLimit} enabled={!readOnly && Boolean(executionEnabled)} />
          <EarnOperationDialog operation="REDEEM_ALL" vault={vault} position={position} policyLimit={withdrawLimit} enabled={!readOnly && Boolean(executionEnabled)} />
          <span className="ml-auto text-xs text-white/55">Room to deposit <span className="mono tabular-nums text-white/85">{formatMoney(depositLimit)}</span></span>
        </div>
      </article>;
    })}</div> : <div role="status" className="p-5 text-sm text-white/60">{earnState.status === "ERROR" ? earnState.message : workspace.walletConnection ? "Loading verified Arc Earn vaults…" : "Connect your wallet to load verified Arc Earn vaults."}</div>}</SectionCard>
      <UsycPoolCard />
      <SectionCard><SectionHeading icon={<Target className="size-4" />} title="Target allocation" action={<InfoTip label="About targets">Targets apply only to deployable capital. Disabled or capped allocations remain Liquid USDC; they are never reassigned to a riskier strategy.</InfoTip>} /><form onSubmit={saveTargets} className="p-5">
        <StackBar label={targetSummary} segments={(() => { let left = 100; return kinds.map((kind) => { const take = Math.min(typedTarget(kind), left); left -= take; return { key: kind, color: strategyColor[kind], share: take / 100 }; }); })()} />
        <p className={clsx("mt-2 flex items-center gap-1.5 text-[12px]", targetsFit ? "text-[#7fe3a8]" : "text-[#ffd27f]")}>{targetsFit ? <Check aria-hidden="true" className="size-3.5" /> : <Scale aria-hidden="true" className="size-3.5" />}<span className="mono tabular-nums">{Number(targetTotal.toFixed(2))}%</span> of 100% assigned</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{kinds.map((kind) => <label key={kind} className={labelClass}><span className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: strategyColor[kind] }} />{labels[kind]} %</span><input aria-label={`${labels[kind]} target`} disabled={readOnly || lockedKind(kind)} value={lockedKind(kind) ? "0" : targets[kind]} onChange={(event) => setTargets((current) => ({ ...current, [kind]: event.target.value }))} inputMode="decimal" className={`${inputClass} mono disabled:opacity-50`} />{lockedKind(kind) && <span className="mt-2 block">{kind === "USYC" ? "You choose in the pool card" : "Not on Arc Testnet"}</span>}</label>)}</div>
        {error && <p role="alert" className="mt-4 flex items-start gap-2 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></p>}
        <div className="mt-5 flex justify-end"><button disabled={readOnly || Boolean(storageIssue)} className={buttonClass.ghost}><Save aria-hidden="true" className="size-4" />Save targets</button></div></form></SectionCard>
    </div>
    <aside className="space-y-6"><SectionCard><SectionHeading icon={<ShieldCheck className="size-4" />} title="Capital boundary" /><div className="flex items-center gap-5 p-5">
      <Ring ratio={deployableRatio} label="Deployable share of the treasury" color={moneyColor.deployable} size={92} stroke={8}><span className="mono text-base tabular-nums" style={{ color: moneyColor.deployable }}>{percent(deployableRatio)}</span></Ring>
      <dl className="min-w-0 space-y-3">
        <div><dt className={labelClass}>Treasury</dt><dd><MoneyValue money={operationalWorkspace.totalTreasury} className="block text-base" /></dd></div>
        <div><dt className={clsx(labelClass, "flex items-center gap-1.5")}><LockKeyhole aria-hidden="true" className="size-3" style={{ color: moneyColor.protected }} />Protected</dt><dd><MoneyValue money={assessment.protectedCapital} className="block text-base" /></dd></div>
        <div><dt className={labelClass} style={{ color: moneyColor.deployable }}>Deployable</dt><dd><MoneyValue money={assessment.deployableCapital} className="block text-base" /></dd></div>
      </dl></div></SectionCard>
      <SectionCard><SectionHeading title="Where the treasury sits" action={<InfoTip label="About this band">Held balances, most liquid first.</InfoTip>} /><div className="p-5">{heldParts.length ? <Reservoir parts={heldParts} total={operationalWorkspace.totalTreasury} protectedMoney={assessment.protectedCapital} deployable={assessment.deployableCapital} /> : <p className="text-sm text-white/55">No balance is held in any strategy.</p>}</div></SectionCard>
      <Dialog.Root><Dialog.Trigger asChild><button className={`${buttonClass.primary} w-full justify-between py-4`}>Preview engine plan <ListChecks aria-hidden="true" className="size-4" /></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="investment-preview-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] shadow-2xl focus:outline-none"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.14] bg-[#101319] px-5 py-4"><Dialog.Title className="disp text-lg">Allocation plan</Dialog.Title><Dialog.Close aria-label="Close investment preview" className="grid size-11 place-items-center border border-white/[0.14]"><X className="size-4" /></Dialog.Close></div><Dialog.Description id="investment-preview-description" className="flex items-center gap-1 px-5 pt-4 text-sm leading-6 text-white/65">A preview only. Nothing is created or sent.<InfoTip label="About this plan">Calculated from deployable capital, strategy availability and policy caps. No proposal or transaction is created.</InfoTip></Dialog.Description>
        <div className="px-5 pt-4"><StackBar label={`Plan: protected ${formatMoney(assessment.protectedCapital)}, ${allocationPlan.lines.map((line) => `${labels[line.strategy]} ${formatMoney(line.approved)}`).join(", ")}, liquid remainder ${formatMoney(allocationPlan.unallocatedToLiquid)}`} segments={planSegments} /></div>
        <div className="m-5 border border-white/[0.14]"><div className="border-b border-white/[0.14] bg-white/[0.03] p-4"><div className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole aria-hidden="true" className="size-4" style={{ color: moneyColor.protected }} />Protected capital</div><MoneyValue money={assessment.protectedCapital} className="mt-2 block text-2xl" /></div>{allocationPlan.lines.map((line) => { const reduced = BigInt(line.approved.minorUnits) < BigInt(line.requested.minorUnits); return <div key={line.strategy} className="border-b border-white/10 p-4"><div className="flex items-center justify-between gap-4"><p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: strategyColor[line.strategy] }} />{labels[line.strategy]}<InfoTip label={`Why ${labels[line.strategy]} is planned this way`}>{line.reason}</InfoTip></p><MoneyValue money={line.approved} className="text-xs" /></div><p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-white/55"><span>Requested <MoneyValue money={line.requested} /></span>{reduced && <StatusPill label="Reduced" tone="warning" />}</p>{reduced && <p className="mt-1 text-xs leading-5 text-[#ffd27f]">{line.reason}</p>}</div>; })}<div className="p-4"><div className="flex items-center justify-between"><p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: strategyColor.LIQUID }} />Liquid remainder</p><MoneyValue money={allocationPlan.unallocatedToLiquid} className="text-xs" /></div></div></div><div className="mx-5"><StatusPill label={allocationPlan.status} tone={allocationPlan.status === "PASS" ? "success" : "warning"} /><p className="mt-3 text-xs leading-5 text-white/60">{allocationPlan.violations.map((item) => item.message).join(" ") || "All requested allocations fit the current policy."}</p></div><div className="p-5"><button disabled className="w-full cursor-not-allowed border border-white/[0.14] bg-white/5 px-5 py-4 text-sm font-semibold text-white/45">Preview only. Use a vault action to transact.</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    </aside>
  </div></div></PageBody>;
}
