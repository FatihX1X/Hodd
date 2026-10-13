"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { onboardingStates } from "@/lib/treasury/onboarding";
import { useWalletOwnership } from "@/lib/wallet/use-wallet-ownership";
import { buttonClass, SectionCard, SectionHeading } from "./primitives";
import { Ring, moneyColor } from "./visuals";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

export function OnboardingChecklist() {
  const { signedIn, workspace, walletState, earnState } = useTreasuryWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const [copyState, setCopyState] = useState("");
  const live = earnState.status === "READY" && earnState.portfolio.integration.execution === "TESTNET_LIVE";
  const ownership = useWalletOwnership(workspace.walletConnection, live);
  const state = onboardingStates(signedIn, workspace, walletState, earnState.status === "READY" ? earnState.portfolio : undefined);
  const verified = Boolean(workspace.walletConnection) && (ownership.status === "VERIFIED" || ownership.status === "NOT_REQUIRED");
  const complete = Object.values(state).every(Boolean) && verified;
  const steps = [
    { title: "Sign in", done: state.signedIn, href: "/login" },
    { title: "Connect a wallet", done: state.connected, href: "/#treasury-wallet" },
    { title: "Verify wallet ownership", done: verified, href: "/#treasury-wallet" },
    { title: "Get free testnet USDC", done: state.funded, href: "https://faucet.circle.com" },
    { title: "Add your first bill", done: state.billAdded, href: "/obligations" },
    { title: "Make a first Morpho deposit", done: state.deposited, href: "/invest" },
  ];
  const done = steps.filter((step) => step.done).length;
  const progress = `${done} of ${steps.length} steps done`;
  return <SectionCard className="mb-6">
    <SectionHeading
      title="Your live testnet treasury"
      description={complete ? "All set. Your own wallet signs every transaction on Arc Testnet." : `${progress}. Your own wallet signs every transaction on Arc Testnet.`}
      icon={<Ring ratio={done / steps.length} label={progress} color={complete ? moneyColor.safe : moneyColor.deployable} size={34} stroke={4}><span className="mono text-[11px] tabular-nums text-white">{done}</span></Ring>}
      action={complete ? <button className={buttonClass.ghost} onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? "Show checklist" : "Collapse checklist"}</button> : undefined}
    />
    {(!complete || !collapsed) && <ol className="m-0 grid list-none gap-px bg-white/10 p-0 sm:grid-cols-2 xl:grid-cols-3">{steps.map((step, index) => (
      <li key={step.title} className="flex items-start gap-3 bg-[#101319] px-5 py-4 text-sm">
        <span aria-hidden="true" className={step.done ? "grid size-7 shrink-0 place-items-center rounded-full bg-[#7fe3a8]/15 text-[#7fe3a8]" : "mono grid size-7 shrink-0 place-items-center rounded-full border border-white/25 text-[12px] text-white/60"}>{step.done ? <Check className="size-4" strokeWidth={2.5} /> : index + 1}</span>
        <span className="min-w-0 pt-0.5">
          <span className="sr-only">{step.done ? "Done" : "Not done"}</span>
          <Link href={step.href} target={step.href.startsWith("https:") ? "_blank" : undefined} rel={step.href.startsWith("https:") ? "noreferrer" : undefined} className={step.done ? "text-white/50 hover:text-white" : "font-medium text-[#f4f1e8] underline decoration-white/30 underline-offset-4 hover:decoration-[#7fa6ff]"}>{step.title}</Link>
          {step.title === "Get free testnet USDC" && <span className="mt-1 block text-[12px] text-white/50">Choose Arc Testnet in the Circle faucet.</span>}
        </span>
      </li>
    ))}</ol>}
    {workspace.walletConnection && <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-5 py-4"><span className="mono min-w-0 break-all text-xs text-white/60">{workspace.walletConnection.address}</span><button className={buttonClass.ghost} onClick={async () => { try { await navigator.clipboard.writeText(workspace.walletConnection!.address); setCopyState("Address copied"); } catch { setCopyState("Copy unavailable. Select the address above."); } }}>Copy address</button>{copyState && <span role="status" className="text-xs">{copyState}</span>}</div>}
  </SectionCard>;
}
