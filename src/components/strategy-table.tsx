"use client";

import { useState } from "react";
import clsx from "clsx";
import { Layers } from "lucide-react";
import { MoneyValue, SectionCard, SectionHeading, StatusPill, labelClass } from "./primitives";
import { InfoTip, Ring, moneyColor } from "./visuals";
import { formatMoney, formatPercentFromBps } from "@/lib/treasury/format";
import type { StrategyPosition, TreasuryWorkspace } from "@/lib/treasury/models";
import { multiplyBps } from "@/lib/treasury/money";
import { capUsage, liquidityLabels, strategyColor, strategyLabels } from "@/lib/treasury/views";

const liquidityNote: Record<StrategyPosition["liquidity"], string> = {
  INSTANT: "Counts as cash. It is the first source used for any payment.",
  VARIABLE: "Redeemable, but the amount available depends on the venue at the time.",
  RESTRICTED: "Subject to redemption limits, so it is not counted as safely available.",
};
const liquidityLevel: Record<StrategyPosition["liquidity"], number> = { INSTANT: 3, VARIABLE: 2, RESTRICTED: 1 };

function strategyStatus(workspace: TreasuryWorkspace, strategy: StrategyPosition) {
  if (strategy.integration === "DEMO") return { label: "Not connected", tone: "neutral" as const };
  if (strategy.integration === "LIVE") return { label: "LIVE", tone: "success" as const };
  if (workspace.policy.enabledStrategies[strategy.kind]) return { label: "Preview enabled", tone: "success" as const };
  return { label: strategy.integration, tone: "neutral" as const };
}

/** The ring colour says how full a cap is: the strategy's own colour, amber when nearly full, red when over. */
function capColor(ratio: number | null, base: string) {
  return ratio !== null && ratio > 1 ? moneyColor.danger : ratio !== null && ratio > 0.85 ? "#fab219" : base;
}

/** Three bars for how quickly the money can be used: instant, variable, restricted. The word is always there for screen readers. */
function LiquidityBars({ liquidity }: { liquidity: StrategyPosition["liquidity"] }) {
  return (
    <span className="inline-flex items-center gap-2 text-white/70">
      <span aria-hidden="true" className="inline-flex items-end gap-[3px]">
        {[1, 2, 3].map((level) => <span key={level} className={clsx("w-[3px] rounded-[1px]", level <= liquidityLevel[liquidity] ? "bg-[#9ec5f4]" : "bg-white/20")} style={{ height: 4 + level * 3 }} />)}
      </span>
      {liquidityLabels[liquidity]}
    </span>
  );
}

/** Every strategy as a row (colour, balance, cap use, APY, status) with the selected one shown beside it. */
export function StrategyTable({ workspace, strategies }: { workspace: TreasuryWorkspace; strategies: readonly StrategyPosition[] }) {
  const [selectedId, setSelectedId] = useState(strategies[0]?.id ?? "");
  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? strategies[0];
  if (!selected) return null;
  const usage = capUsage(workspace, selected);
  const status = strategyStatus(workspace, selected);
  const capped = selected.kind !== "LIQUID";
  const overCap = capped && usage.ratio !== null && usage.ratio > 1;
  const selectedColor = strategyColor[selected.kind];

  return (
    <SectionCard>
      <SectionHeading icon={<Layers className="size-4" />} title="Strategies" action={<InfoTip label="About strategies">Live protocol availability remains distinct from local planning targets.</InfoTip>} />
      <div className="grid xl:grid-cols-[1fr_320px]">
        <div role="region" aria-label="Strategies table" tabIndex={0} className="relative overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#7fa6ff]">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <caption className="sr-only">Strategies with liquidity class, balance, policy cap use, APY and status</caption>
            <thead>
              <tr className="border-b border-white/[0.14]">
                {["Strategy", "Liquidity", "Balance", "Cap use", "APY", "Status"].map((heading) => <th key={heading} scope="col" className={clsx(labelClass, "px-4 py-3 text-left font-normal", heading === "Balance" && "text-right")}>{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {strategies.map((strategy) => {
                const row = strategyStatus(workspace, strategy);
                const cap = capUsage(workspace, strategy);
                const isSelected = strategy.id === selected.id;
                const color = strategyColor[strategy.kind];
                return (
                  <tr key={strategy.id} className={clsx("border-b border-white/10 last:border-b-0", isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")}>
                    <th scope="row" className="min-w-[11rem] px-4 py-2 text-left font-normal">
                      <button type="button" onClick={() => setSelectedId(strategy.id)} aria-pressed={isSelected} className="flex min-h-11 items-center gap-3 text-left">
                        <span aria-hidden="true" className="size-3 shrink-0 rounded-[2px]" style={{ background: color }} />
                        <span><span className="block font-medium">{strategy.name}</span><span className={labelClass}>{strategyLabels[strategy.kind]}</span></span>
                      </button>
                    </th>
                    <td className="px-4 py-2 text-[13px]"><LiquidityBars liquidity={strategy.liquidity} /></td>
                    <td className="px-4 py-2 text-right">
                      <MoneyValue money={strategy.balance} className="whitespace-nowrap text-xs" />
                      <span aria-hidden="true" className="mt-1.5 ml-auto block h-[3px] w-16 bg-white/10"><span className="block h-full" style={{ width: `${Math.min(cap.share, 1) * 100}%`, background: color }} /></span>
                    </td>
                    <td className="px-4 py-2">{strategy.kind === "LIQUID" ? <span className={labelClass}>No cap</span> : (
                      <div className="flex items-center gap-2.5">
                        <Ring ratio={cap.ratio} label={`${strategy.name} cap use`} color={capColor(cap.ratio, color)} size={44} stroke={5}><span className="mono text-[10px] tabular-nums">{cap.ratio === null ? "—" : `${Math.round(Math.min(cap.ratio, 1.5) * 100)}%`}</span></Ring>
                        <span className="mono whitespace-nowrap text-[11px] tabular-nums text-white/55">of {formatPercentFromBps(cap.capBps)}</span>
                      </div>
                    )}</td>
                    <td className="mono px-4 py-2 text-base tabular-nums">{strategy.apyBps === null ? <span className="text-white/45">—</span> : formatPercentFromBps(strategy.apyBps, 2)}</td>
                    <td className="px-4 py-2"><StatusPill label={row.label} tone={row.tone} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside aria-label={`${selected.name} detail`} className="border-t border-white/[0.14] p-5 xl:border-l xl:border-t-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-[2px]" style={{ background: selectedColor }} />
              <div><p className={labelClass}>{strategyLabels[selected.kind]}</p><h3 className="disp mt-1 text-[17px]">{selected.name}</h3></div>
            </div>
            <StatusPill label={status.label} tone={status.tone} />
          </div>
          <p className="mt-4 flex items-center gap-1 text-xs leading-5 text-white/60"><strong className="font-semibold text-white/85">{liquidityLabels[selected.liquidity]}.</strong><InfoTip label="About this liquidity class">{liquidityNote[selected.liquidity]}</InfoTip></p>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <Ring ratio={usage.share} label={`${selected.name} share of treasury`} color={selectedColor} size={76} stroke={7}><span className="mono text-[13px] tabular-nums">{(usage.share * 100).toFixed(1)}%</span></Ring>
              <p className={clsx(labelClass, "min-w-0")}>Share of treasury</p>
            </div>
            <div>
              <p className={labelClass}>APY</p>
              <p className="mono mt-2 text-2xl tabular-nums tracking-[-0.03em]">{selected.apyBps === null ? <span className="text-sm text-white/50">Not available</span> : formatPercentFromBps(selected.apyBps, 2)}</p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-white/10 pt-5">
            <div><dt className={labelClass}>Balance</dt><dd><MoneyValue money={selected.balance} className="mt-2 block text-sm" /></dd></div>
            <div><dt className={labelClass}>Redeemable</dt><dd><MoneyValue money={selected.redeemable} className="mt-2 block text-sm" /></dd></div>
            <div><dt className={labelClass}>Risk</dt><dd className="mono mt-2 text-sm">{selected.risk}</dd></div>
          </dl>
          {capped && (
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className={labelClass}>Policy cap</p>
              <div className="mt-3 flex items-center gap-4">
                <Ring ratio={usage.ratio} label={`${selected.name} cap use`} color={capColor(usage.ratio, selectedColor)} size={64} stroke={6}><span className="mono text-xs tabular-nums">{usage.ratio === null ? "—" : `${Math.round(Math.min(usage.ratio, 1.5) * 100)}%`}</span></Ring>
                <p className="min-w-0 text-sm">{workspace.policy.enabledStrategies[selected.kind] ? `Up to ${formatPercentFromBps(usage.capBps)} of the treasury, ${formatMoney(multiplyBps(workspace.totalTreasury, usage.capBps))}.` : "Disabled by policy. Capital stays in Liquid USDC."}</p>
              </div>
              {(overCap || usage.ratio === null) && <p className={clsx("mt-2 text-xs", overCap ? "text-[#ff9a92]" : "text-white/50")}>{overCap ? "This position is above its cap." : "No capacity is allowed for this strategy."}</p>}
            </div>
          )}
        </aside>
      </div>
    </SectionCard>
  );
}
