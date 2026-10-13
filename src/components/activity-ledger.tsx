"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Ban, ChevronDown, CheckCircle2, CircleDashed, CircleHelp, FileText, Hourglass, ListTree, Network, ShieldCheck, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation } from "motion/react";
import * as m from "motion/react-m";
import { EmptyState } from "./page-states";
import { ChipFilter, StatusChip, actorMeta, activityKind, activityKindMeta, type ActivityKind, type ChipOption } from "./ledger-visuals";
import { PageBody, Pagination, PolicyPill, SectionCard, SectionHeading, labelClass } from "./primitives";
import { InfoTip, moneyColor } from "./visuals";
import { formatDate } from "@/lib/treasury/format";
import type { ActivityEntry } from "@/lib/treasury/models";

type ActorFilter = "ALL" | ActivityEntry["actor"];
const PAGE_SIZE = 10;
const muted = "rgba(244,241,232,0.55)";
const executionMeta: Record<ActivityEntry["execution"], { icon: LucideIcon; color: string }> = {
  LOCAL_ONLY: { icon: FileText, color: muted },
  DEMO_ONLY: { icon: FileText, color: muted },
  NOT_STARTED: { icon: CircleDashed, color: muted },
  SUBMITTED: { icon: Hourglass, color: moneyColor.protected },
  COMPLETE: { icon: CheckCircle2, color: moneyColor.safe },
  PARTIAL: { icon: AlertTriangle, color: moneyColor.protected },
  FAILED: { icon: XCircle, color: moneyColor.danger },
  UNKNOWN: { icon: CircleHelp, color: moneyColor.protected },
};
const approvalMeta: Record<ActivityEntry["approval"], { icon: LucideIcon; color: string }> = {
  NOT_REQUIRED: { icon: Ban, color: muted },
  PENDING: { icon: Hourglass, color: moneyColor.protected },
  APPROVED: { icon: CheckCircle2, color: moneyColor.safe },
  DENIED: { icon: XCircle, color: moneyColor.danger },
};

export function ActivityLedger({ activities }: { activities: ActivityEntry[] }) {
  // Read directly: the hook would subscribe to a media query that some environments do not fully provide.
  const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [filter, setFilter] = useState<ActorFilter>("ALL");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Entries only animate after the person has filtered or turned a page; the first paint stays still.
  const [acted, setActed] = useState(false);
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
  const changePage = (next: number) => { if (next === current) return; userMovedPage.current = true; setActed(true); setPage(next); };
  const toggle = (id: string) => setExpanded((open) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const count = (actor: ActivityEntry["actor"]) => activities.filter((entry) => entry.actor === actor).length;
  const options: ChipOption<ActorFilter>[] = [
    { value: "ALL", label: "All", count: activities.length },
    { value: "HUMAN", label: actorMeta.HUMAN.label, icon: actorMeta.HUMAN.icon, count: count("HUMAN") },
    { value: "AGENT", label: actorMeta.AGENT.label, icon: actorMeta.AGENT.icon, count: count("AGENT") },
    { value: "SYSTEM", label: actorMeta.SYSTEM.label, icon: actorMeta.SYSTEM.icon, count: count("SYSTEM") },
  ];
  const kindsShown = (Object.keys(activityKindMeta) as ActivityKind[]).filter((kind) => visible.some((entry) => activityKind(entry) === kind));

  return (
    <LazyMotion features={domAnimation} strict>
      <PageBody>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <ChipFilter label="Filter activity by actor" options={options} value={filter} onChange={(next) => { setFilter(next); setPage(1); setActed(true); }} />
          <div className="flex items-center gap-1"><span aria-hidden="true" className="mr-1 size-1.5 bg-[#7fa6ff]" /><span className={labelClass}>Local audit trail</span><InfoTip label="About the audit trail">An explanation is not an execution receipt. Confirmed transactions include a receipt and Arc Testnet explorer link. Quotes, approvals and failures are labeled separately from confirmed transactions.</InfoTip></div>
        </div>

        <div ref={cardRef} className="scroll-mt-20"><SectionCard>
          <SectionHeading icon={<ListTree className="size-4" />} title="Decision ledger" action={<InfoTip label="About the decision ledger" className="-my-1">Expand a record to inspect rationale, policy and authorization state.</InfoTip>} />
          {kindsShown.length > 0 && <ul aria-label="Kinds of events" className="flex flex-wrap gap-x-5 gap-y-1 border-b border-white/10 px-5 py-3 text-[12px] text-white/60">{kindsShown.map((kind) => { const meta = activityKindMeta[kind]; const Icon = meta.icon; return <li key={kind} className="inline-flex items-center gap-1.5"><Icon aria-hidden="true" className="size-3.5" style={{ color: meta.color }} />{meta.label}</li>; })}</ul>}
          {visible.length === 0 ? <EmptyState title="No matching records" description="Choose another actor type to inspect treasury activity." /> : (
            <div ref={listRef} role="region" aria-label={`Decision ledger entries${pageCount > 1 ? `, page ${current} of ${pageCount}` : ""}`} tabIndex={-1} className="px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#7fa6ff] sm:px-5">
              <m.ol key={`${filter}-${current}`} initial={acted && !reduced ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.25 }} className="relative before:absolute before:bottom-6 before:left-5 before:top-6 before:w-px before:bg-white/15">
                {entries.map((entry) => {
                  const kind = activityKindMeta[activityKind(entry)];
                  const KindIcon = kind.icon;
                  const actor = actorMeta[entry.actor];
                  const ActorIcon = actor.icon;
                  const exec = executionMeta[entry.execution];
                  const approval = approvalMeta[entry.approval];
                  const open = expanded.has(entry.id);
                  const panel = `activity-detail-${entry.id}`;
                  return (
                    <li key={entry.id} className="relative pl-14">
                      <span aria-hidden="true" className="absolute left-0 top-4 grid size-10 place-items-center rounded-full border bg-[#101319]" style={{ borderColor: kind.color, color: kind.color }}><KindIcon className="size-4" /></span>
                      <div className="border-b border-white/10 py-4 last:border-b-0">
                        <div className="flex cursor-pointer items-start gap-3" onClick={() => toggle(entry.id)}>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55"><span className="mono tabular-nums">{formatDate(entry.occurredAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><span className="inline-flex items-center gap-1.5"><ActorIcon aria-hidden="true" className="size-3.5" />{actor.label}</span></p>
                            <h2 className="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">{entry.action}</h2>
                            <p className="mt-1 text-xs leading-5 text-white/60">{entry.summary}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <StatusChip icon={exec.icon} label={entry.execution.replace("_", " ")} color={exec.color} className="max-sm:hidden" />
                            <button type="button" aria-expanded={open} aria-controls={panel} aria-label={`Details for ${entry.action}`} onClick={(event) => { event.stopPropagation(); toggle(entry.id); }} className="grid size-11 place-items-center text-white/55 hover:text-white"><ChevronDown aria-hidden="true" className={clsx("size-4 transition-transform", open && "rotate-180")} /></button>
                          </div>
                        </div>
                        <StatusChip icon={exec.icon} label={entry.execution.replace("_", " ")} color={exec.color} className="mt-1 sm:hidden" />
                        <AnimatePresence initial={false}>
                          {open && (
                            <m.div id={panel} key="detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.25 }} className="overflow-hidden">
                              <div className="mt-3 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-3">
                                <div className="bg-[#101319] p-4"><p className="flex items-center gap-1.5 text-xs text-white/55"><FileText aria-hidden="true" className="size-3.5" />Why this record exists</p><p className="mt-3 text-xs leading-5 text-white/70">{entry.reason}</p></div>
                                <div className="bg-[#101319] p-4"><p className="flex items-center gap-1.5 text-xs text-white/55"><ShieldCheck aria-hidden="true" className="size-3.5" />Policy state</p><div className="mt-3"><PolicyPill policy={entry.policy} /></div><p className="mt-3 text-xs leading-5 text-white/70">{entry.policy.reason}</p></div>
                                <div className="bg-[#101319] p-4"><p className="flex items-center gap-1.5 text-xs text-white/55"><Network aria-hidden="true" className="size-3.5" />Authorization</p><div className="mt-3"><StatusChip icon={approval.icon} label={entry.approval.replace("_", " ")} color={approval.color} /></div>{entry.transactionHash && entry.explorerUrl ? <><p className="mono mt-3 break-all text-[10px] text-white/70">{entry.transactionHash}</p><a href={entry.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold text-[#8fb0ff] underline">Open onchain receipt</a></> : <p className="mt-3 text-xs leading-5 text-white/70">Workspace audit record. No onchain receipt is attached.</p>}</div>
                              </div>
                            </m.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </li>
                  );
                })}
              </m.ol>
            </div>
          )}
          <Pagination page={current} pageCount={pageCount} onChange={changePage} label="Decision ledger pages" total={visible.length} pageSize={PAGE_SIZE} className="border-t border-white/[0.14] px-5 py-4" />
        </SectionCard></div>
      </PageBody>
    </LazyMotion>
  );
}
