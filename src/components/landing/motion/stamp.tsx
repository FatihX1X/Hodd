"use client";

import { useRef } from "react";
import { LazyMotion, useInView } from "motion/react";
import * as m from "motion/react-m";
import { EASE_OUT, loadFeatures, useArmed } from "./hooks";

/** A rubber stamp, like the hero's "Paid": pressed onto the page the first time it is seen. Still for reduced motion. */
export function Stamp({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const armed = useArmed();
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const waiting = armed && !inView;
  return (
    <LazyMotion features={loadFeatures} strict>
      <m.span
        ref={ref}
        className={className}
        initial={false}
        animate={waiting ? { opacity: 0, scale: 1.6, rotate: -6 } : { opacity: 1, scale: 1, rotate: -6 }}
        transition={waiting ? { duration: 0 } : { duration: 0.45, delay: 0.2, ease: EASE_OUT }}
      >
        {children}
      </m.span>
    </LazyMotion>
  );
}
