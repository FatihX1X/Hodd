"use client";

import Image from "next/image";
import Link from "next/link";
import { Activity, ArrowRight, CalendarClock, ShieldCheck, TriangleAlert } from "lucide-react";
import { RunwayChart } from "@/components/charts";
import { TreasuryNotice, MoneyValue, PageBody, PageHeader, PolicyPill, SectionCard, SectionHeading, StatusPill, buttonClass, labelClass } from "@/components/primitives";
import { Figure, InfoTip, Reservoir, Ring, Spark, moneyColor, type ReservoirPart } from "@/components/visuals";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { PolicyPanel } from "@/components/policy-panel";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";
import { WalletPanel } from "@/components/wallet-panel";
import { AgentRequests } from "@/components/agent-requests";
import { UnifiedBalancePanel } from "@/components/unified-balance-panel";
import { getProtectedObligations } from "@/lib/treasury/engine";
import { formatDate, formatMoney, formatPercentFromBps } from "@/lib/treasury/format";
import type { Money, StrategyKind } from "@/lib/treasury/models";
import { runwayProjection } from "@/lib/treasury/views";

const monthDay: Intl.DateTimeFormatOptions = { year: undefined, month: "short", day: "numeric" };
const DAY = 86_400_000;
const ratio = (part: Money, whole: Money) => { const w = Number(BigInt(whole.minorUnits)); return w > 0 ? Number(BigInt(part.minorUnits)) / w : null; };
const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
const sourceLabel: Record<string, string> = { LIQUID_USDC: "Liquid USDC", MORPHO: "Morpho", USYC: "USYC", BTC_CREDIT: "BTC credit", BTC_SALE: "BTC sale" };
const holdingLabel: Record<StrategyKind, string> = { LIQUID: "Liquid USDC", MORPHO: "Morpho", USYC: "USYC", BTC_RESERVE: "BTC reserve" };

/** The headline number: whole units large, cents and currency quiet. */
function HeroFigure({ money }: { money: Money }) {
  const text = formatMoney(money);
  const split = text.indexOf(".");
  return (
    <p className="mono tabular-nums leading-none">
      <span className="text-[clamp(2.5rem,8vw,5rem)] font-medium tracking-[-0.06em]">{text.slice(0, split)}</span>
      <span className="text-[clamp(1rem,2.4vw,1.5rem)] text-white/45">{text.slice(split)}</span>
    </p>
  );
}

/** A due date as a small calendar leaf: month above, the day large. */
function DateLeaf({ iso, tone }: { iso: string; tone?: string }) {
  const date = new Date(iso);
  return (
    <span aria-hidden="true" className="grid w-12 shrink-0 grid-rows-[auto_1fr] border border-white/15 text-center">
      <span className="bg-white/[0.06] py-0.5 text-[10px] text-white/60" style={tone ? { color: tone } : undefined}>{date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</span>
      <span className="mono py-1 text-lg leading-6 tabular-nums">{date.getUTCDate()}</span>
    </span>
  );
}

function CoverageRing({ bps, status }: { bps: number | null; status: string }) {
  const color = status === "SAFE" ? moneyColor.safe : status === "AT_RISK" ? moneyColor.danger : moneyColor.protected;
  return (
    <div className="flex items-center gap-4 border border-white/15 bg-white/[0.04] p-4">
      <Ring ratio={bps === null ? 1 : bps / 20_000} label={`Liquidity coverage ${bps === null ? "not needed, no obligations" : formatPercentFromBps(bps)}`} color={color} size={76}>
        <span className="mono text-[13px] tabular-nums">{bps === null ? "—" : formatPercentFromBps(bps)}</span>
      </Ring>
      <div>
        <p className="flex items-center gap-1 text-[12px] text-white/55">Liquidity coverage<InfoTip label="About liquidity coverage">Liquid USDC and safely redeemable positions against what is protected. The ring is full at 200%.</InfoTip></p>
        <p className="mt-1 text-lg">{bps === null ? "No obligations" : status === "SAFE" ? "Covered" : status === "AT_RISK" ? "At risk" : "Tight"}</p>
        <div className="mt-1"><StatusPill label={status.replace("_", " ")} tone={status === "SAFE" ? "success" : status === "AT_RISK" ? "danger" : "warning"} /></div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { workspace, operationalWorkspace, assessment, mode, autopilotActive } = useTreasuryWorkspace();
  if (!assessment || !operationalWorkspace) return <>
    <PageHeader eyebrow="01 · Overview" title="Liquidity before yield." description="Bills come first. Hodd shows what must stay liquid and what can work for you." aside={<div className="flex min-w-56 items-center gap-3 border border-white/15 bg-white/[0.04] p-4"><TriangleAlert aria-hidden="true" className="size-5 text-[#ff9a92]" /><div><p className="text-[12px] text-white/55">Treasury Engine</p><p className="mt-1 text-lg text-[#ff9a92]">Awaiting verified balance</p><div className="mt-1"><StatusPill label="PAUSED" tone="danger" /></div></div></div>} />
    <TreasuryNotice>Connect your own Arc Testnet wallet to see live USDC balances. Financial calculations wait for a verified balance.</TreasuryNotice>
    <PageBody><OnboardingChecklist /><div id="treasury-wallet"><WalletPanel /></div><AgentRequests /><UnifiedBalancePanel /><div role="status" className="mt-6 flex items-start gap-3 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-5 text-sm text-[#ff9a92]"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Financial metrics and allocation previews are unavailable while the authoritative treasury balance cannot be verified.</div></PageBody>
  </>;

  const evaluatedAt = new Date(assessment.evaluatedAt);
  const next = assessment.nextPayment;
  const feasibility = assessment.nextPaymentFeasibility;
  const alsoDue = getProtectedObligations(operationalWorkspace, evaluatedAt, { autopilotActive }).filter((item) => item.id !== next?.id).slice(0, 4);
  const runway = runwayProjection(operationalWorkspace, evaluatedAt);
  const belowZero = runway.points.find((point) => point.day === runway.firstBelowZeroDay);
  const belowBuffer = runway.points.find((point) => point.day === runway.firstBelowBufferDay);
  const parts: ReservoirPart[] = (["LIQUID", "MORPHO", "USYC", "BTC_RESERVE"] as const).flatMap((kind) => {
    const held = operationalWorkspace.strategies.filter((strategy) => strategy.kind === kind);
    if (!held.length) return [];
    const minor = held.reduce((sum, strategy) => sum + BigInt(strategy.balance.minorUnits), 0n);
    if (kind !== "LIQUID" && minor === 0n) return [];
    return [{ key: kind, label: holdingLabel[kind], money: { ...operationalWorkspace.totalTreasury, minorUnits: minor.toString() }, color: moneyColor[kind] }];
  });
  const daysToNext = next ? Math.max(0, Math.ceil((Date.parse(next.dueAt) - evaluatedAt.getTime()) / DAY)) : null;
  const runwayState = runway.firstBelowZeroDay !== null ? { label: "Below zero", tone: "danger" as const } : runway.firstBelowBufferDay !== null ? { label: "Below buffer", tone: "warning" as const } : { label: "Above buffer", tone: "success" as const };

  return <>
    <PageHeader eyebrow="01 · Overview" title="Liquidity before yield." description="Bills come first. Hodd shows what must stay liquid and what can work for you." aside={<div className="flex flex-col gap-3 sm:flex-row sm:items-stretch md:flex-col"><CoverageRing bps={assessment.liquidityCoverageBps} status={assessment.coverageStatus} /><PolicyPanel /></div>} />
    <PageBody>
      <OnboardingChecklist />
      <div id="treasury-wallet"><WalletPanel /></div>
      {mode === "LIVE" && <AgentRequests />}
      {mode === "LIVE" && <UnifiedBalancePanel />}

      <section aria-label="Total treasury" className="mt-6 border border-white/[0.14] bg-[#101319] p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-1 text-[13px] text-white/55">Total treasury<InfoTip label="About the total">{workspace.treasuryMode === "ARC_TESTNET_WALLET" ? "Liquid USDC + verified Morpho and USYC positions" : "Wallet not connected"}. Obligations and the safety buffer are protected before anything is deployable.</InfoTip></p>
            <div className="mt-3"><HeroFigure money={operationalWorkspace.totalTreasury} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <StatusPill label={assessment.coverageStatus.replace("_", " ")} tone={assessment.coverageStatus === "SAFE" ? "success" : assessment.coverageStatus === "AT_RISK" ? "danger" : "warning"} />
            <span className="inline-flex items-center gap-1.5 text-[13px] text-white/60">{assessment.violations.length === 0 ? <><ShieldCheck aria-hidden="true" className="size-4 text-[#7fe3a8]" />All liquidity policies pass</> : <><TriangleAlert aria-hidden="true" className="size-4 text-[#ff9a92]" />{assessment.violations.length} policy {assessment.violations.length === 1 ? "issue" : "issues"} to review</>}</span>
          </div>
        </div>
        <div className="mt-8"><Reservoir parts={parts} total={operationalWorkspace.totalTreasury} protectedMoney={assessment.protectedCapital} deployable={assessment.deployableCapital} /></div>
        <Link href="/invest" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/80 hover:text-[#8fb0ff]">Open Invest <ArrowRight aria-hidden="true" className="size-4" /></Link>
      </section>

      <section aria-label="Treasury overview" className="mt-6 grid gap-px border border-white/[0.14] bg-white/[0.14] sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Protected obligations" value={<MoneyValue money={assessment.upcomingObligations} compact />} tip={<>Bills within {assessment.protectionLeadDays} days, or unsafe to fund from Morpho. Planned within {workspace.policy.planningHorizonDays} days: {formatMoney(assessment.plannedObligations)}. Bills unsafe to fund from Morpho are kept liquid automatically.</>} visual={<CalendarClock aria-hidden="true" className="size-6 text-[#e9b949]" />} />
        <Figure label="Protected capital" value={<MoneyValue money={assessment.protectedCapital} compact />} tip="Obligations + safety buffer + pending transactions." tone={moneyColor.protected} visual={<Ring ratio={ratio(assessment.protectedCapital, operationalWorkspace.totalTreasury)} label="Protected share of the treasury" color={moneyColor.protected} size={48} stroke={5} />} />
        <Figure label="Deployable capital" value={<MoneyValue money={assessment.deployableCapital} compact />} tip="Deterministic and never below zero: what is left after protected capital." tone={moneyColor.deployable} visual={<Ring ratio={ratio(assessment.deployableCapital, operationalWorkspace.totalTreasury)} label="Deployable share of the treasury" color={moneyColor.deployable} size={48} stroke={5} />} />
        <Figure label="Safely available liquidity" value={<MoneyValue money={assessment.safelyAvailableLiquidity} compact />} tip="Liquid USDC + positions that can be redeemed safely right now." visual={<Spark values={runway.points.map((point) => point.value)} marker={runway.buffer} label={`Runway trend over ${runway.horizonDays} days`} width={84} height={30} color={moneyColor.LIQUID} />} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <SectionCard>
          <SectionHeading title="Runway" description={`Balance after each bill, next ${runway.horizonDays} days`} action={<StatusPill label={runwayState.label} tone={runwayState.tone} />} />
          <div className="p-5 md:p-6">
            <RunwayChart series={runway} />
            <p className="mt-4 flex items-center gap-1 text-[12px] leading-5 text-white/50">
              {belowZero ? `The balance falls below zero on ${formatDate(new Date(belowZero.at).toISOString(), monthDay)} if nothing changes.` : belowBuffer ? `The balance dips below the safety buffer on ${formatDate(new Date(belowBuffer.at).toISOString(), monthDay)}.` : `The balance stays above the safety buffer for the full ${runway.horizonDays} days.`}
              <InfoTip label="About the projection">Projection only: it uses current balances and scheduled obligations, with no yield or new inflows.</InfoTip>
            </p>
          </div>
        </SectionCard>

        <section aria-label="Next payment" className="relative overflow-hidden border border-white/25 bg-white/[0.04] p-6 md:p-7">
          <Image src="/brand/hodd-star-light.png" alt="" aria-hidden="true" width={480} height={480} className="pointer-events-none absolute -right-10 -top-10 size-44 opacity-25" />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[13px] text-white/55">Next payment</p>
              {next && <StatusPill label={feasibility?.status ?? "REVIEW"} tone={feasibility?.status === "SAFE" ? "success" : "danger"} />}
            </div>
            {next && feasibility ? <>
              <div className="mt-5 flex items-center gap-5">
                <Ring ratio={daysToNext === null ? 0 : 1 - Math.min(daysToNext, assessment.protectionLeadDays) / Math.max(assessment.protectionLeadDays, 1)} label={`${daysToNext} days until ${next.title} is due`} color={feasibility.status === "SAFE" ? moneyColor.safe : moneyColor.danger} size={84}>
                  <span className="leading-none"><span className="mono block text-xl tabular-nums">{daysToNext}</span><span className="text-[10px] text-white/55">{daysToNext === 1 ? "day" : "days"}</span></span>
                </Ring>
                <div className="min-w-0">
                  <h2 className="disp text-[clamp(1.15rem,2.6vw,1.5rem)]">{next.title}</h2>
                  <p className="mt-1 text-[13px] text-white/55">{formatDate(next.dueAt)}{next.recipient ? `, ${next.recipient}` : ""}</p>
                  <MoneyValue money={next.amount} className="mt-2 block text-2xl font-medium tracking-[-0.04em]" />
                </div>
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5">
                <div><dt className={labelClass}>Available after reserves</dt><dd><MoneyValue money={feasibility.availableAfterReserves} className="mt-1 block text-sm" /></dd></div>
                <div><dt className={labelClass}>Shortfall</dt><dd><MoneyValue money={feasibility.shortfall} className="mt-1 block text-sm" /></dd></div>
                <div className="col-span-2"><dt className={labelClass}>Funding sources</dt><dd className="mt-2 flex flex-wrap gap-1.5">{feasibility.steps.length ? feasibility.steps.map((step) => <span key={step.source} className="inline-flex items-center gap-1.5 border border-white/15 px-2 py-1 text-[12px]"><span aria-hidden="true" className="size-2" style={{ background: step.source === "LIQUID_USDC" ? moneyColor.LIQUID : step.source === "MORPHO" ? moneyColor.MORPHO : step.source === "USYC" ? moneyColor.USYC : moneyColor.BTC_RESERVE }} />{sourceLabel[step.source] ?? sentence(step.source)}</span>) : <span className="text-[12px] text-white/55">None available</span>}</dd></div>
              </dl>
              <Link href="/obligations" className={`${buttonClass.ghost} mt-6`}>Review obligations <ArrowRight aria-hidden="true" className="size-3.5" /></Link>
            </> : <p className="mt-5 flex items-center gap-2 text-sm text-white/55"><ShieldCheck aria-hidden="true" className="size-4 text-[#7fe3a8]" />No bills currently require protection.</p>}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard>
          <SectionHeading icon={<CalendarClock className="size-4" />} title="Also due" description="Protected bills after the next payment" />
          {alsoDue.length === 0 ? <p className="p-5 text-sm text-white/55">No other bills currently require protection.</p> : (
            <ul className="divide-y divide-white/10">{alsoDue.map((item) => (
              <li key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                <DateLeaf iso={item.dueAt} tone={item.status === "OVERDUE" ? moneyColor.danger : undefined} />
                <span className="min-w-0 flex-1 text-sm font-medium">{item.title}<span className="block text-[12px] font-normal text-white/50">{sentence(item.category)}{item.recipient ? `, ${item.recipient}` : ""}</span></span>
                <span className="text-right"><MoneyValue money={item.amount} compact className="block text-sm" /><StatusPill label={item.status} tone={item.status === "OVERDUE" ? "danger" : "info"} /></span>
              </li>
            ))}</ul>
          )}
          <Link href="/obligations" className="flex min-h-11 items-center justify-between border-t border-white/[0.14] px-5 py-3 text-sm font-semibold hover:text-[#8fb0ff]">Open obligations <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </SectionCard>
        <SectionCard>
          <SectionHeading icon={<ShieldCheck className="size-4" />} title="Policy result" description="From your current inputs" />
          <div className="space-y-3 p-5">
            {assessment.violations.length === 0
              ? <div className="flex items-center gap-3 border border-[#2fcf2f]/30 bg-[#2fcf2f]/10 p-4 text-sm text-[#7fe3a8]"><ShieldCheck aria-hidden="true" className="size-5 shrink-0" />All current liquidity policies pass.</div>
              : assessment.violations.map((violation) => <div key={violation.code} className="flex items-start gap-3 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-4 text-sm text-[#ff9a92]"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div><strong>{violation.code.replaceAll("_", " ")}</strong><p className="mt-1 text-xs leading-5">{violation.message}</p></div></div>)}
            <dl className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
              <div><dt className={labelClass}>Safety buffer</dt><dd><MoneyValue money={workspace.policy.safetyBuffer} className="mt-1 block text-sm" /></dd></div>
              <div><dt className={labelClass}>Coverage floor</dt><dd className="mono mt-1 text-sm">{formatPercentFromBps(workspace.policy.minimumLiquidityCoverageBps)}</dd></div>
            </dl>
          </div>
          <Link href="/policy" className="flex min-h-11 items-center justify-between border-t border-white/[0.14] px-5 py-3 text-sm font-semibold hover:text-[#8fb0ff]">Read the full policy <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard>
          <SectionHeading icon={<Activity className="size-4" />} title="Recent activity" description="Local records, separate from onchain receipts" />
          <ol className="m-0 grid list-none lg:grid-cols-3">
            {workspace.activities.slice(0, 3).map((entry) => (
              <li key={entry.id} className="border-b border-white/10 p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
                <span aria-hidden="true" className="mb-3 block size-2.5 rounded-full" style={{ background: entry.policy.status === "PASS" ? moneyColor.safe : entry.policy.status === "BLOCKED" ? moneyColor.danger : moneyColor.deployable }} />
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{entry.action}</h3><StatusPill label={entry.execution.replace("_", " ")} /></div>
                <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-white/55">{entry.summary}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1"><span className={labelClass}>{entry.actor.toLowerCase()}, {formatDate(entry.occurredAt, { year: undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><PolicyPill policy={entry.policy} /></div>
                {entry.explorerUrl && <a href={entry.explorerUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12px] text-[#8fb0ff] underline">View confirmed receipt</a>}
              </li>
            ))}
          </ol>
          <Link href="/activity" className="flex min-h-11 items-center justify-between border-t border-white/[0.14] px-5 py-3 text-sm font-semibold hover:text-[#8fb0ff]">Open audit view <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </SectionCard>
      </div>
    </PageBody>
  </>;
}
