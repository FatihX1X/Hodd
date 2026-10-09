"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowUpRight, Bot, BriefcaseBusiness, Landmark, ListChecks, Plug, SlidersHorizontal } from "lucide-react";
import clsx from "clsx";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { formatDate } from "@/lib/treasury/format";
import { DemoBanner } from "./demo-banner";
import { WelcomeGate } from "./welcome-gate";
import { SampleDataBanner } from "./sample-data-banner";
import { PageSkeleton } from "./page-states";
import { buttonClass, PageBody } from "./primitives";
import { OnboardingChecklist } from "./onboarding-checklist";
import { AccountMenu } from "./account-menu";
import { WalletPanel } from "./wallet-panel";

const navigation = [
  { href: "/", label: "Overview", icon: Landmark },
  { href: "/invest", label: "Strategies", icon: BriefcaseBusiness },
  { href: "/obligations", label: "Obligations", icon: ListChecks },
  { href: "/policy", label: "Policy", icon: SlidersHorizontal },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/hoddie", label: "Hoddie", icon: Bot },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { workspace, walletState, mode, hydrated, signedIn, enterDemo } = useTreasuryWorkspace();
  const liveMode = workspace.treasuryMode === "ARC_TESTNET_WALLET";
  const walletLabels = {
    CIRCLE_USER_CONTROLLED: "Circle Embedded",
    CIRCLE_MODULAR: "Circle Passkey",
    INJECTED_METAMASK: "MetaMask",
    INJECTED_RABBY: "Rabby",
    TEST_SIGNER: "Test signer (dev)",
  } as const;
  const walletLabel = workspace.walletConnection ? walletLabels[workspace.walletConnection.provider] : "User wallet";
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div data-theme="dark" className="min-h-screen bg-[#0b0b0d] text-[#f4f1e8] lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden min-h-screen border-r border-white/10 bg-[#0b0b0d] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="border-b border-white/10 px-6 py-7">
          <Link href="/" className="inline-block" aria-label="Hodd overview home">
            <Image src="/brand/hodd-lockup-dark.png" alt="" width={1000} height={318} priority className="h-auto w-[168px]" />
          </Link>
          <p className="mono mt-4 text-[9px] uppercase tracking-[0.18em] text-white/45">Treasury operations</p>
        </div>
        <nav aria-label="Primary navigation" className="px-3 py-5">
          <ul className="space-y-1">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined} className={clsx("mono flex min-h-11 items-center gap-3 border-l-2 px-3 text-[11px] uppercase tracking-[0.09em] transition-colors", active ? "border-[#7fa6ff] bg-gradient-to-r from-[#4678ff]/25 to-transparent text-[#f4f1e8]" : "border-transparent text-white/55 hover:bg-white/[0.05] hover:text-white")}>
                    <Icon aria-hidden="true" className="size-[18px]" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto border-t border-white/10 p-5">
          <div className="border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-xs text-[#b9ccff]"><span className="size-1.5 bg-[#7fa6ff]" />{liveMode ? "Arc Testnet · user-owned wallet" : mode === "DEMO" ? "Read-only sample workspace" : "Live Arc Testnet treasury"}</div>
            <p className="mt-2 text-xs leading-5 text-white/50">{mode === "DEMO" ? "Sample balances · nothing is saved" : liveMode ? walletState.status === "READY" ? "Live balances · wallet approval required" : "Live balance unavailable · engine paused" : "Connect your wallet to start"}</p>
          </div>
          <a href="https://docs.arc.io/" target="_blank" rel="noreferrer" className="mt-4 flex min-h-11 items-center justify-between text-xs text-white/50 hover:text-white">
            Arc documentation <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/10 bg-[#0b0b0d]/90 px-4 backdrop-blur md:px-8 lg:px-10">
          <Link href="/" className="flex items-center lg:hidden" aria-label="Hodd overview home">
            <Image src="/brand/hodd-lockup-dark.png" alt="" width={1000} height={318} priority className="h-auto w-[112px]" />
          </Link>
          <div className="hidden items-center gap-3 lg:flex">
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-white/55">{liveMode ? walletLabel : mode === "DEMO" ? "Read-only demo" : "Live treasury"}</span>
            <span className="h-3 w-px bg-white/20" />
            <span className="text-xs text-white/60">{mode === "DEMO" ? "Sample data · read-only" : "Your own wallet signs every transaction"}</span>
          </div>
          <div className="flex items-center gap-3">
            <AccountMenu />
            {hydrated && <span className="hidden text-xs text-white/50 sm:inline">Updated {formatDate(workspace.updatedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
            {mode === "DEMO" ? <span className="mono inline-flex min-h-8 items-center border border-white/15 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">Demo · no wallet</span> : hydrated && <WalletPanel variant="header" />}
          </div>
        </header>
        <main className="pb-24 lg:pb-0"><DemoBanner /><SampleDataBanner />{mode === "LIVE" && signedIn && hydrated && <div className="flex justify-end border-b border-white/10 px-5 py-2"><button onClick={enterDemo} className={buttonClass.ghost}>Explore the read-only demo</button></div>}{!hydrated ? <PageSkeleton /> : mode === "LIVE" && !signedIn && pathname !== "/hoddie" ? <WelcomeGate /> : <>{mode === "LIVE" && !workspace.walletConnection && pathname !== "/" && <PageBody><OnboardingChecklist /></PageBody>}{children}</>}</main>
      </div>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#0b0b0d]/95 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
        <ul className="grid grid-cols-7">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className={clsx("mono flex min-h-14 flex-col items-center justify-center gap-1 text-[7px] uppercase tracking-normal min-[400px]:text-[8px] min-[500px]:text-[9px]", active ? "text-[#f4f1e8]" : "text-white/50")}>
                  <Icon aria-hidden="true" className={clsx("size-[22px]", active && "text-[#7fa6ff]")} />{label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
