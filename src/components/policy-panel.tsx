"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings2, ShieldCheck, X } from "lucide-react";
import { PolicyForm } from "./policy-form";
import { buttonClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { InfoTip } from "./visuals";

export function PolicyPanel() {
  const { storageIssue, readOnly } = useTreasuryWorkspace();
  const [open, setOpen] = useState(false);

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button disabled={readOnly || Boolean(storageIssue)} className={buttonClass.ghost}><Settings2 aria-hidden="true" className="size-4" />Edit policy</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="policy-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] shadow-2xl focus:outline-none">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/[0.14] bg-[#101319] px-5 py-4"><div className="flex items-center gap-3"><span aria-hidden="true" className="grid size-10 place-items-center border border-white/[0.14] text-[#7fa6ff]"><ShieldCheck className="size-4" /></span><Dialog.Title className="text-xl font-semibold">Treasury policy</Dialog.Title></div><Dialog.Close aria-label="Close policy settings" className="grid size-11 place-items-center border border-white/[0.14] hover:bg-white/5"><X aria-hidden="true" className="size-4" /></Dialog.Close></div>
      <div className="flex items-center gap-1 px-5 pt-5"><Dialog.Description id="policy-description" className="text-sm leading-6 text-white/65">Your wallet signs every transaction.</Dialog.Description><InfoTip label="About the treasury policy">These rules protect your payment runway and constrain investment planning.</InfoTip></div>
      <PolicyForm onSaved={() => setOpen(false)} />
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
