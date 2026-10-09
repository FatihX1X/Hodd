"use client";

import { useState } from "react";
import clsx from "clsx";
import { Meter, MoneyValue, SectionCard, SectionHeading, StatusPill, labelClass } from "./primitives";
import { formatMoney, formatPercentFromBps } from "@/lib/treasury/format";
import type { StrategyPosition, TreasuryWorkspace } from "@/lib/treasury/models";
import { multiplyBps } from "@/lib/treasury/money";
import { allocationByLiquidity, capUsage, liquidityLabels, strategyLabels } from "@/lib/treasury/views";

const liquidityNote: Record<StrategyPosition["liquidity"], string> = {
  INSTANT: "Counts as cash. It is the first source used for any payment.",
  VARIABLE: "Redeemable, but the amount available depends on the venue at the time.",
  RESTRICTED: "Subject to redemption limits, so it is not counted as safely available.",
};

function strategyStatus(workspace: TreasuryWorkspace, strategy: StrategyPosition) {
  if (strategy.integration === "LIVE") return { label: "LIVE", tone: "success" as const };
  if (workspace.policy.enabledStrategies[strategy.kind]) return { label: "Preview enabled", tone: "success" as const };
  return { label: strategy.integration, tone: "neutral" as const };
}

/** Every strategy as a row (liquidity, balance, use of its policy cap, APY, status) with the selected one explained beside it. */
export function StrategyTable({ workspace, strategies }: { workspace: TreasuryWorkspace; strategies: readonly StrategyPosition[] }) {
  const [selectedId, setSelectedId] = useState(strategies[0]?.id ?? "");
  const colors = new Map(allocationByLiquidity(strategies).map((row) => [row.id, row.color]));
  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? strategies[0];
  if (!selected) return null;
  const usage = capUsage(workspace, selected);
  const status = strategyStatus(workspace, selected);
  const capped = selected.kind !== "LIQUID";
  const overCap = capped && usage.ratio !== null && usage.ratio > 1;

  return (
    <SectionCard>
      <SectionHeading index="02.1" title="Strategies" description="Live protocol availability remains distinct from local planning targets" />
      <div className="grid xl:grid-cols-[1fr_320px]">
        <div role="region" aria-label="Strategies table" tabIndex={0} className="relative overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#7fa6ff]">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">Strategies with liquidity class, balance, policy cap use, APY and status</caption>
            <thead>
              <tr className="border-b border-white/[0.14]">
                {["Strategy", "Liquidity", "Balance", "Cap use", "APY", "Status"].map((heading) => <th key={heading} scope="col" className={clsx(labelClass, "px-5 py-3 text-left font-normal", heading === "Balance" && "text-right")}>{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {strategies.map((strategy) => {
                const row = strategyStatus(workspace, strategy);
                const cap = capUsage(workspace, strategy);
                const isSelected = strategy.id === selected.id;
                const color = colors.get(strategy.id);
                return (
                  <tr key={strategy.id} className={clsx("border-b border-white/10 last:border-b-0", isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")}>
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <button type="button" onClick={() => setSelectedId(strategy.id)} aria-pressed={isSelected} className="flex min-h-11 items-center gap-3 text-left">
                        <span aria-hidden="true" className={clsx("size-3 shrink-0 rounded-[2px]", !color && "border-[1.5px] border-[#898781]")} style={color ? { background: color } : undefined} />
                        <span><span className="block font-medium">{strategy.name}</span><span className={labelClass}>{strategyLabels[strategy.kind]}</span></span>
                      </button>
                    </th>
                    <td className="px-5 py-3 text-white/70">{liquidityLabels[strategy.liquidity]}</td>
                    <td className="px-5 py-3 text-right"><MoneyValue money={strategy.balance} className="whitespace-nowrap text-xs" /></td>
                    <td className="w-44 px-5 py-3">{strategy.kind === "LIQUID" ? <span className={labelClass}>No cap</span> : (
                      <div className="flex items-center gap-3"><Meter ratio={cap.ratio} label={`${strategy.name} cap use`} className="w-20 shrink-0" /><span className="mono whitespace-nowrap text-xs tabular-nums text-white/70">{formatPercentFromBps(cap.capBps)} cap</span></div>
                    )}</td>
                    <td className="mono px-5 py-3 text-xs">{strategy.apyBps === null ? "—" : formatPercentFromBps(strategy.apyBps, 2)}</td>
                    <td className="px-5 py-3"><StatusPill label={row.label} tone={row.tone} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside aria-label={`${selected.name} detail`} className="border-t border-white/[0.14] p-5 xl:border-l xl:border-t-0">
          <div className="flex items-start justify-between gap-3">
            <div><p className={labelClass}>{strategyLabels[selected.kind]}</p><h3 className="disp mt-2 text-[17px]">{selected.name}</h3></div>
            <StatusPill label={status.label} tone={status.tone} />
          </div>
          <p className="mt-4 text-xs leading-5 text-white/60"><strong className="font-semibold text-white/85">{liquidityLabels[selected.liquidity]}.</strong> {liquidityNote[selected.liquidity]}</p>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-white/10 pt-5">
            <div><dt className={labelClass}>Balance</dt><dd><MoneyValue money={selected.balance} className="mt-2 block text-sm" /></dd></div>
            <div><dt className={labelClass}>Redeemable</dt><dd><MoneyValue money={selected.redeemable} className="mt-2 block text-sm" /></dd></div>
            <div><dt className={labelClass}>Share of treasury</dt><dd className="mono mt-2 text-sm">{(usage.share * 100).toFixed(1)}%</dd></div>
            <div><dt className={labelClass}>APY</dt><dd className="mono mt-2 text-sm">{selected.apyBps === null ? "Not available" : formatPercentFromBps(selected.apyBps, 2)}</dd></div>
            <div><dt className={labelClass}>Risk</dt><dd className="mono mt-2 text-sm">{selected.risk}</dd></div>
            <div><dt className={labelClass}>Integration</dt><dd className="mono mt-2 text-sm">{selected.integration}</dd></div>
          </dl>
          {capped && (
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className={labelClass}>Policy cap</p>
              <p className="mt-2 text-sm">{workspace.policy.enabledStrategies[selected.kind] ? `Up to ${formatPercentFromBps(usage.capBps)} of the treasury, ${formatMoney(multiplyBps(workspace.totalTreasury, usage.capBps))}.` : "Disabled by policy. Capital stays in Liquid USDC."}</p>
              <Meter ratio={usage.ratio} label={`${selected.name} cap use`} className="mt-3" />
              <p className={clsx("mt-2 text-xs", overCap ? "text-[#ff9a92]" : "text-white/50")}>{overCap ? "This position is above its cap." : usage.ratio === null ? "No capacity is allowed for this strategy." : `${Math.round(Math.min(usage.ratio, 1) * 100)}% of the cap is in use.`}</p>
            </div>
          )}
        </aside>
      </div>
    </SectionCard>
  );
}
