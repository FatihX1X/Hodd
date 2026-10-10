"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, CircleUserRound, Cog } from "lucide-react";
import { EmptyState } from "./page-states";
import { FilterGroup, PageBody, Pagination, PolicyPill, SectionCard, SectionHeading, StatusPill, labelClass } from "./primitives";
import { formatDate } from "@/lib/treasury/format";
import type { ActivityEntry } from "@/lib/treasury/models";

type ActorFilter = "ALL" | ActivityEntry["actor"];
const filters = ["ALL", "HUMAN", "AGENT", "SYSTEM"] as const;
const actorIcon = { HUMAN: CircleUserRound, AGENT: Bot, SYSTEM: Cog };
const PAGE_SIZE = 10;

export function ActivityLedger({ activities }: { activities: ActivityEntry[] }) {
  const [filter, setFilter] = useState<ActorFilter>("ALL");
  const [page, setPage] = useState(1);
  const visible = useMemo(() => filter === "ALL" ? activities : activities.filter((entry) => entry.actor === filter), [activities, filter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const entries = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const cardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const userMovedPage = useRef(false);
  // After the user changes page, show the top of the ledger and land focus on the new page's entries.
  useEffect(() => {
    if (!userMovedPage.current) return;
    userMovedPage.current = false;
    const card = cardRef.current;
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    listRef.current?.focus({ preventScroll: true });
  }, [current]);
  const changePage = (next: number) => { if (next === current) return; userMovedPage.current = true; setPage(next); };

  return (
    <PageBody>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <FilterGroup label="Filter activity by actor" options={filters} value={filter} onChange={(next) => { setFilter(next); setPage(1); }} />
        <div className="flex items-center gap-2"><span className="size-1.5 bg-[#7fa6ff]" /><span className={labelClass}>Local audit trail</span></div>
      </div>

      <div ref={cardRef} className="scroll-mt-20"><SectionCard>
        <SectionHeading index="05.1" title="Decision ledger" description="Expand a record to inspect rationale, policy and authorization state" />
        {visible.length === 0 ? <EmptyState title="No matching records" description="Choose another actor type to inspect treasury activity." /> : (
          <div ref={listRef} role="region" aria-label={`Decision ledger entries${pageCount > 1 ? `, page ${current} of ${pageCount}` : ""}`} tabIndex={-1} className="divide-y divide-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#7fa6ff]">
            {entries.map((entry) => {
              const Icon = actorIcon[entry.actor];
              return (
                <details key={entry.id} className="group">
                  <summary className="grid cursor-pointer list-none gap-4 p-5 hover:bg-white/[0.04] sm:grid-cols-[40px_150px_1fr_auto] sm:items-center [&::-webkit-details-marker]:hidden">
                    <span className="grid size-10 place-items-center border border-white/[0.14] bg-white/[0.03]"><Icon aria-hidden="true" className="size-4" /></span>
                    <div><p className="mono text-[9px] uppercase tracking-[0.13em] text-white/50">{entry.actor}</p><p className="mt-1 text-xs">{formatDate(entry.occurredAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div>
                    <div><h2 className="text-sm font-semibold">{entry.action}</h2><p className="mt-1 text-xs leading-5 text-white/60">{entry.summary}</p></div>
                    <div className="flex items-center gap-3"><StatusPill label={entry.execution.replace("_", " ")} /><ChevronDown aria-hidden="true" className="size-4 text-white/45 transition-transform group-open:rotate-180" /></div>
                  </summary>
                  <div className="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-3">
                    <div className="bg-[#101319] p-5"><p className="text-[10px] uppercase tracking-[0.13em] text-white/50">Why this record exists</p><p className="mt-3 text-xs leading-5 text-white/70">{entry.reason}</p></div>
                    <div className="bg-[#101319] p-5"><p className="text-[10px] uppercase tracking-[0.13em] text-white/50">Policy state</p><div className="mt-3"><PolicyPill policy={entry.policy} /></div><p className="mt-3 text-xs leading-5 text-white/70">{entry.policy.reason}</p></div>
                    <div className="bg-[#101319] p-5"><p className="text-[10px] uppercase tracking-[0.13em] text-white/50">Authorization</p><p className="mono mt-3 text-xs">{entry.approval.replace("_", " ")}</p>{entry.transactionHash && entry.explorerUrl ? <><p className="mono mt-3 break-all text-[10px] text-white/70">{entry.transactionHash}</p><a href={entry.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold text-[#8fb0ff] underline">Open onchain receipt</a></> : <p className="mt-3 text-xs leading-5 text-white/70">Workspace audit record. No onchain receipt is attached.</p>}</div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
        <Pagination page={current} pageCount={pageCount} onChange={changePage} label="Decision ledger pages" total={visible.length} pageSize={PAGE_SIZE} className="border-t border-white/[0.14] px-5 py-4" />
      </SectionCard></div>

      <div className="mt-6 border border-white/[0.14] bg-[#0b0b0d] p-5 text-white md:flex md:items-center md:justify-between md:gap-8">
        <div><p className="mono text-[9px] uppercase tracking-[0.16em] text-[#7fa6ff]">Audit trail</p><h2 className="mt-2 text-xl font-medium tracking-[-0.03em]">An explanation is not an execution receipt.</h2></div>
        <p className="mt-4 max-w-xl text-xs leading-5 text-white/50 md:mt-0">Confirmed transactions include a receipt and Arc Testnet explorer link. Quotes, approvals and failures are labeled separately from confirmed transactions.</p>
      </div>
    </PageBody>
  );
}
