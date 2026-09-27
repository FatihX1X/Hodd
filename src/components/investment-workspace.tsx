"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Check, Info, LockKeyhole, X } from "lucide-react";
import { MoneyValue, SectionCard, SectionHeading, StatusPill } from "./primitives";
import { formatPercentFromBps } from "@/lib/treasury/format";
import type { PortfolioSnapshot, StrategyPosition } from "@/lib/treasury/models";

const strategyCopy: Record<StrategyPosition["kind"], string> = {
  LIQUID: "Immediately available for obligations and operating runway.",
  MORPHO: "Selected yield strategy preview. Vault discovery is not connected.",
  USYC: "Eligibility and allowlist checks are outside Stage 1.",
  BTC_RESERVE: "Strategic reserve concept only; not part of the core demo.",
};

export function InvestmentWorkspace({ portfolio, strategies }: { portfolio: PortfolioSnapshot; strategies: StrategyPosition[] }) {
  return (
    <div className="metric-grid mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-10 lg:py-10">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <SectionCard>
            <SectionHeading index="02.1" title="Strategy shelf" description="A deliberately small allowlist for the treasury workflow" />
            <div className="grid sm:grid-cols-2">
              {strategies.map((strategy) => {
                const enabled = strategy.kind === "LIQUID" || strategy.kind === "MORPHO";
                return (
                  <article key={strategy.id} className="flex min-h-56 flex-col border-b border-black/15 p-5 odd:sm:border-r sm:[&:nth-last-child(-n+2)]:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="mono text-[9px] uppercase tracking-[0.15em] text-black/40">{strategy.kind.replace("_", " ")}</p><h2 className="mt-2 text-lg font-medium tracking-[-0.03em]">{strategy.name}</h2></div>
                      <StatusPill label={enabled ? "Preview" : strategy.integration} tone={enabled ? "success" : "neutral"} />
                    </div>
                    <p className="mt-4 text-xs leading-5 text-black/50">{strategyCopy[strategy.kind]}</p>
                    <div className="mt-auto grid grid-cols-3 gap-3 border-t border-black/10 pt-4">
                      <div><p className="text-[9px] uppercase tracking-[0.12em] text-black/35">APY</p><p className="mono mt-1 text-xs">{strategy.apyBps === null ? "—" : formatPercentFromBps(strategy.apyBps, 2)}</p></div>
                      <div><p className="text-[9px] uppercase tracking-[0.12em] text-black/35">Risk</p><p className="mono mt-1 text-xs">{strategy.risk}</p></div>
                      <div><p className="text-[9px] uppercase tracking-[0.12em] text-black/35">Liquidity</p><p className="mono mt-1 text-xs">{strategy.liquidity}</p></div>
                    </div>
                  </article>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard className="mt-6">
            <SectionHeading index="02.2" title="Target allocation" description="Targets apply to deployable capital only; no calculation runs in Stage 1" />
            <div className="p-5 md:p-7">
              <div className="flex h-3 overflow-hidden bg-black/5" aria-label="Target allocation: 20% Liquid USDC, 50% Morpho, 20% USYC, 10% BTC Reserve">
                <span className="w-[20%] bg-[#8be0b1]" /><span className="w-[50%] bg-[#87a8d8]" /><span className="w-[20%] bg-[#d8bc87]" /><span className="w-[10%] bg-[#8b8f8b]" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[["Liquid USDC", "20%", "bg-[#8be0b1]"], ["Morpho", "50%", "bg-[#87a8d8]"], ["USYC", "20%", "bg-[#d8bc87]"], ["BTC Reserve", "10%", "bg-[#8b8f8b]"]].map(([label, value, color]) => (
                  <div key={label} className="flex items-center justify-between border border-black/10 px-3 py-3"><span className="flex items-center gap-2 text-xs"><span className={`size-2 ${color}`} />{label}</span><span className="mono text-xs">{value}</span></div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-6">
          <SectionCard>
            <SectionHeading index="02.3" title="Capital boundary" />
            <div className="space-y-4 p-5">
              <div><p className="text-[10px] uppercase tracking-[0.14em] text-black/40">Treasury</p><MoneyValue money={portfolio.totalTreasury} className="mt-1 block text-xl" /></div>
              <div className="border-t border-black/10 pt-4"><p className="text-[10px] uppercase tracking-[0.14em] text-black/40">Protected</p><p className="mono mt-1 text-xl">5,500.00 USDC</p><p className="mt-1 text-xs text-black/45">Obligations + safety buffer</p></div>
              <div className="border-t border-black/10 pt-4"><p className="text-[10px] uppercase tracking-[0.14em] text-[#164b32]">Eligible for review</p><MoneyValue money={portfolio.deployableCapital} className="mt-1 block text-xl text-[#164b32]" /></div>
            </div>
          </SectionCard>

          <div className="border border-[#456c9c]/20 bg-[#dfe9f5] p-4 text-xs leading-5 text-[#294e7c]">
            <Info aria-hidden="true" className="mb-3 size-4" />The displayed boundary is a fixture, not a Treasury Engine result. Stage 2 will own deterministic calculations and policy validation.
          </div>

          <Dialog.Root>
            <Dialog.Trigger asChild><button className="flex w-full items-center justify-between bg-[#0b0d0c] px-5 py-4 text-sm font-semibold text-white hover:bg-[#242824]">Preview sample plan <ArrowRight aria-hidden="true" className="size-4" /></button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
              <Dialog.Content aria-describedby="investment-preview-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#fffdf7] p-0 shadow-2xl focus:outline-none">
                <div className="sticky top-0 flex items-center justify-between border-b border-black/15 bg-[#fffdf7] px-5 py-4">
                  <div><p className="mono text-[9px] uppercase tracking-[0.16em] text-black/40">Review only</p><Dialog.Title className="mt-1 text-lg font-semibold">Sample investment plan</Dialog.Title></div>
                  <Dialog.Close aria-label="Close investment preview" className="grid size-10 place-items-center border border-black/15 hover:bg-black/5"><X aria-hidden="true" className="size-4" /></Dialog.Close>
                </div>
                <Dialog.Description id="investment-preview-description" className="px-5 pt-5 text-sm leading-6 text-black/55">This panel demonstrates the review boundary. It does not create a proposal, approve a policy or submit a transaction.</Dialog.Description>
                <div className="m-5 border border-black/15">
                  <div className="border-b border-black/15 bg-black/[0.03] p-4"><div className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole aria-hidden="true" className="size-4" />Protected liquidity</div><p className="mono mt-2 text-2xl">5,500.00 USDC</p></div>
                  {[
                    ["Morpho USDC Vault", "3,000.00 USDC", "Available for future preview"],
                    ["USYC Reserve", "1,000.00 USDC", "Blocked · integration unavailable"],
                    ["BTC Reserve", "500.00 USDC", "Blocked · future strategy"],
                  ].map(([label, value, detail]) => <div key={label} className="border-b border-black/10 p-4 last:border-b-0"><div className="flex items-center justify-between gap-4"><p className="text-sm font-semibold">{label}</p><p className="mono text-xs">{value}</p></div><p className="mt-1 text-xs text-black/45">{detail}</p></div>)}
                </div>
                <div className="mx-5 border border-[#2c7a50]/20 bg-[#dff5e8] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[#164b32]"><Check aria-hidden="true" className="size-4" />Boundary explained</div><p className="mt-2 text-xs leading-5 text-[#164b32]/75">The preview distinguishes available, blocked and future strategies without claiming a live policy result.</p></div>
                <div className="p-5"><button disabled className="w-full cursor-not-allowed border border-black/15 bg-black/5 px-5 py-4 text-sm font-semibold text-black/35">Execution unavailable in Stage 1</button></div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </aside>
      </div>
    </div>
  );
}
