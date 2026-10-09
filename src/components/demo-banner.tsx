"use client";

import Link from "next/link";
import { buttonClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

export function DemoBanner() {
  const { mode, signedIn, exitDemo } = useTreasuryWorkspace();
  if (mode !== "DEMO") return null;
  return <div role="note" className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[#7fa6ff]/40 bg-[#101319] px-5 py-3 text-xs text-[#f4f1e8]">
    <p className="mono">READ-ONLY DEMO · sample data · nothing is saved</p>
    <div className="flex flex-wrap gap-2"><button onClick={exitDemo} className={buttonClass.ghost}>Exit demo</button>{signedIn ? <button onClick={exitDemo} className={buttonClass.primary}>Start live testnet treasury</button> : <Link href="/login" onClick={exitDemo} className={buttonClass.primary}>Start live testnet treasury</Link>}</div>
  </div>;
}
