"use client";

import { useState } from "react";
import clsx from "clsx";

type TabId = "capital" | "liquidity" | "obligations";
const tabs = [
  { id: "capital" as const, no: "01", label: "Capital", title: "Your wallet, on Arc Testnet", body: "Read your live USDC balance and verified Morpho vault positions. Your own wallet approves every deposit and withdrawal.", features: ["Live Arc Testnet wallet balance", "Morpho vault discovery and positions", "Fresh quotes and wallet signatures"] },
  { id: "liquidity" as const, no: "02", label: "Liquidity", title: "Protect bills before yield", body: "The Treasury Engine uses verified balances, your obligations and your safety buffer to calculate protected and deployable capital.", features: ["User-defined safety buffer and limits", "Deterministic allocation previews", "Financial outputs pause when balances are unavailable"] },
  { id: "obligations" as const, no: "03", label: "Obligations", title: "Your bills, your approval", body: "Add your own bills and review payment readiness. Hoddie explains your treasury; the Claude connector prepares changes for you to approve.", features: ["Your obligations and payment readiness", "Hoddie answers from the Treasury Engine", "Claude connector with separate review", "Wallet approval and verified payment receipts"] },
];
const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";

export function SystemTabs() {
  const [tab, setTab] = useState<TabId>("capital");
  const active = tabs.find((item) => item.id === tab) ?? tabs[0];
  return <div className="flex flex-wrap items-stretch gap-x-16 gap-y-11">
    <div className="max-w-[520px] flex-[1_1_380px] self-start">{tabs.map((item) => <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => setTab(item.id)} className="group block w-full cursor-pointer border-t border-[#f4f1e8]/20 px-6 pb-7 pt-6 text-left text-[#f4f1e8] opacity-55 transition-opacity last:border-b hover:opacity-85 aria-pressed:bg-gradient-to-r aria-pressed:from-[#4678ff]/25 aria-pressed:to-transparent aria-pressed:opacity-100 aria-pressed:shadow-[inset_3px_0_0_#7fa6ff]">
      <span className="flex items-baseline gap-[18px]"><span className={clsx(label, "text-[#8fb0ff]")}>{item.no}</span><span className="disp text-[clamp(1.75rem,3.4vw,2.75rem)]">{item.label}</span></span>
      <span className="mt-3.5 hidden max-w-[420px] pl-11 text-base leading-[1.55] text-[#c9cbd3] group-aria-pressed:block">{item.body}</span>
    </button>)}</div>
    <div className="flex min-w-0 flex-[1.4_1_520px] flex-col overflow-hidden rounded-[14px] border border-white/20 bg-gradient-to-br from-white/[0.12] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_40px_100px_rgba(10,40,170,0.4)]">
      <div className="border-b border-white/[0.14] px-[18px] py-3"><span className={clsx(label, "text-[#8fb0ff]")}>Live testnet features</span></div>
      <div aria-live="polite" className="flex-1 p-[clamp(20px,3vw,32px)]"><h3 className="disp text-[clamp(1.9rem,4vw,3.25rem)]">{active.title}</h3><p className="mt-5 text-base leading-7 text-[#c9cbd3]">{active.body}</p><ul className="mt-8 divide-y divide-white/[0.14] border-y border-white/[0.14]">{active.features.map((feature) => <li key={feature} className="py-4 text-sm text-[#c9cbd3]">{feature}</li>)}</ul><p className={clsx(label, "mt-8 text-[#a5a8b3]")}>Sign in and connect your wallet to see your own data.</p></div>
    </div>
  </div>;
}
