"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import type { EarnOperation } from "@/lib/earn/models";
import { labelClass } from "./primitives";

export type EarnEvent = Readonly<{ stage: string; hash?: string }>;
export type EarnOutcome = "running" | "done" | "partial" | "failed" | "unknown";
type StepState = "done" | "active" | "waiting" | "skipped" | "failed" | "unknown";
type Step = Readonly<{ key: string; label: string; state: StepState; note: string }>;
type Sub = "waiting" | "wallet" | "submitted" | "confirmed" | "skipped";

const EASE_OUT = [0.19, 1, 0.22, 1] as const;
const verbs: Record<EarnOperation, string> = { DEPOSIT: "Deposit", WITHDRAW: "Withdraw", REDEEM_ALL: "Redeem" };
const SUBMITTED = /^(TRANSACTION_SUBMITTED|USER_OPERATION_SUBMITTED|TRANSACTION_REPORTED|(APPROVAL|EARN)_PIN_APPROVED)$/;

/** Reads the server's execution events into milestones. Only events move the rail; nothing is inferred from time. */
export function earnProgress(operation: EarnOperation, events: readonly EarnEvent[], outcome: EarnOutcome) {
  const verb = verbs[operation];
  const sub: Record<"approval" | "earn", Sub> = { approval: "waiting", earn: "waiting" };
  let phase: "approval" | "earn" | null = null;
  for (const { stage } of events) {
    if (/^APPROVAL_(SIGNATURE|PIN)_REQUESTED$/.test(stage)) { phase = "approval"; sub.approval = "wallet"; }
    else if (/^EARN_(SIGNATURE|PIN)_REQUESTED$/.test(stage)) { phase = "earn"; sub.earn = "wallet"; if (sub.approval === "waiting") sub.approval = "skipped"; }
    else if (stage === "APPROVAL_CONFIRMED") sub.approval = "confirmed";
    else if (SUBMITTED.test(stage) && phase) sub[phase] = "submitted";
  }
  const finished = outcome === "done" || outcome === "partial";
  const withApproval = operation === "DEPOSIT" || events.some((event) => event.stage.startsWith("APPROVAL_"));
  const steps: Step[] = [
    events.length || finished ? { key: "confirm", label: "Confirmed", state: "done", note: "By you" } : { key: "confirm", label: "Confirm", state: "active", note: "Preparing" },
    ...(withApproval ? [
      sub.approval === "confirmed" ? { key: "approval", label: "Approve USDC", state: "done", note: "Confirmed" }
        : sub.approval === "skipped" || (finished && sub.approval === "waiting") ? { key: "approval", label: "Approve USDC", state: "skipped", note: "Not needed" }
        : sub.approval === "wallet" ? { key: "approval", label: "Approve USDC", state: "active", note: "In your wallet" }
        : sub.approval === "submitted" ? { key: "approval", label: "Approve USDC", state: "active", note: "Confirming" }
        : { key: "approval", label: "Approve USDC", state: "waiting", note: "Next" },
    ] as Step[] : []),
    finished || sub.earn === "submitted" ? { key: "earn", label: verb, state: "done", note: "Sent" }
      : sub.earn === "wallet" ? { key: "earn", label: verb, state: "active", note: "In your wallet" }
      : { key: "earn", label: verb, state: "waiting", note: "Next" },
    finished ? { key: "verify", label: "Verified", state: "done", note: outcome === "partial" ? "Partial" : "Receipt checked" }
      : sub.earn === "submitted" ? { key: "verify", label: "Verify", state: "active", note: "Checking receipt" }
      : { key: "verify", label: "Verify", state: "waiting", note: "Last" },
  ];
  let active = steps.findIndex((step) => step.state === "active");
  // Between wallet requests the server is preparing the next one: the next open step is the active one.
  if (active < 0) active = finished ? steps.length - 1 : steps.findIndex((step) => step.state === "waiting");
  if (!finished && (outcome === "failed" || outcome === "unknown") && active >= 0) steps[active] = { ...steps[active], state: outcome, note: outcome === "failed" ? "Stopped" : "Unknown" };
  else if (!finished && steps[active]?.state === "waiting") steps[active] = { ...steps[active], state: "active", note: "Preparing" };

  const current = steps[active];
  const caption = outcome === "done" ? `${verb} verified on Arc Testnet.`
    : outcome === "partial" ? "Partly redeemed. Some shares are still in the vault."
    : outcome === "failed" ? "Stopped here. Nothing else is sent from this request."
    : outcome === "unknown" ? "The outcome is unknown. Check your wallet before trying again."
    : current.key === "confirm" ? "Preparing your transaction."
    : current.key === "approval" ? (sub.approval === "submitted" ? "Approval sent. Waiting for Arc Testnet to confirm it." : sub.approval === "wallet" ? "Approve USDC spending in your wallet." : "Preparing the approval request.")
    : current.key === "earn" ? (sub.earn === "wallet" ? `Sign the ${verb.toLowerCase()} in your wallet.` : `Preparing the ${verb.toLowerCase()} request.`)
    : `${verb} sent. Verifying the receipt on Arc Testnet.`;
  return { steps, active, caption, verb };
}

const tone: Record<StepState, string> = { done: "text-[#f4f1e8]", active: "text-[#f4f1e8]", waiting: "text-white/55", skipped: "text-white/55", failed: "text-[#ff9a92]", unknown: "text-[#ffd27f]" };
const said: Record<StepState, string> = { done: "done", active: "in progress", waiting: "not started", skipped: "skipped", failed: "stopped", unknown: "outcome unknown" };

function Spark() {
  return <svg viewBox="0 0 200 200" width="18" height="18" aria-hidden="true"><path d="M100 0Q110 90 200 100Q110 110 100 200Q90 110 0 100Q90 90 100 0Z" fill="currentColor" /></svg>;
}

/** The deposit, withdrawal or redemption as a rail: the spark moves to each milestone as the server confirms it. */
export function EarnProgress({ operation, events, outcome, explorerUrl }: { operation: EarnOperation; events: readonly EarnEvent[]; outcome: EarnOutcome; explorerUrl?: string }) {
  const reduced = useReducedMotion();
  const { steps, active, caption, verb } = earnProgress(operation, events, outcome);
  const last = steps.length - 1;
  const fill = last > 0 ? active / last : 1;
  const finished = outcome === "done" || outcome === "partial";
  const halted = outcome === "failed" || outcome === "unknown";
  const accent = halted ? (outcome === "failed" ? "#ff9a92" : "#ffd27f") : "#7fa6ff";
  const move = { duration: reduced ? 0 : 0.8, ease: EASE_OUT };
  const inset = `${50 / steps.length}%`;
  return (
    <LazyMotion features={domAnimation} strict>
      <section aria-label={`${verb} progress`} className="m-5 border border-white/[0.14] bg-[#0b0b0d]">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <span className={labelClass}>{verb} progress</span>
          <span className={`${labelClass} tabular-nums`}>Step {active + 1} of {steps.length}</span>
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
              <li key={step.key} aria-current={index === active && !finished ? "step" : undefined} className="px-1 text-center">
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
          {finished && explorerUrl && <a href={explorerUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[#7fe3a8] underline-offset-4 hover:underline">Open transaction <ArrowUpRight className="size-3" aria-hidden="true" /></a>}
        </div>
      </section>
    </LazyMotion>
  );
}

const readable = (stage: string) => stage.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

/** Every server event with its hash, for anyone who wants to check the chain themselves. */
export function EarnEventDetails({ events }: { events: readonly EarnEvent[] }) {
  if (!events.length) return null;
  return (
    <details className="group mx-5 mb-5 border border-white/[0.14]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs text-white/65 hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">Transaction details<span className="mono text-[10px] text-white/55">{events.length} {events.length === 1 ? "event" : "events"}</span></summary>
      <ol aria-label="Execution timeline" className="m-0 list-none divide-y divide-white/10 border-t border-white/10 p-0">
        {events.map((event, index) => (
          <li key={`${index}-${event.stage}`} className="px-4 py-3 text-xs">
            <span className="block">{readable(event.stage)}</span>
            {event.hash && <a href={`https://testnet.arcscan.app/tx/${event.hash}`} target="_blank" rel="noreferrer" className="mono mt-1 block break-all text-[10px] text-[#9ec5f4] underline underline-offset-2">{event.hash}</a>}
          </li>
        ))}
      </ol>
    </details>
  );
}
