"use client";

import { useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Save } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { moneyToInput, parseMoneyInput } from "@/lib/treasury/money";
import { strategyColor, usdcNumber } from "@/lib/treasury/views";
import { Field } from "./ledger-visuals";
import { buttonClass, inputClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { InfoTip, moneyColor } from "./visuals";

const clampPercent = (text: string) => { const value = Number(text); return Number.isFinite(value) ? Math.max(0, Math.min(value, 100)) : 0; };
const rangeClass = "h-11 w-full cursor-pointer accent-[#7fa6ff]";

/** Edits the treasury policy. Shared by the quick-edit dialog and the Policy page. */
export function PolicyForm({ onSaved }: { onSaved?: () => void }) {
  const { workspace, updatePolicy, storageIssue, readOnly } = useTreasuryWorkspace();
  const reduced = useReducedMotion();
  const [buffer, setBuffer] = useState(moneyToInput(workspace.policy.safetyBuffer));
  const [coverage, setCoverage] = useState(String(workspace.policy.minimumLiquidityCoverageBps / 100));
  const [morpho, setMorpho] = useState(String(workspace.policy.strategyCapsBps.MORPHO / 100));
  const [usyc, setUsyc] = useState(String(workspace.policy.strategyCapsBps.USYC / 100));
  const [btc, setBtc] = useState(String(workspace.policy.strategyCapsBps.BTC_RESERVE / 100));
  const [leadMode, setLeadMode] = useState(workspace.policy.protectionLeadDays === null ? "AUTOMATIC" : "CUSTOM");
  const [leadDays, setLeadDays] = useState(String(workspace.policy.protectionLeadDays ?? 7));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const edit = <T,>(setter: (value: T) => void) => (value: T) => { setSaved(false); setter(value); };

  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setSaved(false);
    try {
      const values = [coverage, morpho, usyc, btc].map(Number);
      if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error("Percent values must be between 0 and 100");
      const protectionLeadDays = leadMode === "AUTOMATIC" ? null : Number(leadDays);
      if (protectionLeadDays !== null && (!Number.isInteger(protectionLeadDays) || protectionLeadDays < 3 || protectionLeadDays > 30)) throw new Error("Protection lead time must be an integer from 3 to 30 days");
      updatePolicy({ protectionLeadDays, safetyBuffer: parseMoneyInput(buffer), minimumLiquidityCoverageBps: Math.round(values[0] * 100), strategyCapsBps: { ...workspace.policy.strategyCapsBps, MORPHO: Math.round(values[1] * 100), USYC: Math.round(values[2] * 100), BTC_RESERVE: Math.round(values[3] * 100) } });
      setSaved(true);
      onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Policy values are invalid"); }
  };

  const total = usdcNumber(workspace.totalTreasury);
  const bufferValue = Number(buffer.replace(/,/g, ""));
  const bufferShare = total > 0 && Number.isFinite(bufferValue) && bufferValue > 0 ? Math.min(bufferValue / total, 1) : 0;
  const customLead = Number(leadDays);
  const leadValid = leadMode === "CUSTOM" && Number.isInteger(customLead) && customLead >= 3 && customLead <= 30;
  const caps = [
    { label: "Morpho", value: morpho, set: edit(setMorpho), color: strategyColor.MORPHO },
    { label: "USYC", value: usyc, set: edit(setUsyc), color: strategyColor.USYC },
    { label: "BTC Reserve", value: btc, set: edit(setBtc), color: strategyColor.BTC_RESERVE },
  ];

  return (
    <LazyMotion features={domAnimation} strict>
      <form onSubmit={submit}><fieldset disabled={readOnly || Boolean(storageIssue)} className="space-y-6 p-5">
        <Field label="Safety buffer (USDC)">{(id) => <>
          <input id={id} aria-label="Safety buffer" value={buffer} onChange={(event) => edit(setBuffer)(event.target.value)} inputMode="decimal" className={clsx(inputClass, "mono")} />
          {total > 0 && <div className="mt-3 flex items-center gap-3"><div role="meter" aria-label="Safety buffer as a share of the treasury" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bufferShare * 100)} className="h-2 flex-1 bg-white/10"><div className="h-full transition-[width] duration-300" style={{ width: `${bufferShare * 100}%`, background: moneyColor.protected }} /></div><span className="mono w-28 shrink-0 text-right text-[12px] tabular-nums text-white/60">{(bufferShare * 100).toFixed(bufferShare > 0 && bufferShare < 0.1 ? 1 : 0)}% of treasury</span></div>}
        </>}</Field>

        <Field label="Minimum liquidity coverage (%)">{(id) => <div className="mt-2 grid grid-cols-[1fr_6rem] items-center gap-4">
          <input type="range" min={0} max={100} step={1} value={clampPercent(coverage)} onChange={(event) => edit(setCoverage)(event.target.value)} aria-label="Minimum liquidity coverage slider" className={rangeClass} />
          <input id={id} aria-label="Minimum liquidity coverage" value={coverage} onChange={(event) => edit(setCoverage)(event.target.value)} inputMode="decimal" className={clsx(inputClass, "mono mt-0")} />
        </div>}</Field>

        <Field label="Protection lead time">{(id) => <>
          <select id={id} aria-label="Protection lead time" value={leadMode} onChange={(event) => edit(setLeadMode)(event.target.value)} className={inputClass}><option value="AUTOMATIC">Automatic</option><option value="CUSTOM">Custom days</option></select>
          <span className="mt-2 block text-xs font-normal text-white/55">3 days while Autopilot runs, 7 days otherwise</span>
        </>}</Field>
        {leadMode === "CUSTOM" && <Field label="Lead time (days)">{(id) => <>
          <input id={id} aria-label="Protection lead days" type="number" min="3" max="30" step="1" value={leadDays} onChange={(event) => edit(setLeadDays)(event.target.value)} className={clsx(inputClass, "mono")} />
          {leadValid && <div aria-hidden="true" className="mt-3 flex h-2 bg-white/10"><div className="h-full transition-[width] duration-300" style={{ width: `${(customLead / 30) * 100}%`, background: moneyColor.protected }} /></div>}
        </>}</Field>}

        <fieldset className="border border-white/[0.14] p-4"><legend className="px-2 text-xs font-semibold">Maximum deployable allocation</legend><div className="grid gap-5 sm:grid-cols-3">
          {caps.map(({ label, value, set, color }) => (
            <Field key={label} label={`${label} (%)`} labelClassName="text-[12px] text-white/60">{(id) => <>
              <span aria-hidden="true" className="mt-2 block h-1 w-full" style={{ background: color }} />
              <input id={id} aria-label={`${label} maximum allocation`} value={value} onChange={(event) => set(event.target.value)} inputMode="decimal" className={clsx(inputClass, "mono")} />
              <input type="range" min={0} max={100} step={1} value={clampPercent(value)} onChange={(event) => set(event.target.value)} aria-label={`${label} allocation slider`} className={rangeClass} />
            </>}</Field>
          ))}
        </div></fieldset>

        <p className="flex items-center gap-1 text-xs text-white/55">Planning horizon is fixed at 30 days.<InfoTip label="About the policy limits" className="-my-1">Bills Hodd cannot safely fund from Morpho are kept liquid automatically. Disabled integrations remain unavailable regardless of their cap.</InfoTip></p>
        {error && <p role="alert" className="border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]">{error}</p>}
        <button type="submit" disabled={Boolean(storageIssue)} className={clsx(buttonClass.primary, "min-h-12 w-full")}><Save aria-hidden="true" className="size-4" />Save policy and recalculate</button>
        <AnimatePresence>{saved && <m.p key="saved" role="status" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.25 }} className="flex items-center gap-2 text-xs" style={{ color: moneyColor.safe }}><CheckCircle2 aria-hidden="true" className="size-4" />Saved. Every figure was recalculated.</m.p>}</AnimatePresence>
      </fieldset></form>
    </LazyMotion>
  );
}
