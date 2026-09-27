"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-2xl items-center px-5 py-16">
      <div className="w-full border border-black/15 bg-[#fffdf7] p-8">
        <AlertTriangle aria-hidden="true" className="mb-6 size-8 text-[#9a433c]" />
        <p className="mono text-[11px] uppercase tracking-[0.2em] text-black/50">Demo data unavailable</p>
        <h1 className="mt-3 text-3xl font-medium tracking-[-0.04em]">The treasury view could not be loaded.</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-black/60">No funds or live systems were affected. Retry the read-only sample workspace.</p>
        <button onClick={reset} className="mt-8 bg-[#0b0d0c] px-5 py-3 text-sm font-medium text-white hover:bg-[#252925]">
          Retry demo
        </button>
      </div>
    </section>
  );
}
