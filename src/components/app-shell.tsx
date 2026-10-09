"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowUpRight, Bot, BriefcaseBusiness, Landmark, ListChecks, Plug } from "lucide-react";
import clsx from "clsx";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { formatDate } from "@/lib/treasury/format";
import { AccountMenu } from "./account-menu";

const navigation = [
  { href: "/", label: "Portfolio", icon: Landmark },
  { href: "/invest", label: "Invest", icon: BriefcaseBusiness },
  { href: "/obligations", label: "Obligations", icon: ListChecks },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/connections", label: "Connections", icon: Plug },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { workspace, walletState } = useTreasuryWorkspace();
  const liveMode = workspace.treasuryMode === "ARC_TESTNET_WALLET";
  const walletLabels = {
    CIRCLE_USER_CONTROLLED: "Circle Embedded",
    CIRCLE_MODULAR: "Circle Passkey",
    INJECTED_METAMASK: "MetaMask",
    INJECTED_RABBY: "Rabby",
    TEST_SIGNER: "Test signer (dev)",
  } as const;
  const walletLabel = workspace.walletConnection ? walletLabels[workspace.walletConnection.provider] : "User wallet";

  return (
    <div className="min-h-screen bg-[#ece8dd] lg:grid lg:grid-cols-[244px_1fr]">
      <aside className="hidden min-h-screen border-r border-white/10 bg-[#0b0b0d] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="border-b border-white/10 px-6 py-7">
          <Link href="/" className="inline-block" aria-label="Hodd portfolio home">
            <Image src="/brand/hodd-lockup-dark.png" alt="" width={1000} height={318} priority className="h-auto w-[168px]" />
          </Link>
          <p className="mono mt-4 text-[9px] uppercase tracking-[0.18em] text-white/40">Treasury operations</p>
        </div>
        <nav aria-label="Primary navigation" className="px-3 py-5">
          <ul className="space-y-1">
            {[...navigation, { href: "/hoddie", label: "Hoddie", icon: Bot }].map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined} className={clsx("mono flex items-center gap-3 border px-3 py-3 text-[11px] uppercase tracking-[0.09em] transition-colors", active ? "border-[#7fa6ff]/30 bg-[#7fa6ff]/10 text-[#b9ccff]" : "border-transparent text-white/55 hover:border-white/10 hover:text-white")}>
                    <Icon aria-hidden="true" className="size-4" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto border-t border-white/10 p-5">
          <div className="border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-xs text-[#b9ccff]"><span className="size-1.5 bg-[#7fa6ff]" />{liveMode ? "Arc Testnet · user-owned wallet" : "Local demo workspace"}</div>
            <p className="mt-2 text-xs leading-5 text-white/45">{liveMode ? walletState.status === "READY" ? "Live balances · wallet approval required for writes" : "Live balance unavailable · engine paused" : "Treasury Engine · no funds can move"}</p>
          </div>
          <a href="https://docs.arc.io/" target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-between text-xs text-white/45 hover:text-white">
            Arc documentation <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-black/10 bg-[#ece8dd]/95 px-4 backdrop-blur md:px-8 lg:px-10">
          <Link href="/" className="flex items-center lg:hidden" aria-label="Hodd portfolio home">
            <Image src="/brand/hodd-lockup-light.png" alt="" width={1912} height={608} priority className="h-auto w-[116px]" />
          </Link>
          <div className="hidden items-center gap-3 lg:flex">
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-black/45">{liveMode ? walletLabel : "Local workspace"}</span>
            <span className="h-3 w-px bg-black/15" />
            <span className="text-xs text-black/55">{liveMode ? "User-controlled · transaction writes paused" : "Editable · no funds can move"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/hoddie" aria-label="Open Hoddie" aria-current={pathname === "/hoddie" ? "page" : undefined} className="grid size-11 place-items-center border border-black/15 text-[#0a52e8] lg:hidden"><Bot aria-hidden="true" className="size-4" /></Link>
            <AccountMenu />
            <span className="hidden text-xs text-black/45 sm:inline">Updated {formatDate(workspace.updatedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            <span className="mono hidden border border-black/15 bg-[#f4f1e8] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:inline-block">Arc Testnet</span>
          </div>
        </header>
        <main className="pb-24 lg:pb-0">{children}</main>
      </div>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b0b0d] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-white lg:hidden">
        <ul className="grid grid-cols-5">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className={clsx("flex min-h-12 flex-col items-center justify-center gap-1 text-[10px]", active ? "text-[#7fa6ff]" : "text-white/45")}>
                  <Icon aria-hidden="true" className="size-4" />{label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
