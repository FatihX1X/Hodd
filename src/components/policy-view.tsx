"use client";

import { DemoNotice, PageBody, PageHeader, SectionCard, SectionHeading, StatusPill, labelClass } from "@/components/primitives";
import { PolicyForm } from "@/components/policy-form";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";
import { formatPercentFromBps } from "@/lib/treasury/format";
import { policyChecks, policySentences, strategyLabels } from "@/lib/treasury/views";

export function PolicyView() {
  const { workspace, assessment } = useTreasuryWorkspace();
  const checks = assessment ? policyChecks(workspace, assessment) : [];
  return (
    <>
      <PageHeader eyebrow="04 · Policy" title="The rules behind every number." description="The treasury policy in plain language, the checks it passes today and the values you can change." />
      <DemoNotice>Policy protects your bills and safety buffer before investment planning. Your wallet signs every transaction.</DemoNotice>
      <PageBody>
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <SectionCard>
              <SectionHeading index="04.1" title="In plain language" description="What the Treasury Engine enforces, in order" />
              <ol className="divide-y divide-white/10">{policySentences(workspace.policy).map((sentence, index) => (
                <li key={sentence} className="grid grid-cols-[32px_1fr] gap-3 px-5 py-4"><span className="mono text-[11px] text-white/45">{String(index + 1).padStart(2, "0")}</span><span className="text-sm leading-6">{sentence}</span></li>
              ))}</ol>
            </SectionCard>
            <SectionCard>
              <SectionHeading index="04.2" title="Checks today" description="Evaluated against the current balance and obligations" />
              {assessment ? (
                <ul className="divide-y divide-white/10">{checks.map((check) => (
                  <li key={`${check.title}-${check.text}`} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{check.title}</h3><StatusPill label={check.status === "PASS" ? "PASS" : "ATTENTION"} tone={check.status === "PASS" ? "success" : "danger"} /></div>
                    <p className="mt-2 text-xs leading-5 text-white/60">{check.text}</p>
                  </li>
                ))}</ul>
              ) : <p role="status" className="p-5 text-sm leading-6 text-white/65">Checks are paused until the linked Arc Testnet balance is verified.</p>}
            </SectionCard>
          </div>
          <div className="space-y-6">
            <SectionCard>
              <SectionHeading index="04.3" title="Edit policy" description="Saving recalculates every figure immediately" />
              <PolicyForm />
            </SectionCard>
            <SectionCard>
              <SectionHeading index="04.4" title="Strategy limits" description="Share of the treasury each strategy may hold" />
              <dl className="divide-y divide-white/10">{(["MORPHO", "USYC", "BTC_RESERVE"] as const).map((kind) => (
                <div key={kind} className="flex items-center justify-between gap-4 px-5 py-4">
                  <dt><span className="block text-sm font-medium">{strategyLabels[kind]}</span><span className={labelClass}>Cap {formatPercentFromBps(workspace.policy.strategyCapsBps[kind])}</span></dt>
                  <dd><StatusPill label={workspace.policy.enabledStrategies[kind] ? "Enabled" : "Disabled"} tone={workspace.policy.enabledStrategies[kind] ? "success" : "neutral"} /></dd>
                </div>
              ))}</dl>
            </SectionCard>
          </div>
        </div>
      </PageBody>
    </>
  );
}
