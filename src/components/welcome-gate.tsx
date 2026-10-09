"use client";

import Link from "next/link";
import { buttonClass, PageBody, PageHeader } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

export function WelcomeGate() {
  const { enterDemo } = useTreasuryWorkspace();
  return <><PageHeader eyebrow="Arc Testnet · USDC" title="Sign in to start a live testnet treasury" description="Use your own wallet on Arc Testnet. Live balances, your bills, and wallet approval for every transaction." /><PageBody><div className="flex flex-wrap gap-3"><Link href="/login" className={buttonClass.primary}>Sign in</Link><button onClick={enterDemo} className={buttonClass.ghost}>Explore the read-only demo</button></div><p className="mt-5 text-sm text-white/60">Testnet only · chain 5042002. Get free testnet USDC from the Circle faucet after connecting your wallet.</p></PageBody></>;
}
