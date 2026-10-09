"use client";

import { useState } from "react";
import clsx from "clsx";
import { formatDate } from "@/lib/treasury/format";
import type { AllocationRow, RunwaySeries, WeekBucket } from "@/lib/treasury/views";
import { liquidityLabels } from "@/lib/treasury/views";
import { FilterGroup, labelClass } from "./primitives";

/*
 * Charts follow one spec: thin marks, hairline gridlines, direct labels only where they matter, a hover
 * readout that never gates information (a table view carries every value), and text in text tokens.
 * Series use the validated blue ramp on the dark panel surface (#101319).
 */

const LINE = "#6da7ec";
const GRID = "rgba(244,241,232,0.10)";
const AXIS = "rgba(244,241,232,0.30)";
const fixed = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (value: number) => Math.abs(value) >= 1000 ? `${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K` : value.toLocaleString("en-US", { maximumFractionDigits: 0 });
const dayLabel = (ms: number) => formatDate(new Date(ms).toISOString(), { year: undefined, month: "short", day: "numeric" });

function niceMax(value: number) {
  if (value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * exponent;
}

function Tooltip({ left, children }: { left: string; children: React.ReactNode }) {
  return <div role="status" className="pointer-events-none absolute top-0 z-10 min-w-40 border border-white/25 bg-[#1a1d26] px-3 py-2.5" style={{ left, transform: "translateX(-50%)" }}>{children}</div>;
}

/** Treasury balance after each protected obligation, over the policy horizon. */
export function RunwayChart({ series }: { series: RunwaySeries }) {
  const [view, setView] = useState<"Chart" | "Table">("Chart");
  const [hover, setHover] = useState<number | null>(null);
  const { points, buffer } = series;
  const values = points.map((point) => point.value);
  const hi = niceMax(Math.max(...values, buffer));
  const low = Math.min(...values, 0);
  const lo = low < 0 ? -niceMax(-low) : 0;
  const y = (value: number) => (1 - (value - lo) / (hi - lo)) * 100;
  const x = (index: number) => (points.length === 1 ? 0 : (index / (points.length - 1)) * 100);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(3)} ${y(point.value).toFixed(3)}`).join(" ");
  const ticks = Array.from(new Set([lo, ...(lo < 0 ? [0] : []), (lo + hi) / 2, hi]));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(fraction * (points.length - 1)));
  const active = hover === null ? null : points[hover];
  const end = points[points.length - 1];
  const summary = `Projected treasury balance over ${series.horizonDays} days: ${fixed(series.start)} today, ${fixed(end.value)} after protected obligations.`;

  return (
    <div>
      <div className="mb-4 flex justify-end"><FilterGroup label="Runway view" options={["Chart", "Table"] as const} value={view} onChange={setView} /></div>
      {view === "Chart" ? (
        <div className="relative h-[300px]" role="img" aria-label={summary}>
          <div className="absolute inset-y-0 left-[64px] right-4 top-3 bottom-8">
            {ticks.map((tick) => <div key={tick} className="absolute inset-x-0 h-px" style={{ top: `${y(tick)}%`, background: tick === 0 && lo < 0 ? AXIS : GRID }} />)}
            <div className="absolute inset-x-0 h-px bg-[#fab219]/60" style={{ top: `${y(buffer)}%` }} />
            <span className={clsx(labelClass, "absolute right-0 -translate-y-full pb-1 text-[#ffd27f]")} style={{ top: `${y(buffer)}%` }}>Safety buffer</span>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
              <path d={`${line} L100 100 L0 100 Z`} fill={LINE} fillOpacity="0.1" />
              <path d={line} fill="none" stroke={LINE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="[vector-effect:non-scaling-stroke]" />
            </svg>
            <div aria-hidden="true" className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#101319]" style={{ left: "100%", top: `${y(end.value)}%`, background: LINE }} />
            {active && <>
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white/45" style={{ left: `${x(hover!)}%` }} />
              <div aria-hidden="true" className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#101319]" style={{ left: `${x(hover!)}%`, top: `${y(active.value)}%`, background: LINE }} />
            </>}
            <div className="absolute -inset-3 cursor-crosshair" onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); const fraction = Math.min(1, Math.max(0, (event.clientX - box.left - 12) / (box.width - 24))); setHover(Math.round(fraction * (points.length - 1))); }} onPointerLeave={() => setHover(null)} />
          </div>
          {ticks.map((tick) => <div key={tick} className={clsx(labelClass, "absolute left-0 w-14 -translate-y-1/2 text-right")} style={{ top: `calc(12px + (100% - 44px) * ${y(tick) / 100})` }}>{compact(tick)}</div>)}
          {xTicks.map((index, tickIndex) => <div key={index} className={clsx(labelClass, "absolute bottom-1 whitespace-nowrap", (tickIndex === 1 || tickIndex === 3) && "max-sm:hidden")} style={{ left: `calc(64px + (100% - 80px) * ${x(index) / 100})`, transform: `translateX(${tickIndex === 0 ? "0" : tickIndex === xTicks.length - 1 ? "-100%" : "-50%"})` }}>{dayLabel(points[index].at)}</div>)}
          {active && (
            <div className="absolute inset-y-0 left-[64px] right-4"><Tooltip left={`clamp(80px, ${x(hover!)}%, calc(100% - 80px))`}>
              <p className="mono text-[15px] font-semibold tabular-nums">{fixed(active.value)} USDC</p>
              <p className={clsx(labelClass, "mt-1")}>{dayLabel(active.at)}{active.day === 0 ? " · today" : ""}</p>
              {active.due.map((item) => <p key={item.id} className="mt-1 text-xs text-[#c9cbd3]">− {fixed(item.amount)} · {item.title}</p>)}
            </Tooltip></div>
          )}
        </div>
      ) : (
        <div className="relative max-h-[300px] overflow-auto border border-white/10">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Projected treasury balance by day</caption>
            <thead><tr><th scope="col" className={clsx(labelClass, "px-4 py-3 text-left")}>Date</th><th scope="col" className={clsx(labelClass, "px-4 py-3 text-right")}>Balance</th><th scope="col" className={clsx(labelClass, "px-4 py-3 text-left")}>Due that day</th></tr></thead>
            <tbody>{points.map((point) => <tr key={point.day} className="border-t border-white/10"><td className="px-4 py-2.5 text-white/70">{dayLabel(point.at)}</td><td className="mono px-4 py-2.5 text-right tabular-nums">{fixed(point.value)}</td><td className="px-4 py-2.5 text-xs text-white/55">{point.due.length ? point.due.map((item) => `${item.title} (${fixed(item.amount)})`).join(", ") : "—"}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Protected outflows by week. Columns are capped at 24px with a 4px rounded top and a square base. */
export function WeeklyOutflowChart({ weeks }: { weeks: readonly WeekBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...weeks.map((week) => week.total), 0);
  const hi = niceMax(max || 1);
  const total = weeks.reduce((sum, week) => sum + week.total, 0);
  return (
    <div className="relative h-[280px]" role="img" aria-label={`Protected outflows by week for the next ${weeks.length} weeks: ${fixed(total)} USDC in total.`}>
      <div className="absolute inset-y-0 left-[64px] right-2 top-7 bottom-8">
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: GRID }} />
        <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: GRID }} />
        <div className="absolute inset-x-0 bottom-0 h-px" style={{ background: AXIS }} />
        <div className="absolute inset-0 flex">
          {weeks.map((week, index) => {
            const height = week.total > 0 ? Math.max(2, (week.total / hi) * 100) : 0;
            const hot = hover === index;
            return (
              <div key={week.start} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)}>
                {week.total > 0 && week.total === max && !hot && <span className={clsx(labelClass, "absolute whitespace-nowrap text-white")} style={{ bottom: `calc(${height}% + 6px)` }}>{compact(week.total)}</span>}
                <div className="w-[min(24px,60%)] rounded-t-[4px] transition-colors" style={{ height: `${height}%`, background: hot ? "#9ec5f4" : "#5598e7" }} />
                {hot && (
                  <div role="status" className="pointer-events-none absolute z-10 min-w-40 border border-white/25 bg-[#1a1d26] px-3 py-2.5" style={{ bottom: `calc(${height}% + 28px)`, left: index < 3 ? 0 : index > weeks.length - 4 ? "auto" : "50%", right: index > weeks.length - 4 ? 0 : "auto", transform: index < 3 || index > weeks.length - 4 ? "none" : "translateX(-50%)" }}>
                    <p className="mono text-[15px] font-semibold tabular-nums">{fixed(week.total)} USDC</p>
                    <p className={clsx(labelClass, "mt-1 whitespace-nowrap")}>Week of {dayLabel(week.start)}</p>
                    <p className="mt-1 text-xs text-[#c9cbd3]">{week.count === 0 ? "Nothing due" : week.titles.join(", ")}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {[0, 0.5, 1].map((fraction) => <div key={fraction} className={clsx(labelClass, "absolute left-0 w-14 -translate-y-1/2 text-right")} style={{ top: `calc(28px + (100% - 60px) * ${1 - fraction})` }}>{compact(hi * fraction)}</div>)}
      <div className="absolute bottom-1 left-[64px] right-2 flex">{weeks.map((week, index) => <div key={week.start} className={clsx(labelClass, "min-w-0 flex-1 overflow-visible whitespace-nowrap text-center", index % 2 === 1 ? "max-xl:invisible" : index % 4 === 2 && "max-md:invisible")}>{dayLabel(week.start)}</div>)}</div>
    </div>
  );
}

/** Part-to-whole: one stacked bar with 2px gaps, a legend that carries every value, and a hover readout. */
export function AllocationBar({ rows }: { rows: readonly AllocationRow[] }) {
  const [active, setActive] = useState<string | null>(null);
  if (rows.length === 0) return <p className="text-sm text-white/55">No balance is held in any strategy yet.</p>;
  const current = rows.find((row) => row.id === active);
  return (
    <div>
      <p className="mono mb-2.5 min-h-5 text-xs tabular-nums">{current ? `${current.name} · ${fixed(current.balance)} USDC · ${(current.share * 100).toFixed(1)}%` : "Hover a segment for detail"}</p>
      <div className="flex h-6 gap-0.5" role="img" aria-label={`Allocation by liquidity: ${rows.map((row) => `${row.name} ${(row.share * 100).toFixed(1)}%`).join(", ")}`}>
        {rows.map((row) => <div key={row.id} onPointerEnter={() => setActive(row.id)} onPointerLeave={() => setActive(null)} className="min-w-1 rounded-[2px] transition-opacity" style={{ flex: `${row.share} 1 0`, background: row.color, opacity: active === null || active === row.id ? 1 : 0.4 }} />)}
      </div>
      <ul className="mt-5 flex flex-col">
        {rows.map((row) => (
          <li key={row.id} onPointerEnter={() => setActive(row.id)} onPointerLeave={() => setActive(null)} className="flex items-center gap-3 border-t border-white/10 py-3 transition-opacity" style={{ opacity: active === null || active === row.id ? 1 : 0.45 }}>
            <span aria-hidden="true" className="size-3 shrink-0 rounded-[2px]" style={{ background: row.color }} />
            <span className="min-w-0 flex-1"><span className="block text-sm">{row.name}</span><span className={labelClass}>{liquidityLabels[row.liquidity]}</span></span>
            <span className="text-right"><span className="mono block text-sm tabular-nums">{compact(row.balance)}</span><span className={labelClass}>{(row.share * 100).toFixed(1)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
