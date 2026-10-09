"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { hasSampleData, sampleDataRemoval } from "@/lib/treasury/sample-cleanup";
import { buttonClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

export function SampleDataBanner() {
  const { mode, workspace, cleanSampleData, readOnly } = useTreasuryWorkspace();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (mode !== "LIVE" || readOnly || !hasSampleData(workspace)) return null;
  const removal = sampleDataRemoval(workspace);
  return <div role="note" className="flex flex-wrap items-center justify-between gap-3 border-b border-[#fab219]/30 bg-[#101319] px-5 py-3 text-xs text-[#f4f1e8]"><p>This workspace still contains sample records. Remove them before adding your real bills.</p><Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button className={buttonClass.ghost}>Remove sample data</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto border border-white/20 bg-[#101319] p-6 text-[#f4f1e8]"><Dialog.Title className="text-lg">Remove sample data?</Dialog.Title><Dialog.Description className="mt-3 text-sm text-white/65">The following records will be removed and settings reset. Bills with payments or reservations and your own records are preserved.</Dialog.Description><ul className="mt-4 space-y-2 text-sm">{removal.obligations.map((item) => <li key={item.id}>Bill: {item.title} ({item.id})</li>)}{removal.activities.map((item) => <li key={item.id}>Activity: {item.action} ({item.id})</li>)}{removal.decisions.map((item) => <li key={item.id}>Decision: {item.title} ({item.id})</li>)}{removal.resetTargets && <li>Reset sample targets: Liquid 20% / Morpho 50% / USYC 20% / BTC 10% → Liquid 50% / Morpho 50% / USYC 0% / BTC 0%</li>}{removal.resetBuffer && <li>Reset sample safety buffer: 1,000 USDC → 1 USDC</li>}</ul>{error && <p role="alert" className="mt-4 text-sm text-[#ff9a92]">{error}</p>}<div className="mt-6 flex flex-wrap gap-3"><button disabled={saving} className={buttonClass.primary} onClick={async () => { setError(""); setSaving(true); try { await cleanSampleData(); setOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Sample data could not be removed."); } finally { setSaving(false); } }}>Confirm removal</button><Dialog.Close disabled={saving} className={buttonClass.ghost}>Cancel</Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root></div>;
}
