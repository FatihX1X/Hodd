"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-2xl items-center px-5 py-16">
      <div className="w-full border border-black/15 bg-[#f4f1e8] p-8">
        <AlertTriangle aria-hidden="true" className="mb-6 size-8 text-[#9a433c]" />
        <p className="mono text-[11px] uppercase tracking-[0.2em] text-black/50">Demo data unavailable</p>
        <h1 className="disp mt-4 text-[clamp(1.5rem,6vw,2rem)]">The treasury view could not be loaded.</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-black/60">No funds or live systems were affected. Retry the local treasury workspace.</p>
        <button onClick={reset} className="mono mt-8 min-h-11 bg-[#0b0b0d] px-5 py-3 text-xs font-medium uppercase tracking-[0.09em] text-white transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#0a52e8]">
          Retry demo
        </button>
      </div>
    </section>
  );
}
