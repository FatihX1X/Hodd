"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, LazyMotion, useInView } from "motion/react";
import * as m from "motion/react-m";
import { Ticker } from "./count-up";
import { EASE_OUT, loadFeatures, useArmed, usePageVisible } from "./hooks";

/*
 * One month of a treasury, told in six moves. The numbers add up:
 * 10,000 in; 5,600 payroll + 1,000 buffer protected; 3,400 to Morpho;
 * a 600 tax bill lands, so 600 comes back; 6,200 paid; the buffer is still 1,000.
 */
const steps = [
  { key: "income", label: "Income", caption: "10,000 USDC arrives from a customer.", liquid: 10_000, morpho: 0, due: 5_600, sign: false },
  { key: "protect", label: "Protect", caption: "6,600 USDC is held back: payroll plus the 1,000 USDC buffer.", liquid: 10_000, morpho: 0, due: 5_600, sign: false },
  { key: "morpho", label: "Morpho", caption: "The other 3,400 USDC goes to work in Morpho, signed by you.", liquid: 6_600, morpho: 3_400, due: 5_600, sign: true },
  { key: "bill", label: "Bill due", caption: "A 600 USDC tax bill lands, due in three days.", liquid: 6_600, morpho: 3_400, due: 6_200, sign: false },
  { key: "withdraw", label: "Withdraw", caption: "600 USDC comes back from Morpho so the buffer stays whole.", liquid: 7_200, morpho: 2_800, due: 6_200, sign: true },
  { key: "paid", label: "Paid", caption: "6,200 USDC paid on time. The 1,000 USDC buffer is untouched.", liquid: 1_000, morpho: 2_800, due: 0, sign: true },
] as const;

const LAST = steps.length - 1;
const STEP_MS = 2600;
const HOLD_LAST_MS = 3200;
const nodeX = (index: number) => ((index + 0.5) / steps.length) * 1000;
const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";


/** The hero's instrument: a looping, illustrative run of the treasury from income to a paid bill. */
export function LiveTreasury() {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useArmed();
  const inView = useInView(ref, { amount: 0.35 });
  const visible = usePageVisible();
  // Static and complete (the paid state) on the server, without JavaScript and with reduced motion.
  const [step, setStep] = useState<number>(LAST);
  const running = armed && inView && visible;

  useEffect(() => {
    if (!armed) return;
    const id = requestAnimationFrame(() => setStep(0));
    return () => cancelAnimationFrame(id);
  }, [armed]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setStep((current) => (current >= LAST ? 0 : current + 1)), step === LAST ? HOLD_LAST_MS : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [running, step]);

  const current = steps[step];
  const counters = [
    { name: "Liquid", short: "Liquid", value: current.liquid },
    { name: "In Morpho", short: "Morpho", value: current.morpho },
    { name: "Due in 30 days", short: "Due", value: current.due },
  ];

  return (
    <LazyMotion features={loadFeatures} strict>
      <figure className="m-0">
        <div ref={ref} aria-hidden="true" data-step={current.key} className="relative border border-[#0b0b0d] bg-[#0b0b0d] text-[#f4f1e8] shadow-[8px_8px_0_#0a52e8]">
          <div className="flex items-center justify-between gap-4 border-b border-white/15 px-[clamp(16px,2.4vw,28px)] py-3">
            <span className={clsx(label, "inline-flex items-center gap-2.5 whitespace-nowrap")}><span className="relative inline-flex size-2"><m.span className="absolute inset-0 rounded-full bg-[#7fe3a8]" animate={armed ? { scale: [1, 2.4], opacity: [0.7, 0] } : undefined} transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }} /><span className="relative size-2 rounded-full bg-[#7fe3a8]" /></span>Live treasury</span>
            <span className={clsx(label, "whitespace-nowrap text-[#a5a8b3]")}>Illustrative · <span className="max-sm:hidden">step </span>{step + 1}<span className="max-sm:hidden"> of </span><span className="sm:hidden">/</span>{steps.length}</span>
          </div>

          <dl className="m-0 grid grid-cols-3 gap-px border-b border-white/15 bg-white/15">
            {counters.map((counter) => (
              <div key={counter.name} className="bg-[#0b0b0d] px-[clamp(12px,2.4vw,28px)] py-[clamp(14px,2vw,22px)]">
                <dt className={clsx(label, "whitespace-nowrap text-[#a5a8b3]")}><span className="sm:hidden">{counter.short}</span><span className="max-sm:hidden">{counter.name}</span></dt>
                <dd className="m-0 mt-2 flex flex-wrap items-baseline gap-x-2">
                  <Ticker value={counter.value} className="mono text-[clamp(1.35rem,3.4vw,2.5rem)] font-medium leading-none tracking-[-0.03em] tabular-nums" />
                  <span className={clsx(label, "text-[#a5a8b3]")}>USDC</span>
                </dd>
              </div>
            ))}
          </dl>

          <div className="px-[clamp(12px,2.4vw,28px)] pb-[clamp(18px,2.4vw,28px)] pt-[clamp(18px,2.6vw,32px)]">
            <svg viewBox="0 0 1000 64" className="block h-auto w-full overflow-visible">
              <line x1={nodeX(0)} x2={nodeX(LAST)} y1="32" y2="32" stroke="rgba(244,241,232,.22)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <m.line
                x1={nodeX(0)} x2={nodeX(LAST)} y1="32" y2="32" stroke="#8fb0ff" strokeWidth="2" vectorEffect="non-scaling-stroke"
                style={{ originX: 0, originY: 0.5 }}
                initial={false}
                animate={{ scaleX: step / LAST }}
                transition={{ duration: armed ? 0.9 : 0, ease: EASE_OUT }}
              />
              {steps.map((item, index) => (
                <g key={item.key}>
                  <rect x={nodeX(index) - 8} y="24" width="16" height="16" fill="#0b0b0d" stroke="rgba(244,241,232,.55)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <m.rect x={nodeX(index) - 8} y="24" width="16" height="16" fill={item.key === "paid" ? "#7fe3a8" : "#8fb0ff"} initial={false} animate={{ opacity: index <= step ? 1 : 0 }} transition={{ duration: armed ? 0.4 : 0 }} />
                </g>
              ))}
              {armed && (
                <m.rect
                  y="24" width="16" height="16" fill="none" stroke="#8fb0ff" strokeWidth="1.5" vectorEffect="non-scaling-stroke"
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  initial={false}
                  animate={{ x: nodeX(step) - 8, scale: [1, 1.9], opacity: [0.9, 0] }}
                  transition={{ x: { duration: 0.6, ease: EASE_OUT }, scale: { duration: 1.4, repeat: Infinity, ease: "easeOut" }, opacity: { duration: 1.4, repeat: Infinity, ease: "easeOut" } }}
                />
              )}
              <m.g initial={false} animate={{ x: nodeX(step) }} transition={{ duration: armed ? 0.9 : 0, ease: EASE_OUT }}>
                <svg x={-12} y={-4} width={24} height={24} viewBox="0 0 200 200"><path d="M100 0Q110 90 200 100Q110 110 100 200Q90 110 0 100Q90 90 100 0Z" fill="#f4f1e8" /></svg>
              </m.g>
            </svg>

            <ol className="m-0 mt-3 hidden list-none grid-cols-6 p-0 sm:grid">
              {steps.map((item, index) => (
                <li key={item.key} className={clsx(label, "text-center transition-opacity duration-500", index <= step ? "opacity-100" : "opacity-70")}>
                  <span className="block">{item.label}</span>
                  {item.sign && <span className="mt-0.5 block text-[10px] text-[#8fb0ff]">You sign</span>}
                </li>
              ))}
            </ol>

            <div className="relative mt-5 flex min-h-[3.2em] items-start justify-between gap-6 border-t border-white/15 pt-4">
              <AnimatePresence mode="wait" initial={false}>
                <m.p key={current.key} className="m-0 max-w-[52ch] text-[clamp(15px,1.5vw,17px)] leading-[1.5] text-[#e6e8ee]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: armed ? 0.35 : 0, ease: EASE_OUT }}>
                  <span className={clsx(label, "mr-3 text-[#8fb0ff] sm:hidden")}>{current.label}</span>{current.caption}
                </m.p>
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {current.key === "paid" && (
                  <m.span
                    key="stamp"
                    className="disp pointer-events-none shrink-0 -rotate-6 border-2 border-[#7fe3a8] px-3 py-1.5 text-[clamp(1.1rem,2vw,1.6rem)] text-[#7fe3a8]"
                    initial={{ opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: armed ? 0.45 : 0, ease: EASE_OUT }}
                  >
                    Paid
                  </m.span>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
        <figcaption className="sr-only">Illustration of one month in Hodd: 10,000 USDC arrives, 6,600 USDC is protected for payroll and a 1,000 USDC buffer, 3,400 USDC goes to Morpho with your signature, a 600 USDC tax bill lands, 600 USDC comes back from Morpho, and 6,200 USDC is paid on time with the buffer intact.</figcaption>
      </figure>
    </LazyMotion>
  );
}
