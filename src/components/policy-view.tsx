"use client";

import clsx from "clsx";
import { AlertTriangle, Ban, CheckCircle2, Coins, Droplets, Gauge, Layers, ListChecks, Lock, Pencil, ShieldCheck, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TreasuryNotice, PageBody, PageHeader, KpiGrid, MoneyValue, SectionCard, SectionHeading } from "@/components/primitives";
import { StatusChip } from "@/components/ledger-visuals";
import { PolicyForm } from "@/components/policy-form";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";
import { Figure, InfoTip, Ring, moneyColor } from "@/components/visuals";
import { effectiveProtectionLeadDays } from "@/lib/treasury/engine";
import { formatPercentFromBps } from "@/lib/treasury/format";
import type { Money } from "@/lib/treasury/models";
import { capUsage, policyChecks, policySentences, strategyColor, strategyLabels, usdcNumber } from "@/lib/treasury/views";

// One icon and colour per sentence of the plain-language policy, in the order policySentences writes them.
const sentenceMarks: readonly { icon: LucideIcon; color: string }[] = [
  { icon: Lock, color: moneyColor.protected },
  { icon: Gauge, color: moneyColor.deployable },
  { icon: Coins, color: strategyColor.MORPHO },
  { icon: Coins, color: strategyColor.USYC },
  { icon: Coins, color: strategyColor.BTC_RESERVE },
  { icon: Droplets, color: strategyColor.LIQUID },
  { icon: Wallet, color: moneyColor.safe },
];
const mutedRing = "rgba(244,241,232,0.35)";
const pct = (value: number) => `${Math.round(value * 100)}%`;
const share = (part: Money, whole: number) => whole > 0 ? Math.max(0, Math.min(usdcNumber(part) / whole, 1)) : null;

export function PolicyView() {
  const { workspace, operationalWorkspace, assessment, autopilotActive } = useTreasuryWorkspace();
  const checks = assessment ? policyChecks(workspace, assessment) : [];
  const base = operationalWorkspace ?? workspace;
  const total = usdcNumber(base.totalTreasury);
  const lead = effectiveProtectionLeadDays(workspace.policy, { autopilotActive });
  const floorBps = workspace.policy.minimumLiquidityCoverageBps;
  const coverageBps = assessment?.liquidityCoverageBps ?? null;
  const coverageOk = coverageBps !== null && coverageBps >= floorBps;
  const bufferRatio = share(workspace.policy.safetyBuffer, total);

  // The treasury as one band: bills, buffer, what is free to deploy and everything else.
  const bufferValue = Math.min(usdcNumber(workspace.policy.safetyBuffer), assessment ? usdcNumber(assessment.protectedCapital) : 0);
  const billsValue = assessment ? Math.max(usdcNumber(assessment.protectedCapital) - bufferValue, 0) : 0;
  const freeValue = assessment ? usdcNumber(assessment.deployableCapital) : 0;
  const band = Math.max(total, billsValue + bufferValue + freeValue);
  const otherValue = Math.max(band - billsValue - bufferValue - freeValue, 0);
  const segments = [
    { key: "bills", label: "Bills and pending", value: billsValue, color: moneyColor.protected, hatched: true },
    { key: "buffer", label: "Safety buffer", value: bufferValue, color: moneyColor.protected, hatched: false },
    { key: "free", label: "Deployable", value: freeValue, color: moneyColor.deployable, hatched: false },
    { key: "other", label: "Everything else", value: otherValue, color: "rgba(244,241,232,0.22)", hatched: false },
  ];
  const bandSummary = `Treasury against the policy: ${segments.filter((segment) => segment.value > 0).map((segment) => `${segment.label} ${pct(segment.value / band)}`).join(", ")}.`;

  return (
    <>
      <PageHeader eyebrow="04 · Policy" title="The rules behind every number." description="Your policy, today's checks and the values you can change." />
      <TreasuryNotice>Policy protects your bills and safety buffer before investment planning. Your wallet signs every transaction.</TreasuryNotice>
      <PageBody>
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="min-w-0 space-y-6">
            <KpiGrid label="Policy at a glance" columns={3}>
              <Figure className="sm:flex-col! sm:items-start!" label="Safety buffer" tip="Always kept liquid, on top of your bills." value={<MoneyValue money={workspace.policy.safetyBuffer} className="text-xl" />} visual={<Ring ratio={bufferRatio} label="Safety buffer as a share of the treasury" color={moneyColor.protected} size={64}><span className="mono text-[13px] tabular-nums">{bufferRatio === null ? "0%" : pct(bufferRatio)}</span></Ring>} />
              <Figure className="sm:flex-col! sm:items-start!" label="Coverage floor" tip="Safely redeemable liquidity must stay at or above this share of your obligations." value={<span>{formatPercentFromBps(floorBps)}</span>} visual={<Ring ratio={coverageBps === null ? null : floorBps > 0 ? coverageBps / floorBps : 1} label="Liquidity coverage against the floor" color={coverageBps === null ? mutedRing : coverageOk ? moneyColor.safe : moneyColor.danger} size={64}>{coverageBps === null ? <span className="text-[11px] text-white/45">No bills</span> : coverageOk ? <CheckCircle2 aria-hidden="true" className="size-5" style={{ color: moneyColor.safe }} /> : <AlertTriangle aria-hidden="true" className="size-5" style={{ color: moneyColor.danger }} />}</Ring>} />
              <Figure className="sm:flex-col! sm:items-start!" label="Protection lead" tip="Bills due sooner than this are kept liquid." value={<span>{lead} days</span>} visual={<span className="grid w-16 gap-1.5"><span aria-hidden="true" className="h-2 bg-white/10"><span className="block h-full" style={{ width: `${Math.min(lead / 30, 1) * 100}%`, background: moneyColor.protected }} /></span><span className="text-center text-[11px] text-white/45">of 30</span></span>} />
            </KpiGrid>

            {assessment && <SectionCard>
              <SectionHeading icon={<Layers className="size-4" />} title="Treasury against the policy" action={<InfoTip label="About this bar" className="-my-1">Protected capital covers upcoming bills, the safety buffer and pending payments. Deployable capital is what is left to invest within the caps.</InfoTip>} />
              <div className="p-5">
                <div role="img" aria-label={bandSummary} className="relative flex h-10 gap-px overflow-hidden bg-white/[0.06]">
                  {segments.filter((segment) => segment.value > 0).map((segment) => <span key={segment.key} className="relative block h-full" style={{ flex: `${segment.value} 1 0`, background: segment.color }}>{segment.hatched && <span className="absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg, rgba(11,11,13,0.55) 0 2px, transparent 2px 7px)" }} />}</span>)}
                </div>
                <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                  {segments.map((segment) => <li key={segment.key} className="inline-flex items-center gap-2 text-white/70"><span aria-hidden="true" className="relative size-2.5" style={{ background: segment.color }} />{segment.label}<span className="mono tabular-nums text-white/90">{pct(band > 0 ? segment.value / band : 0)}</span></li>)}
                </ul>
              </div>
            </SectionCard>}

            <SectionCard>
              <SectionHeading icon={<ListChecks className="size-4" />} title="Checks today" action={<InfoTip label="About the checks" className="-my-1">Evaluated against the current balance and obligations.</InfoTip>} />
              {assessment ? (
                <ul className="divide-y divide-white/10">{checks.map((check) => {
                  const pass = check.status === "PASS";
                  return (
                    <li key={`${check.title}-${check.text}`} className="flex items-start gap-3 px-5 py-4">
                      <span aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: pass ? moneyColor.safe : moneyColor.danger }}>{pass ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><h3 className="flex items-center gap-1 text-sm font-semibold"><span className="lowercase first-letter:uppercase">{check.title}</span>{pass && <InfoTip label={`About ${check.title.toLowerCase()}`} className="-my-1">{check.text}</InfoTip>}</h3><StatusChip icon={pass ? ShieldCheck : AlertTriangle} label={pass ? "Pass" : "Needs attention"} color={pass ? moneyColor.safe : moneyColor.danger} /></div>
                        {!pass && <p className="mt-2 text-xs leading-5 text-white/65">{check.text}</p>}
                      </div>
                    </li>
                  );
                })}</ul>
              ) : <p role="status" className="flex items-start gap-3 p-5 text-sm leading-6 text-white/65"><AlertTriangle aria-hidden="true" className="mt-1 size-4 shrink-0" />Checks are paused until the linked Arc Testnet balance is verified.</p>}
            </SectionCard>

            <SectionCard>
              <SectionHeading icon={<ShieldCheck className="size-4" />} title="In plain language" action={<InfoTip label="About the plain-language policy" className="-my-1">What the Treasury Engine enforces, in order.</InfoTip>} />
              <ul className="divide-y divide-white/10">{policySentences(workspace.policy, { autopilotActive }).map((sentence, index) => {
                const mark = sentenceMarks[Math.min(index, sentenceMarks.length - 1)];
                const Icon = mark.icon;
                return (
                  <li key={sentence} className="flex items-start gap-3 px-5 py-4"><span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border" style={{ borderColor: mark.color, color: mark.color }}><Icon className="size-4" /></span><span className="text-sm leading-6">{sentence}</span></li>
                );
              })}</ul>
            </SectionCard>
          </div>

          <div className="min-w-0 space-y-6">
            <SectionCard>
              <SectionHeading icon={<Pencil className="size-4" />} title="Edit policy" action={<InfoTip label="About saving" className="-my-1">Saving recalculates every figure immediately.</InfoTip>} />
              <PolicyForm />
            </SectionCard>
            <SectionCard>
              <SectionHeading icon={<Coins className="size-4" />} title="Strategy limits" action={<InfoTip label="About strategy limits" className="-my-1">The share of the treasury each strategy may hold.</InfoTip>} />
              <ul className="divide-y divide-white/10">{(["MORPHO", "USYC", "BTC_RESERVE"] as const).map((kind) => {
                const enabled = workspace.policy.enabledStrategies[kind];
                const position = base.strategies.find((strategy) => strategy.kind === kind);
                const usage = position ? capUsage(base, position) : { capBps: workspace.policy.strategyCapsBps[kind], share: 0, ratio: null as number | null };
                const capShare = usage.capBps / 10_000;
                const over = usage.share > capShare + 1e-9;
                return (
                  <li key={kind} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: strategyColor[kind] }} />{strategyLabels[kind]}</span><StatusChip icon={enabled ? CheckCircle2 : Ban} label={enabled ? "Enabled" : "Disabled"} color={enabled ? moneyColor.safe : "rgba(244,241,232,0.55)"} /></div>
                    <div role="meter" aria-label={`${strategyLabels[kind]} share of the treasury against its cap`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(capShare > 0 ? usage.share / capShare : 0, 1) * 100)} className={clsx("relative mt-3 h-3 bg-white/10", !enabled && "opacity-50")}>
                      <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(capShare, 1) * 100}%`, background: strategyColor[kind], opacity: 0.25 }} />
                      <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(usage.share, 1) * 100}%`, background: over ? moneyColor.danger : strategyColor[kind] }} />
                      <span aria-hidden="true" className="absolute -inset-y-1 w-0.5 bg-[#f4f1e8]" style={{ left: `calc(${Math.min(capShare, 1) * 100}% - 1px)` }} />
                    </div>
                    <div className="mono mt-2 flex justify-between text-xs tabular-nums text-white/60"><span>Now {pct(usage.share)}</span><span>Cap {formatPercentFromBps(usage.capBps)}</span></div>
                  </li>
                );
              })}</ul>
            </SectionCard>
          </div>
        </div>
      </PageBody>
    </>
  );
}

