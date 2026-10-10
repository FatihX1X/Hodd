"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { earnJobApiSchema } from "@/lib/earn/models";
import { formatMoney } from "@/lib/treasury/format";
import { SectionCard, SectionHeading, StatusPill } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

type OpenExecution = { id: string; state: string; operation: string; amount: { currency: "USDC"; decimals: 6; minorUnits: string }; txHash: string | null; failure: string | null };
const OPEN_STATES = ["PREPARING", "AWAITING_SIGNATURE", "SUBMITTED", "UNKNOWN"];
const hash = /^0x[\da-fA-F]{64}$/;
const labels: Record<string, string> = { DEPOSIT: "Deposit", WITHDRAW: "Withdraw", REDEEM_ALL: "Redeem all" };

/** Lists this owner's open Earn executions so a closed dialog or a reconnect never strands a wallet lease. */
export function EarnRecoveryPanel() {
  const { mode, workspaceScope, workspace, refreshEarn, refreshWallet, paymentLedgerRevision } = useTreasuryWorkspace();
  const [rows, setRows] = useState<OpenExecution[]>([]); const [busy, setBusy] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, string>>({}); const [messages, setMessages] = useState<Record<string, string>>({}); const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; const client = createSupabaseBrowserClient();
    if (!client) return;
    void (async () => {
      const { data: auth } = await client.auth.getUser();
      if (!auth.user) { if (active) setRows([]); return; }
      const { data, error } = await client.from("earn_executions").select("id,state,quote,pending,failure").eq("user_id", auth.user.id).eq("scope", workspaceScope).in("state", OPEN_STATES).order("created_at", { ascending: false }).limit(5);
      if (!active || error) return;
      setRows((data ?? []).map((row) => ({ id: String(row.id), state: String(row.state), operation: String(row.quote?.operation ?? ""), amount: { currency: "USDC", decimals: 6, minorUnits: String(row.quote?.amount?.minorUnits ?? "0") }, txHash: typeof row.pending?.txHash === "string" && hash.test(row.pending.txHash) ? row.pending.txHash : null, failure: typeof row.failure?.code === "string" ? row.failure.code : null })));
    })().catch(() => undefined);
    return () => { active = false; };
  }, [mode, workspaceScope, workspace.updatedAt, paymentLedgerRevision, refresh]);
  if (!rows.length) return null;
  const recover = async (row: OpenExecution, body: object) => {
    setBusy(row.id); setMessages((current) => ({ ...current, [row.id]: "" }));
    try {
      const response = await fetch("/api/earn/execution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceScope, executionId: row.id, action: "RECOVER", ...body }) });
      const job = earnJobApiSchema.parse(await response.json());
      if (job.status === "ERROR") throw new Error(job.message);
      const message = job.result ? `Verified: ${job.result.status.toLowerCase()}. The wallet is free again.` : job.state === "FAILED" ? "Released: nothing was sent from this request." : job.state === "UNKNOWN" ? "Still unverified. Check your wallet activity or paste the transaction hash." : "Verification is in progress. Check again in a moment.";
      setMessages((current) => ({ ...current, [row.id]: message }));
      if (job.result || job.state === "FAILED") { refreshEarn(); refreshWallet(); }
      setRefresh((value) => value + 1);
    } catch (cause) { setMessages((current) => ({ ...current, [row.id]: cause instanceof Error ? cause.message : "Recovery could not be verified." })); }
    finally { setBusy(null); }
  };
  return <div className="mx-auto max-w-[1440px] px-5 pt-7 md:px-8 lg:px-10 lg:pt-10"><SectionCard><SectionHeading index="02.0" title="Open Earn executions" description="This wallet stays locked for Earn and payments until each one is resolved" /><div className="space-y-4 p-5">
    {rows.map((row) => {
      const candidate = candidates[row.id] ?? "";
      return <article key={row.id} aria-label={`Open execution ${row.id}`} className="space-y-3 border border-[#fab219]/30 bg-[#fab219]/10 p-4 text-xs leading-5 text-[#ffd27f]">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold text-[#f4f1e8]">{labels[row.operation] ?? row.operation} · {formatMoney(row.amount, { fractionDigits: 6 })}</p><StatusPill label={row.state.replaceAll("_", " ")} tone="warning" /></div>
        {row.txHash && <a className="mono block break-all underline" href={`https://testnet.arcscan.app/tx/${row.txHash}`} target="_blank" rel="noreferrer">Reported transaction: {row.txHash}</a>}
        {row.failure && <p className="mono text-white/60">{row.failure.replaceAll("_", " ")}</p>}
        <div className="flex flex-wrap gap-2">
          <button disabled={busy !== null} onClick={() => void recover(row, {})} className="border border-white/20 px-3 py-2 text-[#f4f1e8] disabled:opacity-40">Check again (no new transaction)</button>
          {!row.txHash && <button disabled={busy !== null} onClick={() => void recover(row, { acknowledgeNoPendingTransaction: true })} className="border border-white/20 px-3 py-2 text-[#f4f1e8] disabled:opacity-40">I rejected or closed the wallet request</button>}
        </div>
        {row.state === "UNKNOWN" && <div className="flex flex-wrap items-end gap-2"><label className="block min-w-0 flex-1">Transaction hash from your wallet<input value={candidate} onChange={(event) => { const value = event.target.value.trim(); setCandidates((current) => ({ ...current, [row.id]: value })); }} placeholder="0x…" className="mono mt-1 w-full border border-white/20 bg-[#0b0b0d] p-2 text-[#f4f1e8]" /></label><button disabled={busy !== null || !hash.test(candidate)} onClick={() => void recover(row, { candidateTxHash: candidate })} className="border border-white/20 px-3 py-2 text-[#f4f1e8] disabled:opacity-40">Verify this transaction</button></div>}
        {messages[row.id] && <p role="status" className="text-[#f4f1e8]">{messages[row.id]}</p>}
      </article>;
    })}
  </div></SectionCard></div>;
}
