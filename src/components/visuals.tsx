"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import { Info, LockKeyhole } from "lucide-react";
import { LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import type { Money } from "@/lib/treasury/models";
import { formatMoney } from "@/lib/treasury/format";
import { strategyColor } from "@/lib/treasury/views";

/*
 * Hodd's visual vocabulary. Every kind of money keeps one colour everywhere in the console:
 * liquid USDC, Morpho, USYC and the protected (locked) share. Visuals never carry information
 * alone: each has a text equivalent (aria-label, legend or visible figure).
 */
export const moneyColor = {
  ...strategyColor,
  protected: "#e9b949",
  deployable: "#7fa6ff",
  safe: "#7fe3a8",
  danger: "#ff9a92",
} as const;

const EASE = [0.19, 1, 0.22, 1] as const;
const minor = (money: Money) => Number(BigInt(money.minorUnits)) / 10 ** money.decimals;

/** A ring that fills to `ratio` (0..1). The centre carries the figure; the label is for screen readers. */
export function Ring({ ratio, label, color = moneyColor.deployable, size = 72, stroke = 6, children, className }: { ratio: number | null; label: string; color?: string; size?: number; stroke?: number; children?: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const value = ratio === null || !Number.isFinite(ratio) ? 0 : Math.max(0, Math.min(ratio, 1));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <LazyMotion features={domAnimation} strict>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className={clsx("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(244,241,232,0.10)" strokeWidth={stroke} />
          <m.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="butt" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value) }} transition={{ duration: reduced ? 0 : 1.1, ease: EASE }} />
        </svg>
        {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
      </div>
    </LazyMotion>
  );
}

/** A tiny line of values, for trends next to a figure. */
export function Spark({ values, color = moneyColor.deployable, width = 120, height = 32, label, marker }: { values: readonly number[]; color?: string; width?: number; height?: number; label: string; marker?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values, marker ?? Infinity), hi = Math.max(...values, marker ?? -Infinity);
  const span = hi - lo || 1;
  const y = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * width).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {marker !== undefined && <line x1={0} x2={width} y1={y(marker)} y2={y(marker)} stroke={moneyColor.protected} strokeOpacity={0.55} strokeDasharray="3 3" />}
      <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={color} fillOpacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={width} cy={y(values[values.length - 1])} r={2.5} fill={color} />
    </svg>
  );
}

export type ReservoirPart = Readonly<{ key: string; label: string; money: Money; color: string }>;

/**
 * The treasury as one band: what it is held in (segments, most liquid first) and, above it, how much
 * is locked for bills and the buffer versus what may be deployed. Fills once on load.
 */
export function Reservoir({ parts, total, protectedMoney, deployable }: { parts: readonly ReservoirPart[]; total: Money; protectedMoney: Money; deployable: Money }) {
  const reduced = useReducedMotion();
  const totalValue = Math.max(minor(total), 0);
  const share = (money: Money) => totalValue > 0 ? Math.max(0, Math.min(minor(money) / totalValue, 1)) : 0;
  const locked = share(protectedMoney);
  const free = share(deployable);
  const visible = parts.filter((part) => minor(part.money) > 0);
  let offset = 0;
  const summary = `${formatMoney(total)} in total: ${parts.map((part) => `${part.label} ${formatMoney(part.money)}`).join(", ")}. Protected ${formatMoney(protectedMoney)}, deployable ${formatMoney(deployable)}.`;
  return (
    <LazyMotion features={domAnimation} strict>
      <figure className="m-0" aria-label={summary}>
        <div aria-hidden="true" className="relative">
          {/* the brackets: locked for bills on the left, free to deploy on the right */}
          <div className="relative mb-2 h-8 text-[12px]">
            {locked > 0 && <m.div className="absolute inset-y-0 left-0 flex items-end border-l border-t pb-1.5 pl-2" style={{ borderColor: moneyColor.protected, color: moneyColor.protected }} initial={{ width: 0, opacity: 0 }} animate={{ width: `${locked * 100}%`, opacity: 1 }} transition={{ duration: reduced ? 0 : 0.9, delay: reduced ? 0 : 0.45, ease: EASE }}>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><LockKeyhole className="size-3" />Protected</span>
            </m.div>}
            {free > 0 && <m.div className="absolute inset-y-0 right-0 flex items-end justify-end border-r border-t pb-1.5 pr-2" style={{ borderColor: moneyColor.deployable, color: moneyColor.deployable }} initial={{ width: 0, opacity: 0 }} animate={{ width: `${free * 100}%`, opacity: 1 }} transition={{ duration: reduced ? 0 : 0.9, delay: reduced ? 0 : 0.6, ease: EASE }}>
              <span className="whitespace-nowrap">Deployable</span>
            </m.div>}
          </div>
          <div className="relative flex h-14 overflow-hidden bg-white/[0.06]">
            {visible.map((part, index) => {
              const width = share(part.money) * 100;
              const left = offset; offset += width;
              return <m.div key={part.key} className="absolute inset-y-0" style={{ left: `${left}%`, background: part.color }} initial={{ width: 0 }} animate={{ width: `${width}%` }} transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : index * 0.12, ease: EASE }} />;
            })}
            {locked > 0 && <m.div className="absolute inset-y-0 left-0" style={{ backgroundImage: `repeating-linear-gradient(135deg, rgba(11,11,13,0.55) 0 2px, transparent 2px 7px)` }} initial={{ width: 0 }} animate={{ width: `${locked * 100}%` }} transition={{ duration: reduced ? 0 : 0.9, delay: reduced ? 0 : 0.45, ease: EASE }} />}
          </div>
        </div>
        <figcaption className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
          {parts.map((part) => (
            <span key={part.key} className="inline-flex items-center gap-2 text-white/70">
              <span aria-hidden="true" className="size-2.5" style={{ background: part.color }} />
              {part.label}
              <span className="mono tabular-nums text-white/90">{formatMoney(part.money, { compact: true })}</span>
            </span>
          ))}
        </figcaption>
      </figure>
    </LazyMotion>
  );
}

/**
 * Explanatory text behind a small info button, so pages lead with figures and pictures and the
 * reasoning stays one click away (nothing is removed).
 */
export function InfoTip({ label = "More about this", children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={clsx("relative inline-flex align-middle", className)}>
      <button type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)} onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setOpen(false); }} className="grid size-7 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white">
        <Info aria-hidden="true" className="size-3.5" />
      </button>
      <span id={id} role="note" hidden={!open} className="absolute left-1/2 top-full z-30 mt-1 w-72 -translate-x-1/2 border border-white/20 bg-[#1a1d26] p-3 text-left text-[12px] font-normal normal-case leading-5 tracking-normal text-white/75 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">{children}</span>
    </span>
  );
}

/** A labelled figure with an optional visual beside it: the compact replacement for KPI cells with a sentence each. */
export function Figure({ label, value, visual, tip, tone, className }: { label: string; value: React.ReactNode; visual?: React.ReactNode; tip?: React.ReactNode; tone?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center justify-between gap-4 bg-[#101319] p-5", className)}>
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-[12px] text-white/55">{label}{tip && <InfoTip label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>}</p>
        <div className="mono mt-2 text-2xl font-medium tabular-nums tracking-[-0.03em]" style={tone ? { color: tone } : undefined}>{value}</div>
      </div>
      {visual}
    </div>
  );
}
