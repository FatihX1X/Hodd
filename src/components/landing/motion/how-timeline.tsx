"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, LazyMotion, useMotionValueEvent, useScroll } from "motion/react";
import * as m from "motion/react-m";
import { RevealLines } from "./reveal-lines";
import { EASE_OUT, loadFeatures, useArmed, useMediaQuery } from "./hooks";

type Step = Readonly<{ no: string; title: string; body: string }>;
const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";

function Spark({ className }: { className?: string }) {
  return <svg viewBox="0 0 200 200" width="9" height="9" aria-hidden="true" className={className}><path d="M100 0Q110 90 200 100Q110 110 100 200Q90 110 0 100Q90 90 100 0Z" fill="currentColor" /></svg>;
}

/**
 * "How it works" as a timeline the reader scrolls through. On large screens the heading and a
 * progress rail stay pinned while each step takes its turn; elsewhere it is a plain ordered list.
 */
export function HowTimeline({ steps, intro, outlineClass }: { steps: readonly Step[]; intro: string; outlineClass: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  const armed = useArmed();
  const wide = useMediaQuery("(min-width: 1024px)");
  const pinned = armed && wide;
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 65%", "end 65%"] });
  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    setActive(Math.min(steps.length - 1, Math.max(0, Math.floor(progress * steps.length))));
  });

  return (
    <LazyMotion features={loadFeatures} strict>
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-16">
        <div className="mb-[clamp(40px,5vw,72px)] lg:sticky lg:top-[108px] lg:mb-0 lg:self-start">
          <div className={clsx(label, "text-[#0a52e8]")}>02 — How it works</div>
          <RevealLines lines={["From idle", "to ahead of time."]} className="disp mt-5 text-[clamp(2.1rem,5vw,4.5rem)]" />
          <p className="mb-0 mt-6 max-w-[380px] text-[17px] leading-[1.55] text-[#3b3a36]">{intro}</p>

          <div aria-hidden="true" className="mt-12 hidden items-stretch gap-8 lg:flex">
            <div className="relative w-px bg-[#0b0b0d]/20">
              <m.div className="absolute inset-0 origin-top bg-[#0a52e8]" style={{ scaleY: pinned ? scrollYProgress : 1 }} />
              {steps.map((step, index) => (
                <span key={step.no} className={clsx("absolute -left-[4px] size-[9px] border border-[#0b0b0d] transition-colors duration-300", index <= active || !pinned ? "bg-[#0a52e8]" : "bg-[#ece8dd]")} style={{ top: `calc(${(index / (steps.length - 1)) * 100}% - 4px)` }} />
              ))}
            </div>
            <div className="relative h-[176px] min-w-[220px]">
              <AnimatePresence initial={false}>
                <m.div key={steps[active].no} className={clsx("disp absolute inset-0 text-[168px] leading-none", outlineClass)} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -28 }} transition={{ duration: pinned ? 0.5 : 0, ease: EASE_OUT }}>
                  {steps[active].no}
                </m.div>
              </AnimatePresence>
            </div>
          </div>
        </div>

        <ol ref={listRef} className="m-0 flex list-none flex-wrap gap-x-8 p-0 lg:block">
          {steps.map((step, index) => (
            <m.li
              key={step.no}
              data-active={pinned ? index === active : undefined}
              className="relative flex-[1_1_240px] border-t border-[#0b0b0d] pb-10 pt-5 lg:flex lg:min-h-[58vh] lg:flex-col lg:justify-center lg:pb-16"
              initial={false}
              // Dimmed, never faint: inactive steps keep a 4.5:1 contrast ratio.
              animate={{ opacity: pinned && index !== active ? 0.8 : 1 }}
              transition={{ duration: 0.45, ease: EASE_OUT }}
            >
              {pinned && (
                <m.span
                  aria-hidden="true"
                  className="absolute inset-x-0 -top-[2px] h-[3px] origin-left bg-[#0a52e8]"
                  initial={false}
                  animate={{ scaleX: index === active ? 1 : 0 }}
                  transition={{ duration: 0.7, ease: EASE_OUT }}
                />
              )}
              <div className={clsx(label, "flex items-center gap-2.5")}>Step {step.no}{index === steps.length - 1 && <Spark className="size-3 text-[#0a52e8]" />}</div>
              <div aria-hidden="true" className={clsx("disp mb-[18px] mt-2.5 text-[96px] lg:hidden", outlineClass)}>{step.no}</div>
              <h3 className="disp mb-3 mt-0 text-2xl lg:mt-4 lg:text-[clamp(2rem,3.2vw,3rem)]">{step.title}</h3>
              <p className="m-0 max-w-[46ch] text-base leading-[1.55] text-[#3b3a36] lg:text-lg">{step.body}</p>
            </m.li>
          ))}
        </ol>
      </div>
    </LazyMotion>
  );
}
