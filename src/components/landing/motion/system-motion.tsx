"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LazyMotion, useScroll, useSpring, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { loadFeatures, useArmed } from "./hooks";

const TabContext = createContext<{ index: number; select: (index: number) => void } | null>(null);

/** Shares the selected System tab, so the star behind the section can answer it. */
export function SystemMotion({ children }: { children: React.ReactNode }) {
  const [index, select] = useState(0);
  return <TabContext.Provider value={{ index, select }}>{children}</TabContext.Provider>;
}

export const useSystemTab = () => useContext(TabContext);

/** Each verb turns the star a further 30 degrees; a four-point star repeats every 90. */
const TURN_PER_TAB = 30;

/**
 * The large star behind "The system". It drifts down and turns slowly as the section scrolls past,
 * and turns a further step whenever a different verb is chosen. Still for reduced motion.
 */
export function SystemStar({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useArmed();
  const tab = useSystemTab();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const drift = useTransform(scrollYProgress, [0, 1], ["-6%", "16%"]);
  const lean = useTransform(scrollYProgress, [0, 1], [-14, 16]);
  const turn = useSpring(0, { stiffness: 70, damping: 16, mass: 0.9 });
  const rotate = useTransform(() => lean.get() + turn.get());
  const glow = useSpring(0.35, { stiffness: 120, damping: 20 });
  const index = tab?.index ?? 0;
  const shown = useRef(index);

  useEffect(() => {
    turn.set(index * TURN_PER_TAB);
    if (shown.current === index) return;
    shown.current = index;
    // A brief flare marks the change, then settles.
    glow.jump(0.75); glow.set(0.35);
  }, [index, turn, glow]);

  return (
    <LazyMotion features={loadFeatures} strict>
      <div ref={ref} aria-hidden="true" className={className}>
        <m.div className="relative h-full w-full" style={armed ? { y: drift, rotate } : undefined}>
          <m.div className="absolute inset-[4%] bg-[radial-gradient(closest-side,rgba(43,99,255,0.85),rgba(43,99,255,0.3)_50%,rgba(43,99,255,0)_100%)]" style={{ opacity: armed ? glow : 0.35 }} />
          <Image src="/brand/hodd-star.png" alt="" width={640} height={640} className="relative h-auto w-full opacity-30" />
        </m.div>
      </div>
    </LazyMotion>
  );
}
