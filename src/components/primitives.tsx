"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Money, PolicyResult } from "@/lib/treasury/models";
import { formatMoney } from "@/lib/treasury/format";

/** Mono label used for field names, column heads and captions. */
export const labelClass = "mono text-[10px] uppercase tracking-[0.14em] text-white/55";

/** Button recipes for the dark theme. Primary is paper on ink; ghost is a hairline outline. */
export const buttonClass = {
  primary: "mono inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] border border-[#f4f1e8] bg-[#f4f1e8] px-4 text-[11px] font-medium uppercase tracking-[0.09em] text-[#0b0b0d] transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#0a52e8] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none",
  ghost: "mono inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] border border-white/30 px-4 text-[11px] font-medium uppercase tracking-[0.09em] text-[#f4f1e8] transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#f4f1e8] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none",
} as const;

export const inputClass = "mt-2 w-full border border-white/25 bg-[#0b0b0d] px-3 py-2.5 text-sm text-[#f4f1e8] outline-none placeholder:text-white/35 focus:border-[#7fa6ff]";

export function PageHeader({ eyebrow, title, description, aside, compact = false }: { eyebrow: string; title: string; description: string; aside?: React.ReactNode; compact?: boolean }) {
  return (
    <header className={clsx("ink-grid border-b border-white/10 px-5 text-white md:px-8 lg:px-10", compact ? "py-7 md:py-9" : "py-10 md:py-14")}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-7 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.22em] text-[#7fa6ff]">{eyebrow}</p>
          <h1 className={clsx("disp mt-4", compact ? "text-[clamp(1.75rem,4.4vw,2.5rem)]" : "text-[clamp(1.75rem,5.4vw,3.25rem)]")}>{title}</h1>
          <p className={clsx("max-w-2xl text-sm leading-6 text-white/60 md:text-base", compact ? "mt-3" : "mt-5")}>{description}</p>
        </div>
        {aside}
      </div>
    </header>
  );
}

export function TreasuryNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="border-b border-white/10 bg-[#101319] px-5 py-3 md:px-8 lg:px-10" role="note">
      <div className="mx-auto flex max-w-[1440px] items-start gap-3 text-xs leading-5 text-[#c9cbd3]">
        <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 bg-[#7fa6ff]" />
        {children ?? "Live Arc Testnet balances · your own wallet signs every transaction."}
      </div>
    </div>
  );
}

/** Page body: the same 120px ruled grid as the landing page, on ink. */
export function PageBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-10 lg:py-10", className)}>{children}</div>;
}

export function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx("border border-white/[0.14] bg-[#101319]", className)}>{children}</section>;
}

export function SectionHeading({ index, title, description, action }: { index: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-white/[0.14] px-5 py-4">
      <div className="flex min-w-0 gap-4">
        <span className="mono mt-1 text-[10px] text-white/45">{index}</span>
        <div><h2 className="disp text-[15px]">{title}</h2>{description && <p className="mt-2 text-xs leading-5 text-white/55">{description}</p>}</div>
      </div>
      {action}
    </div>
  );
}

export function MoneyValue({ money, compact = false, className = "" }: { money: Money; compact?: boolean; className?: string }) {
  return <span className={clsx("mono tabular-nums", className)}>{formatMoney(money, { compact })}</span>;
}

type Tone = "success" | "warning" | "danger" | "neutral" | "info";
const toneStyles: Record<Tone, { text: string; dot: string }> = {
  success: { text: "text-[#7fe3a8]", dot: "bg-[#2fcf2f]" },
  warning: { text: "text-[#ffd27f]", dot: "border border-[#fab219] bg-[linear-gradient(90deg,#fab219_50%,transparent_50%)]" },
  danger: { text: "text-[#ff9a92]", dot: "bg-[#ec5b5b]" },
  info: { text: "text-[#9ec5f4]", dot: "border-[1.5px] border-[#6da7ec]" },
  neutral: { text: "text-white/65", dot: "border-[1.5px] border-[#898781]" },
};

/** Status as shape + word: filled, half, square or ring, never colour alone. */
export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const style = toneStyles[tone];
  return (
    <span className={clsx("mono inline-flex items-center gap-2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em]", style.text)}>
      <span aria-hidden="true" className={clsx("size-2 shrink-0", tone === "danger" ? "rounded-[1px]" : "rounded-full", style.dot)} />
      {label}
    </span>
  );
}

export function PolicyPill({ policy }: { policy: PolicyResult }) {
  const tone = policy.status === "PASS" ? "success" : policy.status === "BLOCKED" ? "danger" : policy.status === "REVIEW" ? "warning" : "neutral";
  return <StatusPill label={policy.status.replace("_", " ")} tone={tone} />;
}

/** One figure in a row of figures. Cells share 1px hairlines, like the landing page ledger. */
export function KpiGrid({ children, className = "", label, columns = 4 }: { children: React.ReactNode; className?: string; label?: string; columns?: 3 | 4 }) {
  return <section aria-label={label} className={clsx("grid gap-px border border-white/[0.14] bg-white/[0.14] sm:grid-cols-2", columns === 4 ? "xl:grid-cols-4" : "lg:grid-cols-3", className)}>{children}</section>;
}

export function Kpi({ label, value, detail, accent = false }: { label: string; value: React.ReactNode; detail?: string; accent?: boolean }) {
  return (
    <article className="min-h-36 bg-[#101319] p-5">
      <p className={labelClass}>{label}</p>
      <div className={clsx("mt-5 block text-3xl font-medium tracking-[-0.04em]", accent && "text-[#9ec5f4]")}>{value}</div>
      {detail && <p className="mt-3 text-xs text-white/50">{detail}</p>}
    </article>
  );
}

/** A ratio against a limit. The fill carries severity; the track is a darker step of the same blue. */
export function Meter({ ratio, label, className = "" }: { ratio: number | null; label: string; className?: string }) {
  const value = ratio === null ? 0 : Math.max(0, Math.min(ratio, 1));
  const fill = ratio !== null && ratio > 1 ? "#ec5b5b" : ratio !== null && ratio > 0.85 ? "#fab219" : "#5598e7";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className={clsx("h-2 bg-[#0d366b]", className)}>
      <div className="h-full" style={{ width: `${value * 100}%`, background: fill }} />
    </div>
  );
}

/** A group of toggle buttons (filters, ranges). aria-pressed carries the state. */
export function FilterGroup<T extends string>({ label, options, value, onChange }: { label: string; options: readonly T[]; value: T; onChange: (next: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap border border-white/30">
      {options.map((option, index) => (
        <button key={option} type="button" onClick={() => onChange(option)} aria-pressed={value === option} className={clsx("mono min-h-11 min-w-12 px-3.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors", index > 0 && "border-l border-white/30", value === option ? "bg-[#f4f1e8] text-[#0b0b0d]" : "text-white/55 hover:text-white")}>{option}</button>
      ))}
    </div>
  );
}

/** Page numbers to show: the first, the last and the current page with its neighbours. null marks a gap; a gap of one page shows that page instead. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  const shown = [...new Set([1, page - 1, page, page + 1, pageCount])].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  return shown.flatMap((n, index) => { const gap = index ? n - shown[index - 1] : 0; return gap === 2 ? [n - 1, n] : gap > 2 ? [null, n] : [n]; });
}

// The global button:focus-visible rule is unlayered, so the outline colour needs `!` to win over the utility layer.
const pagerButton = "mono inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline-[#7fa6ff]! disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Previous / numbered / next controls for a client-side paginated list. `page` is 1-based and renders nothing for a single page.
 * Below `sm` the numbers give way to "Page 2 of 5" so the controls never overflow a 360px screen. Pass `total` and `pageSize` for a "11–20 of 47" range.
 */
export function Pagination({ page, pageCount, onChange, label, total, pageSize, className = "" }: { page: number; pageCount: number; onChange: (page: number) => void; label: string; total?: number; pageSize?: number; className?: string }) {
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(page, 1), pageCount);
  const range = total !== undefined && pageSize !== undefined ? `${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, total)} of ${total}` : null;
  const step = "shrink-0 border-white/[0.14] bg-[#0b0b0d] text-[#f4f1e8] enabled:hover:bg-white/[0.06]";
  return (
    <nav aria-label={label} className={clsx("flex flex-wrap items-center justify-between gap-x-6 gap-y-3", className)}>
      {range && <p className="mono text-[11px] tabular-nums text-white/55">{range}</p>}
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
        <button type="button" disabled={current <= 1} onClick={() => onChange(current - 1)} className={clsx(pagerButton, step)}><ChevronLeft aria-hidden="true" className="size-3.5" />Previous</button>
        <p className="mono min-w-0 text-center text-[10px] uppercase tracking-[0.12em] text-white/55 sm:hidden">Page {current} of {pageCount}</p>
        <ol className="hidden items-center gap-1 sm:flex">
          {pageWindow(current, pageCount).map((n, index) => n === null
            ? <li key={`gap-${index}`} aria-hidden="true" className="mono min-w-6 text-center text-[11px] text-white/45">…</li>
            : <li key={n}><button type="button" onClick={() => onChange(n)} aria-label={`Page ${n}`} aria-current={n === current ? "page" : undefined} className={clsx(pagerButton, "tabular-nums", n === current ? "border-[#f4f1e8] bg-[#f4f1e8] text-[#0b0b0d]" : "border-white/[0.14] bg-[#0b0b0d] text-white/55 hover:text-white")}>{n}</button></li>)}
        </ol>
        <button type="button" disabled={current >= pageCount} onClick={() => onChange(current + 1)} className={clsx(pagerButton, step)}>Next<ChevronRight aria-hidden="true" className="size-3.5" /></button>
      </div>
    </nav>
  );
}
