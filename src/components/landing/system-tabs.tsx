"use client";

import { useState } from "react";
import clsx from "clsx";

type TabId = "capital" | "liquidity" | "obligations";

const tabs: { id: TabId; no: string; label: string; body: string; title: string }[] = [
  { id: "capital", no: "01", label: "Capital", title: "Treasury / Capital", body: "Idle balances go to work the moment they land — inside the limits you set, never outside them." },
  { id: "liquidity", no: "02", label: "Liquidity", title: "Treasury / Liquidity", body: "Every position is sized against what’s due next, so cash is ready when it’s needed — not after." },
  { id: "obligations", no: "03", label: "Obligations", title: "Treasury / Obligations", body: "Payroll, vendors, taxes. Hodd reads what’s coming and moves money before the deadline does." },
];

const allocation = [
  ["Operating reserve", 35],
  ["Short-term strategies", 40],
  ["On-demand liquidity", 15],
  ["Opportunistic", 10],
] as const;

const obligations = [
  { day: "09", month: "Oct", name: "Payroll", note: "Funded from operating reserve.", status: "Funded", dot: "bg-[#7fe3a8]" },
  { day: "12", month: "Oct", name: "Vendor invoice", note: "Queued. Releases on the due date.", status: "Scheduled", dot: "bg-[#8fb0ff]" },
  { day: "15", month: "Dec", name: "Quarterly tax", note: "Reserved well ahead of the deadline.", status: "Reserved", dot: "bg-[#ffd27f]" },
] as const;

const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";

export function SystemTabs() {
  const [tab, setTab] = useState<TabId>("capital");
  const active = tabs.find((item) => item.id === tab) ?? tabs[0];

  return (
    <div className="flex flex-wrap items-stretch gap-x-16 gap-y-11">
      <div className="max-w-[520px] flex-[1_1_380px] self-start">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
            className="group block w-full cursor-pointer border-t border-[#f4f1e8]/20 px-6 pb-7 pt-6 text-left text-[#f4f1e8] opacity-55 transition-opacity last:border-b hover:opacity-85 aria-pressed:bg-gradient-to-r aria-pressed:from-[#4678ff]/25 aria-pressed:to-transparent aria-pressed:opacity-100 aria-pressed:shadow-[inset_3px_0_0_#7fa6ff]"
          >
            <span className="flex items-baseline gap-[18px]">
              <span className={clsx(label, "text-[#8fb0ff]")}>{item.no}</span>
              <span className="disp text-[clamp(1.75rem,3.4vw,2.75rem)]">{item.label}</span>
            </span>
            <span className="mt-3.5 hidden max-w-[420px] pl-11 text-base leading-[1.55] text-[#c9cbd3] group-aria-pressed:block">{item.body}</span>
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-[1.4_1_520px] flex-col overflow-hidden rounded-[14px] border border-white/20 bg-gradient-to-br from-white/[0.12] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_40px_100px_rgba(10,40,170,0.4)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.14] px-[18px] py-3">
          <div aria-hidden="true" className="flex gap-1.5">
            <span className="size-2.5 border border-white/50" />
            <span className="size-2.5 border border-white/50" />
            <span className="size-2.5 border border-white/50 bg-white/50" />
          </div>
          <div className={clsx(label, "text-[#c9cbd3]")}>{active.title}</div>
          <div className={clsx(label, "text-[#8fb0ff]")}>Illustrative</div>
        </div>

        <div aria-live="polite" className="flex-1 p-[clamp(20px,3vw,32px)]">
          {tab === "capital" && (
            <div>
              <div className={clsx(label, "text-[#a5a8b3]")}>Allocation by policy</div>
              <div className="mt-[26px] flex flex-col gap-[22px]">
                {allocation.map(([name, pct]) => (
                  <div key={name}>
                    <div className={clsx(label, "mb-2 flex justify-between")}><span>{name}</span><span>{pct}%</span></div>
                    <div className="h-2.5 bg-white/10"><div className="h-full bg-gradient-to-r from-[#0a52e8] to-[#8fb0ff]" style={{ width: `${pct}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className={clsx(label, "mt-8 border-t border-white/[0.14] pt-[18px] text-[#a5a8b3]")}>Policy · max 40% per strategy · inside your limits</div>
            </div>
          )}

          {tab === "liquidity" && (
            <div>
              <div className={clsx(label, "text-[#a5a8b3]")}>Liquidity position</div>
              <div className="disp my-[18px] mb-7 text-[clamp(1.9rem,4vw,3.25rem)]">Ready<br />when due.</div>
              <div className="flex h-11 gap-[3px]">
                <div className="bg-gradient-to-r from-[#0a52e8] to-[#8fb0ff]" style={{ flex: "62 1 0" }} />
                <div className="border border-white/40" style={{ flex: "38 1 0", background: "repeating-linear-gradient(135deg,rgba(255,255,255,.28) 0,rgba(255,255,255,.28) 2px,transparent 2px,transparent 8px)" }} />
              </div>
              <div className={clsx(label, "mt-2.5 flex justify-between gap-4")}><span>Available now · 62%</span><span className="text-right">Committed, next 14 days · 38%</span></div>
              <div className="mt-8 flex flex-wrap gap-px border border-white/[0.14] bg-white/[0.14]">
                <div className="flex-[1_1_180px] bg-[#0f1220] p-[18px]"><div className={clsx(label, "text-[#a5a8b3]")}>Next 14 days</div><div className="disp mt-2 text-[26px]">Covered</div></div>
                <div className="flex-[1_1_180px] bg-[#0f1220] p-[18px]"><div className={clsx(label, "text-[#a5a8b3]")}>Redemption</div><div className="disp mt-2 text-[26px]">On demand</div></div>
              </div>
            </div>
          )}

          {tab === "obligations" && (
            <div>
              <div className={clsx(label, "text-[#a5a8b3]")}>Upcoming obligations</div>
              <div className="mt-[22px]">
                {obligations.map((item, index) => (
                  <div key={item.name} className={clsx("flex items-center gap-5 border-t border-white/[0.14] py-[18px]", index === obligations.length - 1 && "border-b")}>
                    <div className="w-16 flex-none"><div className="disp text-[32px]">{item.day}</div><div className={clsx(label, "text-[#a5a8b3]")}>{item.month}</div></div>
                    <div className="min-w-0 flex-1"><div className="disp text-xl">{item.name}</div><div className="mt-1 text-[15px] text-[#c9cbd3]">{item.note}</div></div>
                    <div className={clsx(label, "inline-flex items-center gap-2 whitespace-nowrap")}><span aria-hidden="true" className={clsx("size-2 rounded-full", item.dot)} />{item.status}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
