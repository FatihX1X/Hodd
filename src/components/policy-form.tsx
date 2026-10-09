"use client";

import { useState } from "react";
import { moneyToInput, parseMoneyInput } from "@/lib/treasury/money";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const fieldClass = "mt-2 w-full border border-white/20 bg-[#0b0b0d] text-[#f4f1e8] px-3 py-2.5 text-sm outline-none focus:border-[#7fa6ff]";

/** Edits the treasury policy. Shared by the quick-edit dialog and the Policy page. */
export function PolicyForm({ onSaved }: { onSaved?: () => void }) {
  const { workspace, updatePolicy, storageIssue, readOnly } = useTreasuryWorkspace();
  const [buffer, setBuffer] = useState(moneyToInput(workspace.policy.safetyBuffer));
  const [coverage, setCoverage] = useState(String(workspace.policy.minimumLiquidityCoverageBps / 100));
  const [morpho, setMorpho] = useState(String(workspace.policy.strategyCapsBps.MORPHO / 100));
  const [usyc, setUsyc] = useState(String(workspace.policy.strategyCapsBps.USYC / 100));
  const [btc, setBtc] = useState(String(workspace.policy.strategyCapsBps.BTC_RESERVE / 100));
  const [error, setError] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const values = [coverage, morpho, usyc, btc].map(Number);
      if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) throw new Error("Percent values must be between 0 and 100");
      updatePolicy({ safetyBuffer: parseMoneyInput(buffer), minimumLiquidityCoverageBps: Math.round(values[0] * 100), strategyCapsBps: { ...workspace.policy.strategyCapsBps, MORPHO: Math.round(values[1] * 100), USYC: Math.round(values[2] * 100), BTC_RESERVE: Math.round(values[3] * 100) } });
      onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Policy values are invalid"); }
  };

  return (
    <form onSubmit={submit}><fieldset disabled={readOnly || Boolean(storageIssue)} className="space-y-5 p-5">
      <label className="block text-xs font-semibold">Safety buffer (USDC)<input aria-label="Safety buffer" value={buffer} onChange={(event) => setBuffer(event.target.value)} inputMode="decimal" className={fieldClass} /></label>
      <label className="block text-xs font-semibold">Minimum liquidity coverage (%)<input aria-label="Minimum liquidity coverage" value={coverage} onChange={(event) => setCoverage(event.target.value)} inputMode="decimal" className={fieldClass} /></label>
      <fieldset className="border border-white/[0.14] p-4"><legend className="px-2 text-xs font-semibold">Maximum deployable allocation</legend><div className="grid gap-4 sm:grid-cols-3">
        {["Morpho", "USYC", "BTC Reserve"].map((label, index) => { const value = [morpho, usyc, btc][index]; const setter = [setMorpho, setUsyc, setBtc][index]; return <label key={label} className="text-[10px] uppercase tracking-[0.1em] text-white/60">{label} %<input aria-label={`${label} maximum allocation`} value={value} onChange={(event) => setter(event.target.value)} inputMode="decimal" className={fieldClass} /></label>; })}
      </div></fieldset>
      <p className="text-xs text-white/55">Obligation horizon is fixed at 30 days. Disabled integrations remain unavailable regardless of their cap.</p>
      {error && <p role="alert" className="border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]">{error}</p>}
      <button type="submit" disabled={Boolean(storageIssue)} className="w-full bg-[#f4f1e8] px-5 py-4 text-sm font-semibold text-[#0b0b0d] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">Save policy and recalculate</button>
    </fieldset></form>
  );
}
