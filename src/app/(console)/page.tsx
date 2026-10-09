"use client";

import { isExecutionAvailable } from "@/lib/earn/access-policy";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { AllocationBar, RunwayChart } from "@/components/charts";
import { DemoNotice, Kpi, KpiGrid, MoneyValue, PageBody, PageHeader, PolicyPill, SectionCard, SectionHeading, StatusPill, buttonClass, labelClass } from "@/components/primitives";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { PolicyPanel } from "@/components/policy-panel";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";
import { WalletPanel } from "@/components/wallet-panel";
import { AgentRequests } from "@/components/agent-requests";
import { getProtectedObligations } from "@/lib/treasury/engine";
import { formatDate, formatMoney, formatPercentFromBps } from "@/lib/treasury/format";
import type { Money } from "@/lib/treasury/models";
import { allocationByLiquidity, runwayProjection } from "@/lib/treasury/views";

const monthDay: Intl.DateTimeFormatOptions = { year: undefined, month: "short", day: "numeric" };

/** The headline number: whole units large, cents and currency quiet. */
function HeroFigure({ money }: { money: Money }) {
  const text = formatMoney(money);
  const split = text.indexOf(".");
  return (
    <p className="mono mt-5 tabular-nums leading-none">
      <span className="text-[clamp(2.5rem,9vw,5.75rem)] font-medium tracking-[-0.06em]">{text.slice(0, split)}</span>
      <span className="text-[clamp(1rem,2.4vw,1.5rem)] text-white/45">{text.slice(split)}</span>
    </p>
  );
}

export default function PortfolioPage() {
  const { workspace, operationalWorkspace, assessment, walletState, earnState, hydrated, mode } = useTreasuryWorkspace();
  if (!assessment || !operationalWorkspace) return <>
    <PageHeader eyebrow="01 · Overview" title="Liquidity before yield." description="A deterministic treasury view that protects the next 30 days of obligations before capital becomes deployable." aside={<div className="min-w-56 border border-white/15 bg-white/[0.04] p-4"><p className="mono text-[9px] uppercase tracking-[0.16em] text-white/45">Treasury Engine</p><p className="mt-2 text-lg text-[#ff9a92]">Awaiting verified balance</p><div className="mt-2"><StatusPill label="PAUSED" tone="danger" /></div></div>} />
    <DemoNotice>Connect your own Arc Testnet wallet to see live USDC balances. Financial calculations wait for a verified balance.</DemoNotice>
    <PageBody><OnboardingChecklist /><div id="treasury-wallet"><WalletPanel /></div><AgentRequests /><div role="status" className="mt-6 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-5 text-sm text-[#ff9a92]">Financial metrics and allocation previews are unavailable while the authoritative treasury balance cannot be verified.</div></PageBody>
  </>;

  const evaluatedAt = new Date(assessment.evaluatedAt);
  const next = assessment.nextPayment;
  const feasibility = assessment.nextPaymentFeasibility;
  const alsoDue = getProtectedObligations(operationalWorkspace, evaluatedAt).filter((item) => item.id !== next?.id).slice(0, 4);
  const runway = runwayProjection(operationalWorkspace, evaluatedAt);
  const allocation = allocationByLiquidity(operationalWorkspace.strategies);
  const belowZero = runway.points.find((point) => point.day === runway.firstBelowZeroDay);
  const belowBuffer = runway.points.find((point) => point.day === runway.firstBelowBufferDay);
  const integrationRows = workspace.integrations.map((item) => {
    if (item.name === "Morpho") {
      if (mode === "DEMO") return { ...item, label: "SAMPLE", tone: "neutral" as const, message: "Sample strategy data only. Exit demo to discover live Arc Testnet vaults." };
      if (earnState.status === "READY") return { ...item, label: earnState.portfolio.integration.execution.replaceAll("_", " "), tone: isExecutionAvailable(earnState.portfolio.integration.execution) ? "success" as const : "info" as const, message: earnState.portfolio.integration.message };
      if (earnState.status === "ERROR") return { ...item, label: "UNAVAILABLE", tone: "danger" as const, message: earnState.message };
      return { ...item, label: "SYNCING", tone: "info" as const, message: "Loading the verified Arc Earn allowlist." };
    }
    if (workspace.treasuryMode !== "ARC_TESTNET_WALLET" || (item.name !== "User wallet" && item.name !== "Arc Testnet")) return { ...item, label: item.status.replace("_", " "), tone: "neutral" as const };
    if (walletState.status === "READY") return { ...item, label: item.name === "Arc Testnet" ? "LIVE" : "USER CONTROLLED", tone: "success" as const, message: item.name === "User wallet" ? "The selected wallet is authoritative for this workspace. Hodd never combines balances across wallet choices." : `Live USDC verified at block ${walletState.snapshot.blockNumber} on Arc Testnet.` };
    if (walletState.status === "ERROR") return { ...item, label: "UNAVAILABLE", tone: "danger" as const, message: "The live Arc balance is unavailable, so Treasury Engine outputs are paused." };
    return { ...item, label: "SYNCING", tone: "info" as const, message: "Waiting for a verified Arc Testnet USDC snapshot." };
  });

  return <>
    <PageHeader eyebrow="01 · Overview" title="Liquidity before yield." description="A deterministic treasury view that protects the next 30 days of obligations before capital becomes deployable." aside={<div className="space-y-3"><div className="min-w-56 border border-white/15 bg-white/[0.04] p-4"><p className="mono text-[9px] uppercase tracking-[0.16em] text-white/45">Liquidity coverage</p><p className="mono mt-2 text-3xl text-[#9ec5f4]">{assessment.liquidityCoverageBps === null ? "No obligations" : formatPercentFromBps(assessment.liquidityCoverageBps)}</p><div className="mt-2"><StatusPill label={assessment.coverageStatus.replace("_", " ")} tone={assessment.coverageStatus === "SAFE" ? "success" : assessment.coverageStatus === "AT_RISK" ? "danger" : "warning"} /></div></div><PolicyPanel /></div>} />
    <DemoNotice>{hydrated ? mode === "LIVE" ? "Live Arc Testnet balances from your own wallet. Your wallet signs every transaction." : "Read-only demo · sample balances and bills · nothing is saved." : "Loading your treasury workspace…"}</DemoNotice>
    <PageBody>
      <OnboardingChecklist />
      {mode === "DEMO" ? <button disabled className={buttonClass.ghost}>Choose wallet · exit demo first</button> : <div id="treasury-wallet"><WalletPanel /></div>}
      {mode === "LIVE" && <AgentRequests />}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section aria-label="Total treasury" className="flex flex-col justify-between border border-white/[0.14] bg-[#101319] p-6 md:p-8">
          <div>
            <p className={labelClass}>Total treasury</p>
            <HeroFigure money={operationalWorkspace.totalTreasury} />
            <p className="mt-5 max-w-lg text-sm leading-6 text-white/55">{workspace.treasuryMode === "ARC_TESTNET_WALLET" ? "Liquid USDC + verified Morpho positions" : "Sample USDC balance"}. Obligations and the safety buffer are protected before anything is deployable.</p>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/10 pt-5">
            <StatusPill label={assessment.coverageStatus.replace("_", " ")} tone={assessment.coverageStatus === "SAFE" ? "success" : assessment.coverageStatus === "AT_RISK" ? "danger" : "warning"} />
            <span className={labelClass}>{assessment.violations.length === 0 ? "All liquidity policies pass" : `${assessment.violations.length} policy ${assessment.violations.length === 1 ? "issue" : "issues"} to review`}</span>
          </div>
        </section>

        <section aria-label="Next payment" className="relative overflow-hidden border border-white/25 bg-white/[0.04] p-6 backdrop-blur-sm md:p-8">
          <Image src="/brand/hodd-star-light.png" alt="" aria-hidden="true" width={480} height={480} className="pointer-events-none absolute -right-10 -top-10 size-48 opacity-35" />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <p className={labelClass}>Next payment</p>
              {next && <StatusPill label={feasibility?.status ?? "REVIEW"} tone={feasibility?.status === "SAFE" ? "success" : "danger"} />}
            </div>
            {next && feasibility ? <>
              <h2 className="disp mt-5 text-[clamp(1.25rem,3vw,1.75rem)]">{next.title}</h2>
              <p className="mt-2 text-sm text-white/55">{formatDate(next.dueAt)} · {next.recipient ?? "Recipient not provided"}</p>
              <MoneyValue money={next.amount} className="mt-6 block text-3xl font-medium tracking-[-0.04em]" />
              <dl className="mt-6 grid gap-4 border-t border-white/10 pt-5 sm:grid-cols-3">
                <div><dt className={labelClass}>Available after reserves</dt><dd><MoneyValue money={feasibility.availableAfterReserves} className="mt-2 block text-sm" /></dd></div>
                <div><dt className={labelClass}>Shortfall</dt><dd><MoneyValue money={feasibility.shortfall} className="mt-2 block text-sm" /></dd></div>
                <div><dt className={labelClass}>Funding sources</dt><dd className="mono mt-2 text-xs">{feasibility.steps.map((step) => step.source.replaceAll("_", " ")).join(" + ") || "None available"}</dd></div>
              </dl>
              <Link href="/obligations" className={`${buttonClass.ghost} mt-6`}>Review obligations <ArrowRight aria-hidden="true" className="size-3.5" /></Link>
            </> : <p className="mt-5 text-sm text-white/55">No protected obligations in the 30-day horizon.</p>}
          </div>
        </section>
      </div>

      <KpiGrid label="Treasury overview" className="mt-6">
        <Kpi label="Upcoming obligations" value={<MoneyValue money={assessment.upcomingObligations} compact />} detail="Active or overdue within 30 days" />
        <Kpi label="Protected capital" value={<MoneyValue money={assessment.protectedCapital} compact />} detail="Obligations + buffer + pending" />
        <Kpi label="Deployable capital" value={<MoneyValue money={assessment.deployableCapital} compact />} detail="Deterministic, never below zero" accent />
        <Kpi label="Safely available liquidity" value={<MoneyValue money={assessment.safelyAvailableLiquidity} compact />} detail="Liquid USDC + redeemable positions" />
      </KpiGrid>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <SectionCard>
          <SectionHeading index="01.1" title="Runway" description={`Treasury balance after each protected obligation falls due, over ${runway.horizonDays} days`} action={
            runway.firstBelowZeroDay !== null ? <StatusPill label="Below zero" tone="danger" /> : runway.firstBelowBufferDay !== null ? <StatusPill label="Below buffer" tone="warning" /> : <StatusPill label="Above buffer" tone="success" />
          } />
          <div className="p-5 md:p-6">
            <RunwayChart series={runway} />
            <p className="mt-4 text-xs leading-5 text-white/50">
              {belowZero ? `The balance falls below zero on ${formatDate(new Date(belowZero.at).toISOString(), monthDay)} if nothing changes.` : belowBuffer ? `The balance dips below the safety buffer on ${formatDate(new Date(belowBuffer.at).toISOString(), monthDay)}.` : `The balance stays above the safety buffer for the full ${runway.horizonDays} days.`} Projection only: it uses current balances and scheduled obligations, with no yield or new inflows.
            </p>
          </div>
        </SectionCard>
        <SectionCard>
          <SectionHeading index="01.2" title="Where the treasury sits" description="Held balances, most liquid first" />
          <div className="p-5 md:p-6"><AllocationBar rows={allocation} /></div>
          <Link href="/invest" className="flex items-center justify-between border-t border-white/[0.14] px-5 py-4 text-sm font-semibold hover:text-[#8fb0ff]">Open strategies <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard>
          <SectionHeading index="01.3" title="Also due" description="Protected obligations after the next payment" />
          {alsoDue.length === 0 ? <p className="p-5 text-sm text-white/55">Nothing else is due inside the horizon.</p> : (
            <ul className="divide-y divide-white/10">{alsoDue.map((item) => (
              <li key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-4 sm:grid-cols-[88px_1fr_auto_auto]">
                <span className={labelClass}>{formatDate(item.dueAt, monthDay)}</span>
                <span className="min-w-0 text-sm font-medium">{item.title}<span className="block text-xs font-normal text-white/50">{item.category} · {item.recipient ?? "No recipient"}</span></span>
                <MoneyValue money={item.amount} compact className="text-sm sm:text-right" />
                <span className="col-span-2 sm:col-span-1"><StatusPill label={item.status} tone={item.status === "OVERDUE" ? "danger" : "info"} /></span>
              </li>
            ))}</ul>
          )}
          <Link href="/obligations" className="flex items-center justify-between border-t border-white/[0.14] px-5 py-4 text-sm font-semibold hover:text-[#8fb0ff]">Open obligations <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </SectionCard>
        <SectionCard>
          <SectionHeading index="01.4" title="Policy result" description="Calculated from current workspace inputs" />
          <div className="space-y-3 p-5">
            {assessment.violations.length === 0
              ? <div className="border border-[#2fcf2f]/30 bg-[#2fcf2f]/10 p-4 text-sm text-[#7fe3a8]"><ShieldCheck aria-hidden="true" className="mb-3 size-5" />All current liquidity policies pass.</div>
              : assessment.violations.map((violation) => <div key={violation.code} className="border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-4 text-sm text-[#ff9a92]"><TriangleAlert aria-hidden="true" className="mb-2 size-4" /><strong>{violation.code.replaceAll("_", " ")}</strong><p className="mt-1 text-xs leading-5">{violation.message}</p></div>)}
            <dl className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
              <div><dt className={labelClass}>Safety buffer</dt><dd><MoneyValue money={workspace.policy.safetyBuffer} className="mt-2 block text-sm" /></dd></div>
              <div><dt className={labelClass}>Coverage floor</dt><dd className="mono mt-2 text-sm">{formatPercentFromBps(workspace.policy.minimumLiquidityCoverageBps)}</dd></div>
            </dl>
          </div>
          <Link href="/policy" className="flex items-center justify-between border-t border-white/[0.14] px-5 py-4 text-sm font-semibold hover:text-[#8fb0ff]">Read the full policy <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard>
          <SectionHeading index="01.5" title="Recent activity" description="Local audit records are distinct from confirmed onchain receipts" />
          <div className="divide-y divide-white/10">{workspace.activities.slice(0, 3).map((entry) => (
            <article key={entry.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{entry.action}</h3><StatusPill label={entry.execution.replace("_", " ")} /></div>
              <p className="mt-2 text-xs leading-5 text-white/55">{entry.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"><span className={labelClass}>{entry.actor} · {formatDate(entry.occurredAt, { year: undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><PolicyPill policy={entry.policy} /></div>
              {entry.explorerUrl && <a href={entry.explorerUrl} target="_blank" rel="noreferrer" className="mono mt-3 inline-block text-[10px] text-[#8fb0ff] underline">View confirmed receipt</a>}
            </article>
          ))}</div>
          <Link href="/activity" className="flex items-center justify-between border-t border-white/[0.14] px-5 py-4 text-sm font-semibold hover:text-[#8fb0ff]">Open audit view <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </SectionCard>
        <SectionCard>
          <SectionHeading index="01.6" title="Integration boundaries" description="Arc Testnet balances ? wallet-approved transactions" />
          <div className="divide-y divide-white/10">{integrationRows.map((item) => (
            <article key={item.name} className="p-5">
              <div className="flex justify-between gap-3"><h3 className="text-sm font-semibold">{item.name}</h3><StatusPill label={item.label} tone={item.tone} /></div>
              <p className="mt-2 text-xs leading-5 text-white/55">{item.message}</p>
            </article>
          ))}</div>
        </SectionCard>
      </div>
    </PageBody>
  </>;
}
