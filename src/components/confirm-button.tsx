"use client";

import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import { buttonClass } from "./primitives";

/** How long "Confirm?" stays armed before the button returns to its label. */
export const CONFIRM_WINDOW_MS = 6_000;
const armedClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] border border-[#e9b949] bg-[#e9b949] px-4 text-[13px] font-semibold text-[#0b0b0d] transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#f4f1e8] active:translate-x-0 active:translate-y-0 active:shadow-none";

/**
 * A one-tap action that asks once: the first press turns the label into "Confirm?", the second press within six
 * seconds runs it. Pressing elsewhere, Escape or waiting lets it go back. A submit button only submits its form on
 * the second press, so Enter in a field follows the same two steps.
 */
export function ConfirmButton({ variant = "primary", confirmLabel = "Confirm?", className, children, onClick, onBlur, onKeyDown, disabled, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonClass; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  const shown = armed && !disabled;
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return <><button
    {...props}
    type={type}
    disabled={disabled}
    data-armed={shown || undefined}
    className={clsx(shown ? armedClass : buttonClass[variant], "relative overflow-hidden", className)}
    onBlur={(event) => { setArmed(false); onBlur?.(event); }}
    onKeyDown={(event) => { if (event.key === "Escape") setArmed(false); onKeyDown?.(event); }}
    onClick={(event) => {
      if (!shown) { event.preventDefault(); setArmed(true); return; }
      setArmed(false);
      onClick?.(event);
    }}
  >
    {shown ? confirmLabel : children}
    {shown && <span aria-hidden="true" className="confirm-countdown absolute inset-x-0 bottom-0 h-0.5 origin-left bg-[#0b0b0d]/45" />}
  </button><span aria-live="polite" className="sr-only">{shown ? "Press again to confirm." : ""}</span></>;
}
