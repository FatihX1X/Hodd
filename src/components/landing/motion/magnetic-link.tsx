"use client";

import { useRef } from "react";
import { useArmed, useMediaQuery } from "./hooks";

const PULL = 6; // px: a hint, not a chase

/** A link that leans a few pixels toward a mouse pointer. Touch, keyboard and reduced-motion users get a plain link. */
export function MagneticLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const armed = useArmed();
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const active = armed && finePointer;
  const move = (event: React.PointerEvent<HTMLAnchorElement>) => {
    if (!active || !ref.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width - 0.5) * 2 * PULL;
    const y = ((event.clientY - box.top) / box.height - 0.5) * 2 * PULL;
    ref.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ""; };
  return (
    <a ref={ref} href={href} className={className} style={active ? { transition: "transform 260ms cubic-bezier(0.19, 1, 0.22, 1)" } : undefined} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </a>
  );
}
