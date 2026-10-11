"use client";

import { useRef } from "react";
import Image from "next/image";
import { LazyMotion, useScroll, useTransform } from "motion/react";
import * as m from "motion/react-m";
import { loadFeatures, useArmed } from "./hooks";

/**
 * The closing star. It arrives tilted and small, and comes upright on the grid as the section reaches
 * the middle of the screen, while two hairlines run out from its centre like a compass rose.
 * Upright and complete for reduced motion and before hydration.
 */
export function CtaStar() {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useArmed();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const rotate = useTransform(scrollYProgress, [0.1, 0.5, 0.95], [-45, 0, 14]);
  const scale = useTransform(scrollYProgress, [0.1, 0.5, 0.95], [0.62, 1, 0.92]);
  const reach = useTransform(scrollYProgress, [0.18, 0.52], [0, 1]);
  const glow = useTransform(scrollYProgress, [0.2, 0.5, 0.85], [0, 0.6, 0.25]);

  return (
    <LazyMotion features={loadFeatures} strict>
      <div ref={ref} aria-hidden="true" className="relative grid aspect-square w-[min(72vw,400px)] place-items-center">
        <m.span className="absolute left-1/2 top-1/2 h-px w-[150%] -translate-x-1/2 -translate-y-1/2 bg-white/45" style={armed ? { scaleX: reach } : undefined} />
        <m.span className="absolute left-1/2 top-1/2 h-[112%] w-px sm:h-[150%] -translate-x-1/2 -translate-y-1/2 bg-white/45" style={armed ? { scaleY: reach } : undefined} />
        <m.span className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,255,255,0.9),rgba(255,255,255,0.35)_45%,rgba(255,255,255,0)_100%)]" style={{ opacity: armed ? glow : 0.4 }} />
        <m.div className="relative w-[88%]" style={armed ? { rotate, scale } : undefined}>
          <Image src="/brand/hodd-star.png" alt="" width={640} height={640} className="h-auto w-full drop-shadow-[0_24px_48px_rgba(0,10,90,0.45)]" />
        </m.div>
      </div>
    </LazyMotion>
  );
}
