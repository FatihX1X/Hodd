"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { Ticker } from "./count-up";
import { useArmed, usePageVisible } from "./hooks";

/** Protection windows a person can pick, shown in turn: anything from 3 to 30 days. */
const WINDOWS = [3, 7, 14, 30] as const;
const LAST = WINDOWS.length - 1;
const STEP_MS = 1800;
const HOLD_LAST_MS = 3200;

/**
 * The Horizon figure. It counts through a few of the windows a person can choose (3 to 30 days) while it is on
 * screen. Before hydration and for reduced motion it rests on 30.
 */
export function HorizonDays() {
  const ref = useRef<HTMLSpanElement>(null);
  const armed = useArmed();
  const inView = useInView(ref, { amount: 0.6 });
  const visible = usePageVisible();
  const running = armed && inView && visible;
  const [index, setIndex] = useState<number>(LAST);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setIndex((current) => (current >= LAST ? 0 : current + 1)), index === LAST ? HOLD_LAST_MS : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [running, index]);

  return (
    <span ref={ref} data-horizon={WINDOWS[index]}>
      <Ticker value={WINDOWS[index]} />&nbsp;days
    </span>
  );
}
