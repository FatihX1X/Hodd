"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/treasury/format";
import { GatewayMoveDialog } from "./gateway-move-dialog";
import { MoneyValue, SectionCard, SectionHeading, StatusPill, labelClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { useUnifiedUsdc } from "./use-unified-usdc";

const nonZero = (value: { minorUnits: string } | null) => BigInt(value?.minorUnits ?? "0") > 0n;

/**
 * Overview: the same wallet's USDC on every Circle Gateway testnet, plus its
 * Gateway unified balance, in one place. Display only — the Treasury Engine
 * still counts Arc funds alone until they are moved to Arc.
 */
export function UnifiedBalancePanel() {
  const { workspace } = useTreasuryWorkspace();
  const address = workspace.walletConnection?.address;
  const { state, reload } = useUnifiedUsdc(address);
  const [showAll, setShowAll] = useState(false);
  if (!address) return null;
  const view = state.status === "READY" ? state.view : state.status === "ERROR" ? state.stale ?? null : null;
  const rows = view ? view.chains.filter((item) => showAll || item.domain === 26 || nonZero(item.wallet) || nonZero(item.gateway)) : [];
  const arc = view?.chains.find((item) => item.domain === 26);
  return <SectionCard className="mt-6">
    <SectionHeading index="01.0" title="USDC on every chain" description="Your wallet on each Circle Gateway testnet and your Gateway unified balance. Only Arc funds count toward the treasury engine until you move them." action={<button aria-label="Refresh cross-chain balances" disabled={state.status === "LOADING"} onClick={() => void reload()} className="grid size-9 place-items-center border border-white/20 disabled:opacity-40"><RefreshCw aria-hidden="true" className="size-3.5" /></button>} />
    {!view ? <p role="status" className="p-5 text-sm text-white/60">{state.status === "ERROR" ? state.message : "Reading USDC on every supported testnet…"}</p> : <>
      <div className="grid gap-5 border-b border-white/[0.14] p-5 md:grid-cols-[1.3fr_1fr_1fr_1fr] md:items-end">
        <div><p className={labelClass}>All chains</p><MoneyValue money={view.totals.all} className="mt-2 block text-3xl font-medium tracking-[-0.04em]" /></div>
        <div><p className={labelClass}>Arc wallet</p><MoneyValue money={arc?.wallet ?? view.totals.wallet} className="mt-2 block text-sm" /></div>
        <div><p className={labelClass}>In Gateway · any chain</p><MoneyValue money={view.totals.gateway} className="mt-2 block text-sm text-[#9ec5f4]" /></div>
        <div><p className={labelClass}>Wallets on other chains</p><MoneyValue money={view.totals.offArcWallet} className="mt-2 block text-sm" /></div>
      </div>
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-white/10"><th className={`${labelClass} px-5 py-3 font-normal`}>Chain</th><th className={`${labelClass} px-3 py-3 text-right font-normal`}>Wallet</th><th className={`${labelClass} px-5 py-3 text-right font-normal`}>Gateway</th></tr></thead>
        <tbody className="divide-y divide-white/10">{rows.map((item) => <tr key={item.key}>
          <td className="px-5 py-3">{item.label}{item.domain === 26 && <span className="ml-2"><StatusPill label="Treasury" tone="info" /></span>}</td>
          <td className="mono px-3 py-3 text-right tabular-nums">{item.wallet ? formatMoney(item.wallet, { fractionDigits: 2 }) : <span className="text-white/40">n/a</span>}</td>
          <td className="mono px-5 py-3 text-right tabular-nums text-[#9ec5f4]">{item.gateway ? formatMoney(item.gateway, { fractionDigits: 2 }) : <span className="text-white/40">n/a</span>}</td>
        </tr>)}</tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.14] px-5 py-4">
        <div className="text-xs leading-5 text-white/50">
          <button onClick={() => setShowAll((value) => !value)} className="underline">{showAll ? "Hide empty chains" : `Show all ${view.chains.length} chains`}</button>
          <span className="ml-3">Read {formatDate(view.observedAt, { year: undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{view.gatewayStatus === "UNAVAILABLE" ? " · Gateway unavailable" : ""}{view.unavailableChains.length ? ` · not readable: ${view.unavailableChains.join(", ")}` : ""}</span>
        </div>
        <GatewayMoveDialog view={view} onChanged={reload} />
      </div>
    </>}
  </SectionCard>;
}
