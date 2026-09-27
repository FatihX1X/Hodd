import { ArrowRight, Clock3, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { DemoNotice, MoneyValue, PageHeader, PolicyPill, SectionCard, SectionHeading, StatusPill } from "@/components/primitives";
import { formatDate, formatPercentFromBps } from "@/lib/treasury/format";
import { getTreasuryRepository } from "@/lib/treasury/repository";

export default async function PortfolioPage() {
  const repository = getTreasuryRepository();
  const [portfolio, obligations, activities, decisions, integrations] = await Promise.all([
    repository.getPortfolio(),
    repository.listObligations(),
    repository.listActivities(),
    repository.listAgentDecisions(),
    repository.listIntegrations(),
  ]);
  const nextPayment = obligations.find((item) => item.id === portfolio.nextPaymentId)!;

  const metrics = [
    { label: "Total treasury", value: <MoneyValue money={portfolio.totalTreasury} compact />, detail: "Single Arc USDC balance view", accent: true },
    { label: "Upcoming obligations", value: <MoneyValue money={portfolio.upcomingObligations} compact />, detail: "2 active · 1 draft" },
    { label: "Safety buffer", value: <MoneyValue money={portfolio.safetyBuffer} compact />, detail: "Protected sample reserve" },
    { label: "Deployable capital", value: <MoneyValue money={portfolio.deployableCapital} compact />, detail: "Fixture value · not executable" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="01 · Portfolio"
        title="Liquidity before yield."
        description="A read-only treasury view that keeps upcoming payments visible before any capital is considered for investment."
        aside={
          <div className="min-w-52 border border-white/15 bg-white/[0.04] p-4">
            <p className="mono text-[9px] uppercase tracking-[0.16em] text-white/40">Liquidity coverage</p>
            <p className="mono mt-2 text-3xl text-[#b7f3cf]">{formatPercentFromBps(portfolio.liquidityCoverageBps)}</p>
            <p className="mt-1 text-xs text-white/45">Demo fixture · not a live calculation</p>
          </div>
        }
      />
      <DemoNotice />

      <div className="metric-grid mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-10 lg:py-10">
        <section aria-labelledby="treasury-overview" className="grid border-l border-t border-black/15 sm:grid-cols-2 xl:grid-cols-4">
          <h2 id="treasury-overview" className="sr-only">Treasury overview</h2>
          {metrics.map((metric) => (
            <article key={metric.label} className="min-h-36 border-b border-r border-black/15 bg-[#fffdf7] p-5">
              <p className="mono text-[9px] uppercase tracking-[0.16em] text-black/45">{metric.label}</p>
              <p className={`mt-5 text-3xl font-medium tracking-[-0.05em] ${metric.accent ? "text-[#164b32]" : ""}`}>{metric.value}</p>
              <p className="mt-3 text-xs text-black/45">{metric.detail}</p>
            </article>
          ))}
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <SectionCard>
            <SectionHeading index="01.1" title="Next payment" description="Nearest active obligation in the sample ledger" action={<StatusPill label={portfolio.nextPaymentStatus} tone="success" />} />
            <div className="grid gap-8 p-5 sm:grid-cols-[1fr_auto] sm:items-end md:p-7">
              <div>
                <p className="text-2xl font-medium tracking-[-0.04em]">{nextPayment.title}</p>
                <p className="mt-2 text-sm text-black/50">{formatDate(nextPayment.dueAt)} · {nextPayment.recipient}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <StatusPill label={nextPayment.priority} tone="warning" />
                  <StatusPill label="No execution connected" />
                </div>
              </div>
              <div className="sm:text-right">
                <MoneyValue money={nextPayment.amount} className="text-3xl font-medium tracking-[-0.04em]" />
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#164b32]"><ShieldCheck aria-hidden="true" className="size-3.5" />Covered in sample data</p>
              </div>
            </div>
            <div className="grid border-t border-black/15 sm:grid-cols-3">
              {[
                ["Liquid USDC", "10,000.00"],
                ["Protected minimum", "5,500.00"],
                ["Pending transactions", "0.00"],
              ].map(([label, value]) => <div key={label} className="border-b border-black/15 px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><p className="text-[10px] uppercase tracking-[0.13em] text-black/40">{label}</p><p className="mono mt-1.5 text-sm">{value} USDC</p></div>)}
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeading index="01.2" title="Current allocation" description="Before any proposal is approved" />
            <div className="p-5 md:p-7">
              <div className="flex items-center gap-7">
                <div className="grid size-32 shrink-0 place-items-center rounded-full" style={{ background: "conic-gradient(#8be0b1 0deg 360deg)" }} aria-label="Liquid USDC allocation: 100 percent">
                  <div className="grid size-20 place-items-center rounded-full bg-[#fffdf7] text-center"><span className="mono text-xl">100%</span></div>
                </div>
                <div>
                  <p className="text-sm font-semibold">Liquid USDC</p>
                  <p className="mt-2 text-xs leading-5 text-black/50">No sample investment has been executed. Proposed target allocations live in the Invest preview.</p>
                </div>
              </div>
              <Link href="/invest" className="mt-7 flex items-center justify-between border-t border-black/15 pt-4 text-sm font-semibold hover:text-[#164b32]">Review investment workspace <ArrowRight aria-hidden="true" className="size-4" /></Link>
            </div>
          </SectionCard>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <SectionCard>
            <SectionHeading index="01.3" title="Agent decisions" description="Explanations only; deterministic engines are not implemented" action={<Sparkles aria-hidden="true" className="size-4 text-black/35" />} />
            <div className="divide-y divide-black/10">
              {decisions.map((decision) => (
                <article key={decision.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{decision.title}</h3><PolicyPill policy={decision.policy} /></div>
                  <p className="mt-2 text-sm leading-6 text-black/65">{decision.summary}</p>
                  <p className="mt-3 border-l-2 border-black/15 pl-3 text-xs leading-5 text-black/45">{decision.rationale}</p>
                </article>
              ))}
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeading index="01.4" title="Recent activity" description="Every sample record exposes its origin and execution state" />
            <div className="divide-y divide-black/10">
              {activities.slice(0, 3).map((activity) => (
                <article key={activity.id} className="grid grid-cols-[auto_1fr] gap-4 p-5">
                  <span className="mt-1 grid size-8 place-items-center border border-black/15 bg-black/[0.03]">
                    {activity.actor === "AGENT" ? <Sparkles aria-hidden="true" className="size-3.5" /> : activity.actor === "HUMAN" ? <LockKeyhole aria-hidden="true" className="size-3.5" /> : <Clock3 aria-hidden="true" className="size-3.5" />}
                  </span>
                  <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{activity.action}</h3><StatusPill label={activity.execution.replace("_", " ")} /></div><p className="mt-1 text-xs leading-5 text-black/50">{activity.summary}</p></div>
                </article>
              ))}
            </div>
            <Link href="/activity" className="flex items-center justify-between border-t border-black/15 px-5 py-4 text-sm font-semibold hover:text-[#164b32]">Open full audit view <ArrowRight aria-hidden="true" className="size-4" /></Link>
          </SectionCard>
        </div>

        <SectionCard className="mt-6">
          <SectionHeading index="01.5" title="Integration boundaries" description="The interface states where the demo stops" />
          <div className="grid md:grid-cols-3">
            {integrations.map((integration) => (
              <article key={integration.name} className="border-b border-black/15 p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
                <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{integration.name}</h3><StatusPill label={integration.status.replace("_", " ")} tone="neutral" /></div>
                <p className="mt-3 text-xs leading-5 text-black/50">{integration.message}</p>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
