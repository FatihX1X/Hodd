"use client";

/*
 * Visual pieces shared by the Obligations, Policy and Activity pages: calendar tiles, the 30-day
 * bill timeline, status chips, filter chips, the payment stepper and a labelled form field.
 * Colour is never the only signal: every mark also differs in shape and carries a word or label.
 */
import { useId, useState } from "react";
import clsx from "clsx";
import { AlarmClock, Bot, Check, CheckCircle2, CircleDashed, CircleUserRound, Clock3, Cog, Coins, Home, Landmark, Repeat, ScrollText, ShieldCheck, Store, Tag, Users, Wallet, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ActivityEntry, Obligation } from "@/lib/treasury/models";
import { formatDate } from "@/lib/treasury/format";
import { InfoTip, moneyColor } from "./visuals";

const DAY_MS = 86_400_000;
export const mutedColor = "rgba(244,241,232,0.55)";

/* ---------- Bill status, category, priority ---------- */

export type BillKind = "overdue" | "protected" | "planned" | "draft";
export const billColor: Record<BillKind, string> = { overdue: moneyColor.danger, protected: moneyColor.protected, planned: moneyColor.deployable, draft: mutedColor };
export const billKindLabel: Record<BillKind, string> = { overdue: "Overdue", protected: "Protected", planned: "Planned", draft: "Draft" };

export const statusMeta: Record<Obligation["status"], { icon: LucideIcon; label: string; color: string }> = {
  UPCOMING: { icon: Clock3, label: "Upcoming", color: "#9ec5f4" },
  OVERDUE: { icon: AlarmClock, label: "Overdue", color: moneyColor.danger },
  PAID: { icon: CheckCircle2, label: "Paid", color: moneyColor.safe },
  DRAFT: { icon: CircleDashed, label: "Draft", color: mutedColor },
};

export const categoryMeta: Record<Obligation["category"], { icon: LucideIcon; label: string }> = {
  PAYROLL: { icon: Users, label: "Payroll" },
  VENDOR: { icon: Store, label: "Vendor" },
  SUBSCRIPTION: { icon: Repeat, label: "Subscription" },
  RENT: { icon: Home, label: "Rent" },
  TAX: { icon: Landmark, label: "Tax" },
  OTHER: { icon: Tag, label: "Other" },
};

export const priorityMeta: Record<Obligation["priority"], { level: number; label: string; color: string }> = {
  CRITICAL: { level: 4, label: "Critical", color: moneyColor.danger },
  HIGH: { level: 3, label: "High", color: moneyColor.protected },
  NORMAL: { level: 2, label: "Normal", color: moneyColor.deployable },
  LOW: { level: 1, label: "Low", color: mutedColor },
};

/** Icon, colour and one word. The word keeps its source casing in the DOM and is shown in sentence case. */
export function StatusChip({ icon: Icon, label, color, className }: { icon: LucideIcon; label: string; color: string; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium", className)} style={{ color }}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" /><span className="lowercase first-letter:uppercase">{label}</span>
    </span>
  );
}

/** Priority as four rising bars. The word is available to screen readers and on hover. */
export function PriorityBars({ priority }: { priority: Obligation["priority"] }) {
  const meta = priorityMeta[priority];
  return (
    <span role="img" aria-label={`${meta.label} priority`} title={`${meta.label} priority`} className="inline-flex h-4 items-end gap-0.5">
      {[1, 2, 3, 4].map((step) => <span key={step} aria-hidden="true" className="w-1 rounded-[1px]" style={{ height: 4 + step * 3, background: step <= meta.level ? meta.color : "rgba(244,241,232,0.14)" }} />)}
    </span>
  );
}

/** A small calendar page: month on top, a big day number below. The date is also written out where this is used. */
export function CalendarTile({ iso, color = mutedColor, size = "md" }: { iso: string; color?: string; size?: "md" | "lg" }) {
  const month = formatDate(iso, { year: undefined, day: undefined });
  const day = formatDate(iso, { year: undefined, month: undefined });
  return (
    <span aria-hidden="true" className={clsx("grid shrink-0 grid-rows-[auto_1fr] overflow-hidden border text-center", size === "lg" ? "h-[68px] w-14" : "h-[52px] w-11")} style={{ borderColor: color }}>
      <span className="px-1 text-[10px] font-semibold leading-4 text-[#0b0b0d]" style={{ background: color }}>{month}</span>
      <span className={clsx("mono grid place-items-center font-medium tabular-nums", size === "lg" ? "text-2xl" : "text-lg")}>{day}</span>
    </span>
  );
}

/* ---------- Timeline of bills ---------- */

export type TimelineBill = Readonly<{ id: string; title: string; amount: number; amountLabel: string; dueAt: string; kind: BillKind }>;
const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const AXIS = 34, LANE = 40;

function markShape(kind: BillKind, color: string): React.CSSProperties {
  if (kind === "overdue") return { background: color, borderRadius: 3 };
  if (kind === "protected") return { background: color, borderRadius: 999 };
  if (kind === "planned") return { background: "rgba(127,166,255,0.16)", border: `2px solid ${color}`, borderRadius: 999 };
  return { background: "transparent", border: `2px dashed ${color}`, borderRadius: 999 };
}

/**
 * The next 30 days as one strip. Each bill is a mark placed on its due day and sized by amount; shape and colour
 * give its status (overdue square, protected solid circle, planned ring, draft dashed ring). Marks are buttons that select the bill.
 */
export function ObligationTimeline({ bills, from, selectedId, onSelect, days = 30, leadDays }: { bills: readonly TimelineBill[]; from: Date; selectedId: string | null; onSelect: (id: string) => void; days?: number; leadDays?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const origin = utcDay(from);
  const placed = bills.map((bill) => ({ bill, offset: Math.max(0, Math.floor((Date.parse(bill.dueAt) - origin) / DAY_MS)) }));
  const inside = placed.filter((item) => item.offset <= days).sort((a, b) => a.offset - b.offset || b.bill.amount - a.bill.amount);
  const later = placed.length - inside.length;
  const max = Math.max(...inside.map((item) => item.bill.amount), 0);
  const laneEnds: number[] = [];
  const marks = inside.map(({ bill, offset }) => {
    const pct = (offset / days) * 100;
    let lane = laneEnds.findIndex((end) => pct - end >= 9);
    if (lane === -1) lane = laneEnds.length < 4 ? laneEnds.length : laneEnds.indexOf(Math.min(...laneEnds));
    laneEnds[lane] = pct;
    const size = 16 + Math.round(Math.sqrt(max > 0 ? bill.amount / max : 0) * 18);
    return { bill, offset, pct, lane, size };
  });
  const lanes = Math.max(laneEnds.length, 1);
  const height = AXIS + lanes * LANE + 14;
  const counts = (["overdue", "protected", "planned", "draft"] as const).map((kind) => ({ kind, count: bills.filter((bill) => bill.kind === kind).length })).filter((item) => item.count > 0);
  const readout = marks.find((mark) => mark.bill.id === active)?.bill;
  const tick = (offset: number) => offset === 0 ? "Today" : formatDate(new Date(origin + offset * DAY_MS).toISOString(), { year: undefined });
  return (
    <div>
      <div role="group" aria-label={`Bills in the next ${days} days`} className="relative mx-5" style={{ height }}>
        {leadDays !== undefined && leadDays > 0 && <div aria-hidden="true" className="absolute inset-y-0 left-0" style={{ width: `${Math.min(leadDays / days, 1) * 100}%`, background: "linear-gradient(90deg, rgba(233,185,73,0.14), rgba(233,185,73,0.02))", borderLeft: `1px dashed ${moneyColor.protected}` }}></div>}
        <div aria-hidden="true" className="absolute inset-x-0 h-px bg-white/30" style={{ bottom: AXIS }} />
        {[0, 7, 14, 21, 28].filter((offset) => offset <= days).map((offset) => (
          <div key={offset} aria-hidden="true" className="absolute bottom-0" style={{ left: `${(offset / days) * 100}%` }}>
            <span className="absolute w-px bg-white/30" style={{ bottom: 0, height: AXIS, left: 0 }} />
            <span className={clsx("mono absolute bottom-0 whitespace-nowrap text-[11px] tabular-nums text-white/55", offset === 0 ? "left-1" : "-translate-x-1/2", (offset === 7 || offset === 21) && "max-sm:invisible")}>{tick(offset)}</span>
          </div>
        ))}
        {marks.map(({ bill, pct, lane, size }) => {
          const color = billColor[bill.kind];
          const bottom = AXIS + 8 + lane * LANE + (LANE - 8 - size) / 2;
          const selected = bill.id === selectedId;
          return (
            <div key={bill.id}>
              <span aria-hidden="true" className="absolute w-px" style={{ left: `${pct}%`, bottom: AXIS, height: bottom - AXIS, background: color, opacity: 0.35 }} />
              <button type="button" onClick={() => onSelect(bill.id)} onPointerEnter={() => setActive(bill.id)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(bill.id)} onBlur={() => setActive(null)} aria-pressed={selected} aria-label={`${bill.title}, due ${formatDate(bill.dueAt)}, ${bill.amountLabel}, ${billKindLabel[bill.kind].toLowerCase()}`}
                className="absolute grid place-items-center transition-transform duration-150 hover:scale-110 focus-visible:scale-110" style={{ left: `${pct}%`, bottom, width: size, height: size, marginLeft: -size / 2, ...markShape(bill.kind, color), outline: selected ? "2px solid #f4f1e8" : undefined, outlineOffset: 3 }}>
                {bill.kind === "overdue" && size >= 22 && <span aria-hidden="true" className="text-[11px] font-bold leading-none text-[#0b0b0d]">!</span>}
              </button>
            </div>
          );
        })}
        {marks.length === 0 && <p className="absolute inset-x-0 text-center text-xs text-white/50" style={{ bottom: AXIS + 18 }}>No bills due in the next {days} days.</p>}
      </div>
      <div className="mx-5 mt-3 flex min-h-5 flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
        <p className="mono min-w-0 text-white/70" aria-hidden={!readout}>{readout ? `${readout.title}, ${formatDate(readout.dueAt)}, ${readout.amountLabel}` : "Select a mark to open its plan"}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {counts.map(({ kind, count }) => (
            <li key={kind} className="inline-flex items-center gap-1.5 text-white/65"><span aria-hidden="true" className="size-2.5" style={{ ...markShape(kind, billColor[kind]), borderWidth: 1.5 }} />{billKindLabel[kind]}<span className="mono tabular-nums text-white/90">{count}</span></li>
          ))}
          {leadDays !== undefined && leadDays > 0 && <li className="inline-flex items-center gap-1.5 text-white/65"><span aria-hidden="true" className="size-2.5 border-l border-dashed" style={{ borderColor: moneyColor.protected, background: "rgba(233,185,73,0.25)" }} />Protected window<span className="mono tabular-nums text-white/90">{leadDays} days</span></li>}
          {later > 0 && <li className="text-white/50">{later} due later</li>}
        </ul>
      </div>
    </div>
  );
}

/* ---------- Filter chips ---------- */

export type ChipOption<T extends string> = Readonly<{ value: T; label: string; icon?: LucideIcon; count?: number }>;

/** Toggle buttons for a filter. aria-pressed carries the state; the count is decoration. */
export function ChipFilter<T extends string>({ label, options, value, onChange }: { label: string; options: readonly ChipOption<T>[]; value: T; onChange: (next: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const Icon = option.icon;
        const on = value === option.value;
        return (
          <button key={option.value} type="button" aria-pressed={on} onClick={() => onChange(option.value)} className={clsx("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors", on ? "border-[#f4f1e8] bg-[#f4f1e8] text-[#0b0b0d]" : "border-white/25 text-white/65 hover:border-white/50 hover:text-white")}>
            {Icon && <Icon aria-hidden="true" className="size-3.5" />}{option.label}
            {option.count !== undefined && <span aria-hidden="true" className={clsx("mono text-[11px] tabular-nums", on ? "text-[#0b0b0d]/60" : "text-white/40")}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Activity kinds ---------- */

export type ActivityKind = "wallet" | "payment" | "earn" | "policy" | "agent";
export const activityKindMeta: Record<ActivityKind, { icon: LucideIcon; label: string; color: string }> = {
  wallet: { icon: Wallet, label: "Wallet", color: "#9ec5f4" },
  payment: { icon: ScrollText, label: "Bill or payment", color: moneyColor.protected },
  earn: { icon: Coins, label: "Earn", color: moneyColor.MORPHO },
  policy: { icon: ShieldCheck, label: "Policy", color: moneyColor.safe },
  agent: { icon: Bot, label: "Agent", color: moneyColor.USYC },
};

/** The kind of event, read from what the record says it did. Agent actors always read as agent. */
export function activityKind(entry: Pick<ActivityEntry, "actor" | "action">): ActivityKind {
  if (entry.actor === "AGENT") return "agent";
  const text = entry.action.toLowerCase();
  if (/wallet|signer/.test(text)) return "wallet";
  if (/obligation|bill|payment|paid|invoice/.test(text)) return "payment";
  if (/earn|morpho|usyc|vault|allocation|target|strategy|deposit|withdraw/.test(text)) return "earn";
  return "policy";
}

export const actorMeta: Record<ActivityEntry["actor"], { icon: LucideIcon; label: string }> = {
  HUMAN: { icon: CircleUserRound, label: "Human" },
  AGENT: { icon: Bot, label: "Agent" },
  SYSTEM: { icon: Cog, label: "System" },
};

/* ---------- Payment stepper ---------- */

const completedSteps: Record<string, number> = { REVIEW_REQUIRED: 1, AWAITING_SIGNATURE: 2, SUBMITTED: 3, UNKNOWN: 3, CONFIRMED: 4, FAILED: 3, CANCELLED: 1, EXPIRED: 1 };

/** Where a payment is: reviewed, confirmed by you, signed in your wallet, verified onchain. */
export function PaymentSteps({ state, labels = ["Review", "Confirm", "Sign", "Verified"] }: { state: string | null; labels?: readonly string[] }) {
  const completed = state === null ? 0 : completedSteps[state] ?? 0;
  const failed = state === "FAILED" || state === "CANCELLED" || state === "EXPIRED";
  return (
    <ol aria-label="Payment progress" className="flex items-start">
      {labels.map((label, index) => {
        const done = index < completed;
        const stopped = failed && index === completed;
        const current = !failed && index === completed;
        const color = done ? moneyColor.safe : stopped ? moneyColor.danger : current ? moneyColor.deployable : "rgba(244,241,232,0.3)";
        return (
          <li key={label} aria-current={current ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
            {index > 0 && <span aria-hidden="true" className="absolute right-1/2 top-3 h-px w-full" style={{ background: done || current || stopped ? color : "rgba(244,241,232,0.18)" }} />}
            <span className="relative grid size-6 place-items-center rounded-full border bg-[#101319]" style={{ borderColor: color, color }}>
              {done ? <Check aria-hidden="true" className="size-3.5" /> : stopped ? <X aria-hidden="true" className="size-3.5" /> : <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: color }} />}
            </span>
            <span className="text-[11px] text-white/60">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Form field ---------- */

/** A visible label (and optional info tip) outside the control, tied to it with htmlFor. The control keeps its own aria-label. */
export function Field({ label, tip, tipLabel, className, labelClassName = "text-xs font-semibold", children }: { label: string; tip?: React.ReactNode; tipLabel?: string; className?: string; labelClassName?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      <div className={clsx("flex items-center gap-1", labelClassName)}><label htmlFor={id}>{label}</label>{tip && <InfoTip label={tipLabel ?? `About ${label.toLowerCase()}`}>{tip}</InfoTip>}</div>
      {children(id)}
    </div>
  );
}
