"use client";

import { useRef, useState } from "react";
import { useInView } from "motion/react";

/**
 * GitHub's live CI badge for main. The link reads "CI on GitHub Actions" until the badge has actually loaded, and the
 * badge is only requested once the link comes near the screen, so a slow or missing GitHub image never holds up the
 * page's load or leaves a broken image behind (the badge 404s until the workflow has run on main).
 */
export function CiBadge({ repo, className }: { repo: string; className?: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const near = useInView(ref, { once: true, margin: "300px 0px" });
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const shown = state === "shown";
  return (
    <a ref={ref} href={`${repo}/actions/workflows/ci.yml`} target="_blank" rel="noopener noreferrer" className={className}>
      {!shown && <span>CI on GitHub Actions</span>}
      {near && state !== "failed" && (
        // A plain img: GitHub redraws the badge after every run, so Next's optimizer must not cache it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${repo}/actions/workflows/ci.yml/badge.svg?branch=main`} alt={shown ? "CI status on GitHub Actions" : ""} height={20} decoding="async" onLoad={() => setState("shown")} onError={() => setState("failed")} className={shown ? "block h-5 w-auto" : "size-px opacity-0"} />
      )}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
