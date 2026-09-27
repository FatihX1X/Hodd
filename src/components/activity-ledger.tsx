"use client";

import { useMemo, useState } from "react";
import { Bot, ChevronDown, CircleUserRound, Cog } from "lucide-react";
import clsx from "clsx";
import { EmptyState } from "./page-states";
import { PolicyPill, SectionCard, SectionHeading, StatusPill } from "./primitives";
import { formatDate } from "@/lib/treasury/format";
import type { ActivityEntry } from "@/lib/treasury/models";

type ActorFilter = "ALL" | ActivityEntry["actor"];
const filters: ActorFilter[] = ["ALL", "HUMAN", "AGENT", "SYSTEM"];
const actorIcon = { HUMAN: CircleUserRound, AGENT: Bot, SYSTEM: Cog };

export function ActivityLedger({ activities }: { activities: ActivityEntry[] }) {
  const [filter, setFilter] = useState<ActorFilter>("ALL");
  const visible = useMemo(() => filter === "ALL" ? activities : activities.filter((entry) => entry.actor === filter), [activities, filter]);

  return (
    <div className="metric-grid mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-10 lg:py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Filter activity by actor" className="flex flex-wrap gap-2">
          {filters.map((item) => <button key={item} onClick={() => setFilter(item)} aria-pressed={filter === item} className={clsx("border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]", filter === item ? "border-[#164b32] bg-[#164b32] text-white" : "border-black/15 bg-[#fffdf7] text-black/55 hover:border-black/40")}>{item}</button>)}
        </div>
        <div className="flex items-center gap-2"><span className="size-1.5 bg-[#8be0b1]" /><span className="mono text-[10px] uppercase tracking-[0.14em] text-black/45">Local audit trail</span></div>
      </div>

      <SectionCard>
        <SectionHeading index="04.1" title="Decision ledger" description="Expand a record to inspect rationale, policy and authorization state" />
        {visible.length === 0 ? <EmptyState title="No matching records" description="Choose another actor type to inspect local activity." /> : (
          <div className="divide-y divide-black/10">
            {visible.map((entry) => {
              const Icon = actorIcon[entry.actor];
              return (
                <details key={entry.id} className="group">
                  <summary className="grid cursor-pointer list-none gap-4 p-5 hover:bg-black/[0.025] sm:grid-cols-[40px_150px_1fr_auto] sm:items-center [&::-webkit-details-marker]:hidden">
                    <span className="grid size-10 place-items-center border border-black/15 bg-black/[0.03]"><Icon aria-hidden="true" className="size-4" /></span>
                    <div><p className="mono text-[9px] uppercase tracking-[0.13em] text-black/40">{entry.actor}</p><p className="mt-1 text-xs">{formatDate(entry.occurredAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div>
                    <div><h2 className="text-sm font-semibold">{entry.action}</h2><p className="mt-1 text-xs leading-5 text-black/50">{entry.summary}</p></div>
                    <div className="flex items-center gap-3"><StatusPill label={entry.execution.replace("_", " ")} /><ChevronDown aria-hidden="true" className="size-4 text-black/35 transition-transform group-open:rotate-180" /></div>
                  </summary>
                  <div className="grid gap-px border-t border-black/10 bg-black/10 sm:grid-cols-3">
                    <div className="bg-[#f8f5ed] p-5"><p className="text-[10px] uppercase tracking-[0.13em] text-black/40">Why this record exists</p><p className="mt-3 text-xs leading-5 text-black/60">{entry.reason}</p></div>
                    <div className="bg-[#f8f5ed] p-5"><p className="text-[10px] uppercase tracking-[0.13em] text-black/40">Policy state</p><div className="mt-3"><PolicyPill policy={entry.policy} /></div><p className="mt-3 text-xs leading-5 text-black/60">{entry.policy.reason}</p></div>
                    <div className="bg-[#f8f5ed] p-5"><p className="text-[10px] uppercase tracking-[0.13em] text-black/40">Authorization</p><p className="mono mt-3 text-xs">{entry.approval.replace("_", " ")}</p><p className="mt-3 text-xs leading-5 text-black/60">No signature, wallet request or onchain submission exists.</p></div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </SectionCard>

      <div className="mt-6 border border-black/15 bg-[#0b0d0c] p-5 text-white md:flex md:items-center md:justify-between md:gap-8">
        <div><p className="mono text-[9px] uppercase tracking-[0.16em] text-[#8be0b1]">Stage boundary</p><h2 className="mt-2 text-xl font-medium tracking-[-0.03em]">An explanation is not an execution receipt.</h2></div>
        <p className="mt-4 max-w-xl text-xs leading-5 text-white/50 md:mt-0">Future transaction records must include a confirmed state and transaction hash. Stage 2 creates local calculation records only.</p>
      </div>
    </div>
  );
}
