"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, ChevronRight, CircleDollarSign, MapPin, X } from "lucide-react";
import clsx from "clsx";
import { EmptyState } from "./page-states";
import { MoneyValue, SectionCard, SectionHeading, StatusPill } from "./primitives";
import { formatDate } from "@/lib/treasury/format";
import type { Obligation } from "@/lib/treasury/models";

type Filter = "ALL" | Obligation["status"];
const filters: Filter[] = ["ALL", "UPCOMING", "DRAFT", "PAID"];

const priorityTone = { CRITICAL: "danger", HIGH: "warning", NORMAL: "info", LOW: "neutral" } as const;

export function ObligationExplorer({ obligations }: { obligations: Obligation[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<Obligation | null>(null);
  const visible = useMemo(() => filter === "ALL" ? obligations : obligations.filter((item) => item.status === filter), [filter, obligations]);

  return (
    <div className="metric-grid mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-10 lg:py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Filter obligations" className="flex flex-wrap gap-2">
          {filters.map((item) => <button key={item} onClick={() => setFilter(item)} aria-pressed={filter === item} className={clsx("border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]", filter === item ? "border-[#164b32] bg-[#164b32] text-white" : "border-black/15 bg-[#fffdf7] text-black/55 hover:border-black/40")}>{item}</button>)}
        </div>
        <p aria-live="polite" className="mono text-[10px] uppercase tracking-[0.15em] text-black/45">{visible.length} records shown</p>
      </div>

      <SectionCard>
        <SectionHeading index="03.1" title="Payment calendar" description="Draft records are visible but excluded from the displayed protected total" />
        {visible.length === 0 ? <EmptyState title="No records in this view" description="The Stage 1 sample workspace does not include obligations with this status." /> : (
          <div className="divide-y divide-black/10">
            {visible.map((obligation) => (
              <button key={obligation.id} onClick={() => setSelected(obligation)} className="grid w-full gap-4 p-5 text-left transition-colors hover:bg-black/[0.025] sm:grid-cols-[120px_1fr_auto_auto] sm:items-center" aria-label={`View details for ${obligation.title}`}>
                <div><p className="mono text-[9px] uppercase tracking-[0.14em] text-black/40">Due</p><p className="mt-1 text-sm font-semibold">{formatDate(obligation.dueAt, { month: "short", day: "numeric" })}</p></div>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{obligation.title}</h2><StatusPill label={obligation.status} tone={obligation.status === "DRAFT" ? "neutral" : "info"} /></div><p className="mt-1 truncate text-xs text-black/45">{obligation.category} · {obligation.recipient}</p></div>
                <div className="sm:text-right"><MoneyValue money={obligation.amount} className="text-sm font-semibold" /><div className="mt-1"><StatusPill label={obligation.priority} tone={priorityTone[obligation.priority]} /></div></div>
                <ChevronRight aria-hidden="true" className="hidden size-4 text-black/30 sm:block" />
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="border border-black/15 bg-[#fffdf7] p-5"><p className="mono text-[9px] uppercase tracking-[0.14em] text-black/40">Active protected amount</p><p className="mono mt-4 text-2xl">4,500.00 USDC</p><p className="mt-2 text-xs text-black/45">Fixture value · no engine calculation</p></div>
        <div className="border border-black/15 bg-[#fffdf7] p-5"><p className="mono text-[9px] uppercase tracking-[0.14em] text-black/40">Nearest deadline</p><p className="mt-4 text-2xl tracking-[-0.04em]">Oct 4</p><p className="mt-2 text-xs text-black/45">October payroll · critical</p></div>
        <div className="border border-black/15 bg-[#fffdf7] p-5"><p className="mono text-[9px] uppercase tracking-[0.14em] text-black/40">Recipient readiness</p><p className="mt-4 text-2xl tracking-[-0.04em]">0 verified</p><p className="mt-2 text-xs text-black/45">Address verification is not implemented</p></div>
      </div>

      <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          {selected && (
            <Dialog.Content aria-describedby="obligation-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#fffdf7] shadow-2xl focus:outline-none">
              <div className="sticky top-0 flex items-start justify-between border-b border-black/15 bg-[#fffdf7] px-5 py-4">
                <div><p className="mono text-[9px] uppercase tracking-[0.15em] text-black/40">Obligation detail</p><Dialog.Title className="mt-1 text-xl font-semibold tracking-[-0.03em]">{selected.title}</Dialog.Title></div>
                <Dialog.Close aria-label="Close obligation details" className="grid size-10 place-items-center border border-black/15 hover:bg-black/5"><X aria-hidden="true" className="size-4" /></Dialog.Close>
              </div>
              <Dialog.Description id="obligation-description" className="px-5 pt-5 text-sm leading-6 text-black/55">{selected.description}</Dialog.Description>
              <dl className="m-5 border border-black/15">
                <div className="border-b border-black/10 p-5"><dt className="flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-black/40"><CircleDollarSign aria-hidden="true" className="size-3.5" />Amount</dt><dd className="mt-2"><MoneyValue money={selected.amount} className="text-3xl font-medium tracking-[-0.05em]" /></dd></div>
                <div className="grid grid-cols-2 border-b border-black/10"><div className="border-r border-black/10 p-4"><dt className="text-[10px] uppercase tracking-[0.13em] text-black/40">Category</dt><dd className="mono mt-2 text-xs">{selected.category}</dd></div><div className="p-4"><dt className="text-[10px] uppercase tracking-[0.13em] text-black/40">Priority</dt><dd className="mt-2"><StatusPill label={selected.priority} tone={priorityTone[selected.priority]} /></dd></div></div>
                <div className="border-b border-black/10 p-4"><dt className="flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-black/40"><CalendarDays aria-hidden="true" className="size-3.5" />Payment date</dt><dd className="mt-2 text-sm">{formatDate(selected.dueAt, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</dd></div>
                <div className="p-4"><dt className="flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-black/40"><MapPin aria-hidden="true" className="size-3.5" />Recipient</dt><dd className="mt-2 break-words text-sm">{selected.recipient ?? "Not provided"}</dd></div>
              </dl>
              <div className="mx-5 border border-[#906a2f]/20 bg-[#f3e8ce] p-4 text-xs leading-5 text-[#694813]">This is a read-only sample record. Recipient verification, proposal creation and payment execution are unavailable.</div>
              <div className="p-5"><button disabled className="w-full cursor-not-allowed border border-black/15 bg-black/5 px-5 py-4 text-sm font-semibold text-black/35">Payment preview begins in Stage 5</button></div>
            </Dialog.Content>
          )}
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
