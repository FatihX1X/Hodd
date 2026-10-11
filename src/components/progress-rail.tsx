"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { labelClass } from "./primitives";

export type StepState = "done" | "active" | "waiting" | "skipped" | "failed" | "unknown";
export type Step = Readonly<{ key: string; label: string; state: StepState; note: string }>;
/** "idle" is a calm end without a result: nothing was needed, so nothing is green or red. */
export type RailOutcome = "running" | "done" | "idle" | "failed" | "unknown";

const EASE_OUT = [0.19, 1, 0.22, 1] as const;
const tone: Record<StepState, string> = { done: "text-[#f4f1e8]", active: "text-[#f4f1e8]", waiting: "text-white/55", skipped: "text-white/55", failed: "text-[#ff9a92]", unknown: "text-[#ffd27f]" };
const said: Record<StepState, string> = { done: "done", active: "in progress", waiting: "not started", skipped: "skipped", failed: "stopped", unknown: "outcome unknown" };

function Spark() {
  return <svg viewBox="0 0 200 200" width="18" height="18" aria-hidden="true"><path d="M100 0Q110 90 200 100Q110 110 100 200Q90 110 0 100Q90 90 100 0Z" fill="currentColor" /></svg>;
}

/** A progress rail: the spark moves to the active milestone, the fill follows it, and the caption says what is happening. */
export function ProgressRail({ label, steps, active, outcome, caption, link, className = "m-5" }: { label: string; steps: readonly Step[]; active: number; outcome: RailOutcome; caption: string; link?: Readonly<{ href: string; text: string }> | null; className?: string }) {
  const reduced = useReducedMotion();
  const last = steps.length - 1;
  const fill = last > 0 ? active / last : 1;
  const finished = outcome === "done";
  const halted = outcome === "failed" || outcome === "unknown";
  const accent = halted ? (outcome === "failed" ? "#ff9a92" : "#ffd27f") : "#7fa6ff";
  const move = { duration: reduced ? 0 : 0.8, ease: EASE_OUT };
  const inset = `${50 / steps.length}%`;
  return (
    <LazyMotion features={domAnimation} strict>
      <section aria-label={label} className={`${className} border border-white/[0.14] bg-[#0b0b0d]`}>
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <span className={labelClass}>{label}</span>
          <span className={`${labelClass} tabular-nums`}>{outcome === "idle" ? "Nothing to do" : `Step ${active + 1} of ${steps.length}`}</span>
        </div>
        <div className="px-1 pb-4 pt-8">
          {/* Clip sideways only: the moving layer is as wide as the track and must not add a scrollbar. */}
          <div aria-hidden="true" className="relative h-6 overflow-x-clip">
            <div className="absolute top-1/2 h-px -translate-y-1/2 bg-white/15" style={{ left: inset, right: inset }}>
              <m.div className="absolute inset-0 origin-left" style={{ backgroundColor: accent }} initial={false} animate={{ scaleX: fill }} transition={move} />
              <m.div className="absolute inset-0 origin-left bg-[#7fe3a8]" initial={false} animate={{ scaleX: fill, opacity: finished ? 1 : 0 }} transition={move} />
              <m.div className="absolute inset-0" initial={false} animate={{ x: `${fill * 100}%` }} transition={move}>
                <span className={`absolute -top-[26px] left-0 -translate-x-1/2 ${finished ? "text-[#7fe3a8]" : halted ? "" : "text-[#f4f1e8]"}`} style={halted ? { color: accent } : undefined}><Spark /></span>
              </m.div>
            </div>
            {steps.map((step, index) => {
              const left = `${((index + 0.5) / steps.length) * 100}%`;
              const filled = step.state !== "waiting" && step.state !== "skipped";
              const color = step.state === "failed" ? "#ff9a92" : step.state === "unknown" ? "#ffd27f" : finished ? "#7fe3a8" : "#7fa6ff";
              return (
                <span key={step.key} className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2" style={{ left }}>
                  <span className={`absolute inset-0 border bg-[#0b0b0d] ${step.state === "skipped" ? "border-dashed border-white/35" : step.state === "waiting" ? "border-white/35" : "border-white/70"}`} />
                  <m.span className="absolute inset-[2px]" style={{ backgroundColor: color }} initial={false} animate={{ opacity: filled ? 1 : 0, scale: filled ? 1 : 0.4 }} transition={{ duration: reduced ? 0 : 0.35, ease: EASE_OUT }} />
                  {step.state === "active" && !reduced && <m.span className="absolute -inset-px border" style={{ borderColor: color }} initial={{ opacity: 0.8, scale: 1 }} animate={{ opacity: 0, scale: 2.1 }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }} />}
                  {finished && index === last && <m.span className="absolute -inset-[5px] grid place-items-center bg-[#7fe3a8] text-[#0b0b0d]" initial={reduced ? false : { opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, delay: reduced ? 0 : 0.5, ease: EASE_OUT }}><Check className="size-3" strokeWidth={3} /></m.span>}
                </span>
              );
            })}
          </div>
          <ol className="m-0 mt-3 grid list-none p-0" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
            {steps.map((step, index) => (
              <li key={step.key} aria-current={index === active && !finished && outcome !== "idle" ? "step" : undefined} className="px-1 text-center">
                <span className={`mono block text-[10px] uppercase leading-4 tracking-[0.1em] ${tone[step.state]}`}>{step.label}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-white/55">{step.note}</span>
                <span className="sr-only">, {said[step.state]}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="relative min-h-[52px] border-t border-white/10 px-4 py-3.5">
          <AnimatePresence mode="wait" initial={false}>
            <m.p key={caption} aria-live="polite" className={`m-0 text-sm leading-6 ${finished ? "text-[#7fe3a8]" : halted ? "" : "text-[#f4f1e8]"}`} style={halted ? { color: accent } : undefined} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: reduced ? 0 : 0.3, ease: EASE_OUT }}>
              {caption}
            </m.p>
          </AnimatePresence>
          {link && <a href={link.href} target="_blank" rel="noreferrer" className={`mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline ${finished ? "text-[#7fe3a8]" : "text-[#9ec5f4]"}`}>{link.text} <ArrowUpRight className="size-3" aria-hidden="true" /></a>}
        </div>
      </section>
    </LazyMotion>
  );
}
