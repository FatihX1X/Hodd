"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-2xl items-center px-5 py-16">
      <div className="w-full border border-white/[0.14] bg-[#101319] p-8">
        <AlertTriangle aria-hidden="true" className="mb-6 size-8 text-[#ff9a92]" />
        <p className="mono text-[11px] uppercase tracking-[0.2em] text-white/60">Treasury view unavailable</p>
        <h1 className="disp mt-4 text-[clamp(1.5rem,6vw,2rem)]">The treasury view could not be loaded.</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-white/70">The treasury view could not load. Retry to refresh your workspace. Check Activity for transaction status before trying a payment again.</p>
        <button onClick={reset} className="mono mt-8 min-h-11 bg-[#f4f1e8] px-5 py-3 text-xs font-medium uppercase tracking-[0.09em] text-[#0b0b0d] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#0a52e8]">
          Retry treasury view
        </button>
      </div>
    </section>
  );
}
