"use client";

import { Fragment, useRef } from "react";
import { LazyMotion, useInView } from "motion/react";
import * as m from "motion/react-m";
import { EASE_OUT, loadFeatures, useArmed } from "./hooks";

type Props = { lines: readonly string[]; as?: "h2" | "h3"; className?: string };

/** A headline whose lines rise into place, one after another, the first time it scrolls into view. */
export function RevealLines({ lines, as: Tag = "h2", className }: Props) {
  const ref = useRef<HTMLHeadingElement>(null);
  const armed = useArmed();
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const hidden = armed && !inView;
  return (
    <LazyMotion features={loadFeatures} strict>
      <Tag ref={ref} className={className}>
        {lines.map((line, index) => (
          // The space keeps words apart for screen readers; between blocks it never renders.
          <Fragment key={line}>{index > 0 && " "}<span className="-mb-[0.1em] block overflow-hidden pb-[0.1em]">
            <m.span
              className="block"
              initial={false}
              animate={{ y: hidden ? "110%" : "0%" }}
              transition={hidden ? { duration: 0 } : { duration: 0.9, ease: EASE_OUT, delay: index * 0.09 }}
            >
              {line}
            </m.span>
          </span></Fragment>
        ))}
      </Tag>
    </LazyMotion>
  );
}
