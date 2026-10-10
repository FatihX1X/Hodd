"use client";

import { useEffect, useRef } from "react";
import { useInView } from "motion/react";
import { useArmed } from "./hooks";

const format = (value: number) => Math.round(value).toLocaleString("en-US");
// Same curve as EASE_OUT (0.19, 1, 0.22, 1), close enough for counting.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/** Writes a tween from one number to another straight into the element's text. */
function tween(element: HTMLElement, from: number, to: number, seconds: number) {
  const start = performance.now();
  let frame = requestAnimationFrame(function tick(now) {
    const progress = Math.min(1, (now - start) / (seconds * 1000));
    element.textContent = format(from + (to - from) * easeOut(progress));
    if (progress < 1) frame = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(frame);
}

/** A number that counts up to its value the first time it is seen. Renders the final value until then. */
export function CountUp({ to, from = 0, duration = 1.4, className }: { to: number; from?: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const armed = useArmed();
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  useEffect(() => {
    const element = ref.current;
    if (!armed || !element) return;
    if (!inView) { element.textContent = format(from); return; }
    return tween(element, from, to, duration);
  }, [armed, inView, from, to, duration]);
  return <span ref={ref} className={className}>{format(to)}</span>;
}

/** Follows a changing value, counting from the last one shown (used by the live treasury). */
export function Ticker({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const armed = useArmed();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const from = shown.current;
    shown.current = value;
    if (!armed || from === value) { element.textContent = format(value); return; }
    return tween(element, from, value, 0.9);
  }, [armed, value]);
  return <span ref={ref} className={className}>{format(value)}</span>;
}
