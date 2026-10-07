"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowUpRight, BriefcaseBusiness, Landmark, ListChecks } from "lucide-react";
import clsx from "clsx";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { formatDate } from "@/lib/treasury/format";
import { AccountMenu } from "./account-menu";

const navigation = [
  { href: "/", label: "Portfolio", icon: Landmark },
  { href: "/invest", label: "Invest", icon: BriefcaseBusiness },
  { href: "/obligations", label: "Obligations", icon: ListChecks },
  { href: "/activity", label: "Activity", icon: Activity },
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
    <div className="min-h-screen bg-[#f3f0e8] lg:grid lg:grid-cols-[244px_1fr]">
      <aside className="hidden min-h-screen border-r border-white/10 bg-[#0b0d0c] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="border-b border-white/10 px-6 py-7">
          <Link href="/" className="inline-flex items-center gap-3" aria-label="Hodd portfolio home">
            <span className="grid size-9 place-items-center border border-[#8be0b1]/60 text-sm font-bold text-[#8be0b1]">H</span>
            <span className="text-xl font-semibold tracking-[-0.04em]">Hodd</span>
          </Link>
          <p className="mono mt-3 text-[9px] uppercase tracking-[0.18em] text-white/40">Treasury operations</p>
        </div>
        <nav aria-label="Primary navigation" className="px-3 py-5">
          <ul className="space-y-1">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined} className={clsx("flex items-center gap-3 border px-3 py-3 text-sm transition-colors", active ? "border-[#8be0b1]/30 bg-[#8be0b1]/10 text-[#b7f3cf]" : "border-transparent text-white/55 hover:border-white/10 hover:text-white")}>
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
            <div className="flex items-center gap-2 text-xs text-[#b7f3cf]"><span className="size-1.5 bg-[#8be0b1]" />{liveMode ? "Arc Testnet · user-owned wallet" : "Local demo workspace"}</div>
            <p className="mt-2 text-xs leading-5 text-white/45">{liveMode ? walletState.status === "READY" ? "Live balances · wallet approval required for writes" : "Live balance unavailable · engine paused" : "Treasury Engine · no funds can move"}</p>
          </div>
          <a href="https://docs.arc.io/" target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-between text-xs text-white/45 hover:text-white">
            Arc documentation <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-black/10 bg-[#f3f0e8]/95 px-4 backdrop-blur md:px-8 lg:px-10">
          <Link href="/" className="flex items-center gap-2 lg:hidden" aria-label="Hodd portfolio home">
            <span className="grid size-8 place-items-center bg-[#0b0d0c] text-xs font-bold text-[#8be0b1]">H</span>
            <span className="font-semibold tracking-[-0.03em]">Hodd</span>
          </Link>
          <div className="hidden items-center gap-3 lg:flex">
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-black/45">{liveMode ? walletLabel : "Local workspace"}</span>
            <span className="h-3 w-px bg-black/15" />
            <span className="text-xs text-black/55">{liveMode ? "User-controlled · transaction writes paused" : "Editable · no funds can move"}</span>
          </div>
          <div className="flex items-center gap-2">
            <AccountMenu />
            <span className="hidden text-xs text-black/45 sm:inline">Updated {formatDate(workspace.updatedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            <span className="border border-black/15 bg-[#fffdf7] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]">Arc Testnet</span>
          </div>
        </header>
        <main className="pb-24 lg:pb-0">{children}</main>
      </div>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b0d0c] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-white lg:hidden">
        <ul className="grid grid-cols-4">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className={clsx("flex min-h-12 flex-col items-center justify-center gap-1 text-[10px]", active ? "text-[#8be0b1]" : "text-white/45")}>
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
