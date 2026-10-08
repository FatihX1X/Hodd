"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings2, X } from "lucide-react";
import { moneyToInput, parseMoneyInput } from "@/lib/treasury/money";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const fieldClass = "mt-2 w-full border border-black/20 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0a52e8]";

export function PolicyPanel() {
  const { workspace, updatePolicy, storageIssue } = useTreasuryWorkspace();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Policy values are invalid"); }
  };

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button disabled={Boolean(storageIssue)} className="inline-flex min-h-11 items-center gap-2 border border-white/20 px-4 text-xs font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"><Settings2 aria-hidden="true" className="size-4" />Edit policy</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="policy-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#f4f1e8] shadow-2xl focus:outline-none">
      <div className="sticky top-0 flex items-start justify-between border-b border-black/15 bg-[#f4f1e8] px-5 py-4"><div><p className="mono text-[9px] uppercase tracking-[0.15em] text-black/40">Deterministic controls</p><Dialog.Title className="mt-1 text-xl font-semibold">Treasury policy</Dialog.Title></div><Dialog.Close aria-label="Close policy settings" className="grid size-10 place-items-center border border-black/15 hover:bg-black/5"><X aria-hidden="true" className="size-4" /></Dialog.Close></div>
      <Dialog.Description id="policy-description" className="px-5 pt-5 text-sm leading-6 text-black/55">These values change local calculations only. They cannot authorize or execute a transaction.</Dialog.Description>
      <form onSubmit={submit} className="space-y-5 p-5">
        <label className="block text-xs font-semibold">Safety buffer (USDC)<input aria-label="Safety buffer" value={buffer} onChange={(event) => setBuffer(event.target.value)} inputMode="decimal" className={fieldClass} /></label>
        <label className="block text-xs font-semibold">Minimum liquidity coverage (%)<input aria-label="Minimum liquidity coverage" value={coverage} onChange={(event) => setCoverage(event.target.value)} inputMode="decimal" className={fieldClass} /></label>
        <fieldset className="border border-black/15 p-4"><legend className="px-2 text-xs font-semibold">Maximum deployable allocation</legend><div className="grid gap-4 sm:grid-cols-3">
          {["Morpho", "USYC", "BTC Reserve"].map((label, index) => { const value = [morpho, usyc, btc][index]; const setter = [setMorpho, setUsyc, setBtc][index]; return <label key={label} className="text-[10px] uppercase tracking-[0.1em] text-black/50">{label} %<input aria-label={`${label} maximum allocation`} value={value} onChange={(event) => setter(event.target.value)} inputMode="decimal" className={fieldClass} /></label>; })}
        </div></fieldset>
        <p className="text-xs text-black/45">Obligation horizon is fixed at 30 days. Disabled integrations remain unavailable regardless of their cap.</p>
        {error && <p role="alert" className="border border-[#9a433c]/20 bg-[#f5dedb] p-3 text-xs text-[#7b332d]">{error}</p>}
        <button type="submit" className="w-full bg-[#0b0b0d] px-5 py-4 text-sm font-semibold text-white hover:bg-[#1c1f27]">Save policy and recalculate</button>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}

