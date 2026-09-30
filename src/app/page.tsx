"use client";

import { ArrowRight, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { DemoNotice, MoneyValue, PageHeader, SectionCard, SectionHeading, StatusPill } from "@/components/primitives";
import { PolicyPanel } from "@/components/policy-panel";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";
import { WalletPanel } from "@/components/wallet-panel";
import { formatDate, formatPercentFromBps } from "@/lib/treasury/format";

export default function PortfolioPage() {
  const { workspace, operationalWorkspace, assessment, walletState, earnState, hydrated } = useTreasuryWorkspace();
  if (!assessment || !operationalWorkspace) return <>
    <PageHeader eyebrow="01 · Portfolio" title="Liquidity before yield." description="A deterministic treasury view that protects the next 30 days of obligations before capital becomes deployable." aside={<div className="min-w-56 border border-white/15 bg-white/[0.04] p-4"><p className="mono text-[9px] uppercase tracking-[0.16em] text-white/40">Treasury Engine</p><p className="mt-2 text-lg text-[#f1c7c2]">Awaiting verified balance</p><div className="mt-2"><StatusPill label="PAUSED" tone="danger" /></div></div>} />
    <DemoNotice>Arc Testnet live mode is fail-closed. Demo and stale balances are excluded until the RPC adapter returns a verified USDC snapshot.</DemoNotice>
    <div className="metric-grid mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-10 lg:py-10"><WalletPanel /><div role="status" className="mt-6 border border-[#9a433c]/20 bg-[#f5dedb] p-5 text-sm text-[#7b332d]">Financial metrics and allocation previews are unavailable while the authoritative treasury balance cannot be verified.</div></div>
  </>;
  const next = assessment.nextPayment;
  const metrics = [
    ["Total treasury", operationalWorkspace.totalTreasury, workspace.treasuryMode === "ARC_TESTNET_WALLET" ? "Liquid USDC + verified Morpho positions" : "Local demo USDC balance"],
    ["Upcoming obligations", assessment.upcomingObligations, "Active or overdue within 30 days"],
    ["Protected capital", assessment.protectedCapital, "Obligations + buffer + pending"],
    ["Deployable capital", assessment.deployableCapital, "Deterministic, never below zero"],
  ] as const;
  const integrationRows = workspace.integrations.map((item) => {
    if (item.name === "Morpho") {
      if (earnState.status === "READY") return { ...item, label: earnState.portfolio.integration.execution.replaceAll("_", " "), tone: earnState.portfolio.integration.execution === "LOCAL_ENABLED" ? "success" as const : "info" as const, message: earnState.portfolio.integration.message };
      if (earnState.status === "ERROR") return { ...item, label: "UNAVAILABLE", tone: "danger" as const, message: earnState.message };
      return { ...item, label: "SYNCING", tone: "info" as const, message: "Loading the verified Arc Earn allowlist." };
    }
    if (workspace.treasuryMode !== "ARC_TESTNET_WALLET" || (item.name !== "User wallet" && item.name !== "Arc Testnet")) return { ...item, label: item.status.replace("_", " "), tone: "neutral" as const };
    if (walletState.status === "READY") return { ...item, label: item.name === "Arc Testnet" ? "LIVE" : "USER CONTROLLED", tone: "success" as const, message: item.name === "User wallet" ? "The selected wallet is authoritative for this workspace. Hodd never combines balances across wallet choices." : `Live USDC verified at block ${walletState.snapshot.blockNumber} on Arc Testnet.` };
    if (walletState.status === "ERROR") return { ...item, label: "UNAVAILABLE", tone: "danger" as const, message: "The live Arc balance is unavailable, so Treasury Engine outputs are paused." };
    return { ...item, label: "SYNCING", tone: "info" as const, message: "Waiting for a verified Arc Testnet USDC snapshot." };
  });
  return <>
    <PageHeader eyebrow="01 · Portfolio" title="Liquidity before yield." description="A deterministic treasury view that protects the next 30 days of obligations before capital becomes deployable." aside={<div className="space-y-3"><div className="min-w-56 border border-white/15 bg-white/[0.04] p-4"><p className="mono text-[9px] uppercase tracking-[0.16em] text-white/40">Liquidity coverage</p><p className="mono mt-2 text-3xl text-[#b7f3cf]">{assessment.liquidityCoverageBps === null ? "No obligations" : formatPercentFromBps(assessment.liquidityCoverageBps)}</p><div className="mt-2"><StatusPill label={assessment.coverageStatus.replace("_", " ")} tone={assessment.coverageStatus === "SAFE" ? "success" : assessment.coverageStatus === "AT_RISK" ? "danger" : "warning"} /></div></div><PolicyPanel /></div>} />
    <DemoNotice>{hydrated ? workspace.treasuryMode === "ARC_TESTNET_WALLET" ? "One user-owned Arc Testnet wallet is authoritative at a time. Balances are never pooled; every future write must be approved by that wallet." : "Local demo workspace. Choose Circle Embedded, Circle Passkey, MetaMask or Rabby to inspect live wallet data." : "Loading the local treasury workspace…"}</DemoNotice>
    <div className="metric-grid mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-10 lg:py-10">
      <WalletPanel />
      <section aria-label="Treasury overview" className="mt-6 grid border-l border-t border-black/15 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value, detail]) => <article key={label} className="min-h-36 border-b border-r border-black/15 bg-[#fffdf7] p-5"><p className="mono text-[9px] uppercase tracking-[0.16em] text-black/45">{label}</p><MoneyValue money={value} compact className="mt-5 block text-3xl font-medium tracking-[-0.05em]" /><p className="mt-3 text-xs text-black/45">{detail}</p></article>)}</section>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard><SectionHeading index="01.1" title="Next payment" description="Nearest protected obligation" action={next && <StatusPill label={assessment.nextPaymentFeasibility?.status ?? "REVIEW"} tone={assessment.nextPaymentFeasibility?.status === "SAFE" ? "success" : "danger"} />} />
          {next ? <div className="p-5 md:p-7"><div className="flex flex-wrap items-end justify-between gap-5"><div><h2 className="text-2xl font-medium tracking-[-0.04em]">{next.title}</h2><p className="mt-2 text-sm text-black/50">{formatDate(next.dueAt)} · {next.recipient ?? "Recipient not provided"}</p></div><MoneyValue money={next.amount} className="text-3xl font-medium" /></div><div className="mt-6 grid gap-3 border-t border-black/10 pt-5 sm:grid-cols-3"><div><p className="text-[10px] uppercase text-black/40">Available after reserves</p><MoneyValue money={assessment.nextPaymentFeasibility!.availableAfterReserves} className="mt-2 block text-sm" /></div><div><p className="text-[10px] uppercase text-black/40">Shortfall</p><MoneyValue money={assessment.nextPaymentFeasibility!.shortfall} className="mt-2 block text-sm" /></div><div><p className="text-[10px] uppercase text-black/40">Funding sources</p><p className="mono mt-2 text-xs">{assessment.nextPaymentFeasibility!.steps.map((step) => step.source.replaceAll("_", " ")).join(" + ") || "None available"}</p></div></div></div> : <p className="p-6 text-sm text-black/50">No protected obligations in the 30-day horizon.</p>}
        </SectionCard>
        <SectionCard><SectionHeading index="01.2" title="Policy result" description="Calculated from current workspace inputs" />
          <div className="space-y-3 p-5">{assessment.violations.length === 0 ? <div className="border border-[#2c7a50]/20 bg-[#dff5e8] p-4 text-sm text-[#164b32]"><ShieldCheck aria-hidden="true" className="mb-3 size-5" />All current liquidity policies pass.</div> : assessment.violations.map((violation) => <div key={violation.code} className="border border-[#9a433c]/20 bg-[#f5dedb] p-4 text-sm text-[#7b332d]"><TriangleAlert aria-hidden="true" className="mb-2 size-4" /><strong>{violation.code.replaceAll("_", " ")}</strong><p className="mt-1 text-xs leading-5">{violation.message}</p></div>)}<div className="grid grid-cols-2 gap-3 border-t border-black/10 pt-4"><div><p className="text-[10px] uppercase text-black/40">Safety buffer</p><MoneyValue money={workspace.policy.safetyBuffer} className="mt-2 block text-sm" /></div><div><p className="text-[10px] uppercase text-black/40">Coverage floor</p><p className="mono mt-2 text-sm">{formatPercentFromBps(workspace.policy.minimumLiquidityCoverageBps)}</p></div></div></div>
        </SectionCard>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2"><SectionCard><SectionHeading index="01.3" title="Recent activity" description="Local audit records are distinct from confirmed onchain receipts" /><div className="divide-y divide-black/10">{workspace.activities.slice(0, 3).map((entry) => <article key={entry.id} className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{entry.action}</h3><StatusPill label={entry.execution.replace("_", " ")} /></div><p className="mt-2 text-xs leading-5 text-black/50">{entry.summary}</p>{entry.explorerUrl && <a href={entry.explorerUrl} target="_blank" rel="noreferrer" className="mono mt-2 inline-block text-[10px] text-[#164b32] underline">View confirmed receipt</a>}</article>)}</div><Link href="/activity" className="flex items-center justify-between border-t border-black/15 px-5 py-4 text-sm font-semibold hover:text-[#164b32]">Open audit view <ArrowRight className="size-4" /></Link></SectionCard>
      <SectionCard><SectionHeading index="01.4" title="Integration boundaries" description="Live reads plus guarded local-only Earn execution" /><div className="divide-y divide-black/10">{integrationRows.map((item) => <article key={item.name} className="p-5"><div className="flex justify-between gap-3"><h3 className="text-sm font-semibold">{item.name}</h3><StatusPill label={item.label} tone={item.tone} /></div><p className="mt-2 text-xs leading-5 text-black/50">{item.message}</p></article>)}</div></SectionCard></div>
    </div>
  </>;
}
