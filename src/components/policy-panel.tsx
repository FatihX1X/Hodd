"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings2, X } from "lucide-react";
import { PolicyForm } from "./policy-form";
import { buttonClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

export function PolicyPanel() {
  const { storageIssue, readOnly } = useTreasuryWorkspace();
  const [open, setOpen] = useState(false);

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button disabled={readOnly || Boolean(storageIssue)} className={buttonClass.ghost}><Settings2 aria-hidden="true" className="size-4" />Edit policy</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="policy-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] shadow-2xl focus:outline-none">
      <div className="sticky top-0 flex items-start justify-between border-b border-white/[0.14] bg-[#101319] px-5 py-4"><div><p className="mono text-[9px] uppercase tracking-[0.15em] text-white/50">Deterministic controls</p><Dialog.Title className="mt-1 text-xl font-semibold">Treasury policy</Dialog.Title></div><Dialog.Close aria-label="Close policy settings" className="grid size-10 place-items-center border border-white/[0.14] hover:bg-white/5"><X aria-hidden="true" className="size-4" /></Dialog.Close></div>
      <Dialog.Description id="policy-description" className="px-5 pt-5 text-sm leading-6 text-white/65">These rules protect your payment runway and constrain investment planning. Your wallet signs every transaction.</Dialog.Description>
      <PolicyForm onSaved={() => setOpen(false)} />
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
