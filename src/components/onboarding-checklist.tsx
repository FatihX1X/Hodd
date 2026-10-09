"use client";

import { useState } from "react";
import Link from "next/link";
import { onboardingStates } from "@/lib/treasury/onboarding";
import { useWalletOwnership } from "@/lib/wallet/use-wallet-ownership";
import { buttonClass, SectionCard, SectionHeading } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

export function OnboardingChecklist() {
  const { mode, signedIn, workspace, walletState, earnState } = useTreasuryWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const [copyState, setCopyState] = useState("");
  const live = earnState.status === "READY" && earnState.portfolio.integration.execution === "TESTNET_LIVE";
  const ownership = useWalletOwnership(workspace.walletConnection, live);
  if (mode !== "LIVE") return null;
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
  return <SectionCard className="mb-6"><SectionHeading index="START" title="Your live testnet treasury" description="Your own wallet signs every transaction on Arc Testnet." action={complete ? <button className={buttonClass.ghost} onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? "Show checklist" : "Collapse checklist"}</button> : undefined} />{(!complete || !collapsed) && <ol className="divide-y divide-white/10">{steps.map((step) => <li key={step.title} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"><span><span className={step.done ? "text-[#8fe388]" : "text-white/45"}>{step.done ? "Done" : "Not done"}</span> · {step.title}{step.title === "Get free testnet USDC" && <span className="mt-1 block text-xs text-white/55">Choose Arc Testnet in the Circle faucet.</span>}</span><Link href={step.href} target={step.href.startsWith("https:") ? "_blank" : undefined} rel={step.href.startsWith("https:") ? "noreferrer" : undefined} className="text-xs text-[#8fb0ff] underline">{step.title}</Link></li>)}</ol>}{workspace.walletConnection && <div className="flex flex-wrap items-center gap-3 border-t border-white/10 p-5"><span className="mono min-w-0 break-all text-xs text-white/65">{workspace.walletConnection.address}</span><button className={buttonClass.ghost} onClick={async () => { try { await navigator.clipboard.writeText(workspace.walletConnection!.address); setCopyState("Address copied"); } catch { setCopyState("Copy unavailable. Select the address above."); } }}>Copy address</button>{copyState && <span role="status" className="text-xs">{copyState}</span>}</div>}</SectionCard>;
}
