"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { earnJobApiSchema, earnQuoteApiSchema, type EarnOperation, type EarnPosition, type EarnQuote, type EarnVault } from "@/lib/earn/models";
import { getActiveWalletRuntime } from "@/lib/wallet/runtime";
import type { Money } from "@/lib/treasury/models";
import { formatMoney as formatTreasuryMoney } from "@/lib/treasury/format";
import { StatusPill } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const inputClass = "mt-2 w-full border border-black/20 bg-white px-3 py-3 text-sm outline-none focus:border-[#164b32]";
const labels: Record<EarnOperation, string> = { DEPOSIT: "Deposit", WITHDRAW: "Withdraw", REDEEM_ALL: "Redeem all" };
const formatMoney = (money: Money) => formatTreasuryMoney(money, { fractionDigits: 6 });

export function EarnOperationDialog({ operation, vault, position, policyLimit, enabled }: { operation: EarnOperation; vault: EarnVault; position?: EarnPosition; policyLimit: Money; enabled: boolean }) {
  const { workspaceScope, workspace, syncForEarn, recordEarnActivity, recordEarnEvent, refreshEarn, refreshWallet } = useTreasuryWorkspace();
  const [timeline, setTimeline] = useState<string[]>([]);
  const [open, setOpen] = useState(false); const [amount, setAmount] = useState(""); const [quote, setQuote] = useState<EarnQuote | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [acknowledged, setAcknowledged] = useState(false); const [result, setResult] = useState<{ txHash: string; explorerUrl: string; status: string } | null>(null);
  const walletAddress = workspace.walletConnection?.address;
  const reset = () => { setAmount(""); setQuote(null); setError(""); setBusy(false); setAcknowledged(false); setResult(null); setTimeline([]); };
  const requestQuote = async (event: React.FormEvent) => {
    event.preventDefault(); if (!walletAddress) return; setBusy(true); setError(""); setQuote(null); setResult(null);
    try {
      await syncForEarn();
      const response = await fetch("/api/earn/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceScope, operation, vaultAddress: vault.address, amount: operation === "REDEEM_ALL" ? undefined : amount }) });
      const parsed = earnQuoteApiSchema.safeParse(await response.json()); if (!parsed.success) throw new Error("The quote response failed validation."); if (parsed.data.status === "ERROR") throw new Error(parsed.data.message);
      setQuote(parsed.data.quote); recordEarnActivity("Earn quote reviewed", `${labels[operation]} quote prepared for ${formatMoney(parsed.data.quote.amount)} in ${vault.name}.`, "The quote is short-lived and no transaction has been submitted.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The quote could not be prepared."); } finally { setBusy(false); }
  };
  const execute = async () => {
    if (!quote?.quoteId) return; setBusy(true); setError("");
    recordEarnActivity("Earn user confirmation", `${labels[operation]} was explicitly confirmed for ${formatMoney(quote.amount)} in ${vault.name}.`, "User confirmation is not a signature or an onchain receipt.", undefined, { approval: "APPROVED", execution: "NOT_STARTED" });
    try {
      const response = await fetch("/api/earn/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceScope, quoteId: quote.quoteId, confirmed: true, warningsAcknowledged: acknowledged }) });
      const parsed = earnJobApiSchema.parse(await response.json()); if (parsed.status === "ERROR") throw new Error(parsed.message);
      let job = parsed; const deadline = Date.now() + 7 * 60_000; const answered = new Set<string>(); let recordedEvents = 0;
      const status = async (body: object) => {
        const reply = await fetch("/api/earn/execution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceScope, executionId: job.executionId, ...body }) });
        const next = earnJobApiSchema.parse(await reply.json()); if (next.status === "ERROR") throw new Error(next.message); return next;
      };
      while (!job.result && Date.now() < deadline) {
        for (const event of job.events.slice(recordedEvents)) recordEarnEvent(event.stage, event.hash);
        recordedEvents = job.events.length;
        setTimeline(job.events.map((event) => `${event.stage.replaceAll("_", " ")}${event.hash ? ` · ${event.hash}` : ""}`));
        if (job.state === "FAILED" || job.state === "UNKNOWN") throw new Error(job.state === "FAILED" ? "The operation did not complete. Review any approvals before creating a new quote." : "Submission outcome is unknown. Check the explorer; Hodd will not retry automatically.");
        if (job.pending && !answered.has(job.pending.id)) {
          const pending = job.pending; answered.add(pending.id);
          const signer = getActiveWalletRuntime();
          if (!signer || (!pending.challengeId && !signer.sendCalls) || (pending.challengeId && !signer.approveChallenge) || signer.connection.connectedAt !== workspace.walletConnection?.connectedAt || signer.connection.address.toLowerCase() !== quote.walletAddress.toLowerCase()) { await status({ requestId: pending.id, cancelled: true }); throw new Error("The signer session changed or expired. Reconnect and request a fresh quote."); }
          if (pending.challengeId) {
            try { await signer.approveChallenge!(pending.challengeId); }
            catch { await status({ requestId: pending.id, cancelled: true, uncertain: true }); throw new Error("PIN approval did not complete. Review the wallet before retrying."); }
            job = await status({}); continue;
          }
          let hash: string;
          try { hash = await signer.sendCalls!(pending.calls, pending.gasBudgetWei, (userOperationHash) => { void status({ requestId: pending.id, userOperationHash }).catch(() => undefined); }); }
          catch (caught) {
            const denied = typeof caught === "object" && caught !== null && "code" in caught && caught.code === 4001;
            await status({ requestId: pending.id, cancelled: true, uncertain: !denied });
            throw new Error("Wallet approval was cancelled or could not be verified. Inspect the wallet before retrying.");
          }
          job = await status({ requestId: pending.id, txHash: hash });
        } else { await new Promise((resolve) => window.setTimeout(resolve, 1500)); job = await status({}); }
      }
      if (!job.result) throw new Error("Receipt verification timed out. Check the explorer; do not resubmit automatically.");
      for (const event of job.events.slice(recordedEvents)) recordEarnEvent(event.stage, event.hash);
      const execution = job.result; setResult(execution); recordEarnActivity(`Earn ${labels[operation].toLowerCase()} confirmed`, `${formatMoney(execution.amount)} completed with status ${execution.status}.`, "A successful Arc receipt was checked against the selected vault, operation, amount and receiving wallet.", execution); refreshEarn(); refreshWallet();
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Execution status is unknown. Check the explorer before retrying."; setError(message); recordEarnActivity("Earn execution requires review", `${labels[operation]} did not return a confirmed receipt.`, message, undefined, { approval: "APPROVED", execution: "UNKNOWN" }); } finally { setBusy(false); }
  };
  const unavailable = !enabled || !walletAddress || (operation !== "DEPOSIT" && (!position || BigInt(position.currentBalance.minorUnits) === 0n));
  return <Dialog.Root open={open} onOpenChange={(next) => { if (busy && !next) return; setOpen(next); if (!next) reset(); }}><Dialog.Trigger asChild><button disabled={unavailable} className="border border-black/20 px-3 py-2 text-xs font-semibold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-35">{labels[operation]}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="earn-operation-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#fffdf7] shadow-2xl focus:outline-none"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/15 bg-[#fffdf7] px-5 py-4"><div><p className="mono text-[9px] uppercase text-black/40">Arc Testnet · two-step confirmation</p><Dialog.Title className="mt-1 text-lg font-semibold">{labels[operation]} USDC</Dialog.Title></div><Dialog.Close disabled={busy} aria-label={`Close ${labels[operation]} dialog`} className="grid size-10 place-items-center border border-black/15 disabled:opacity-35"><X className="size-4" /></Dialog.Close></div><Dialog.Description id="earn-operation-description" className="px-5 pt-5 text-sm leading-6 text-black/55">Review a fresh Circle App Kit quote before separately confirming the onchain operation. The wallet may submit an approval and an Earn transaction. Keep this dialog open while signing; reject an unwanted request in your wallet.</Dialog.Description>
    <div className="m-5 border border-black/15"><div className="border-b border-black/10 p-4"><p className="text-[10px] uppercase text-black/40">Verified vault</p><p className="mt-2 text-sm font-semibold">{vault.name}</p><p className="mono mt-1 break-all text-[10px] text-black/40">{vault.address}</p></div><div className="grid grid-cols-2 gap-px bg-black/10"><div className="bg-[#fffdf7] p-4"><p className="text-[10px] uppercase text-black/40">Policy limit</p><p className="mono mt-2 text-sm">{formatMoney(policyLimit)}</p></div><div className="bg-[#fffdf7] p-4"><p className="text-[10px] uppercase text-black/40">Operation</p><p className="mono mt-2 text-sm">{labels[operation]}</p></div></div></div>
    {!quote && !result && <form onSubmit={requestQuote} className="px-5 pb-5">{operation !== "REDEEM_ALL" ? <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-black/50">Amount (USDC)<input aria-label={`${labels[operation]} amount`} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1.00" className={`${inputClass} mono`} /></label> : <p className="border border-[#456c9c]/20 bg-[#dfe9f5] p-3 text-xs leading-5 text-[#294e7c]">A fresh position read determines the maximum withdrawal. Hodd never loops or retries automatically if dust remains.</p>}<button disabled={busy} className="mt-5 flex w-full items-center justify-center gap-2 bg-[#0b0d0c] px-5 py-4 text-sm font-semibold text-white disabled:opacity-50">{busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}Review fresh quote</button></form>}
    {quote && !result && <div className="space-y-4 px-5 pb-5"><div className="border border-black/15 p-4"><div className="flex items-center justify-between gap-4"><p className="text-sm font-semibold">Quote result</p><StatusPill label={quote.policy.status} tone={quote.policy.status === "PASS" ? "success" : quote.policy.status === "BLOCKED" ? "danger" : "warning"} /></div><dl className="mt-4 grid grid-cols-2 gap-4 text-xs"><div><dt className="text-black/40">Amount</dt><dd className="mono mt-1">{formatMoney(quote.amount)}</dd></div><div><dt className="text-black/40">Fee reserve</dt><dd className="mono mt-1">{formatMoney(quote.fees)}</dd></div>{quote.expectedShares && <div><dt className="text-black/40">Expected shares</dt><dd className="mono mt-1 break-all">{quote.expectedShares}</dd></div>}{quote.sharesToRedeem && <div><dt className="text-black/40">Shares to redeem</dt><dd className="mono mt-1 break-all">{quote.sharesToRedeem}</dd></div>}</dl><p className="mt-4 text-xs leading-5 text-black/55">{quote.policy.reason}</p></div>{quote.warnings.length > 0 && <label className="block border border-[#906a2f]/25 bg-[#f3e8ce] p-4 text-xs leading-5 text-[#694813]"><span className="font-semibold">Quote warnings</span>{quote.warnings.map((warning) => <span key={warning} className="mt-1 block">{warning}</span>)}<span className="mt-3 flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />I understand these warnings and want to continue.</span></label>}<button onClick={execute} disabled={busy || !quote.quoteId || quote.policy.status === "BLOCKED" || (quote.requiresWarningAcknowledgement && !acknowledged)} className="flex w-full items-center justify-center gap-2 bg-[#0b0d0c] px-5 py-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35">{busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}Confirm onchain {labels[operation].toLowerCase()}</button><p className="text-[10px] leading-4 text-black/40">Quote expires at {quote.expiresAt ? new Date(quote.expiresAt).toLocaleTimeString() : "—"}. Confirmation is single-use.</p></div>}
    {result && <div role="status" className="m-5 border border-[#2c7a50]/25 bg-[#dff5e8] p-5 text-[#164b32]"><StatusPill label={result.status} tone={result.status === "COMPLETE" ? "success" : "warning"} /><p className="mt-3 text-sm font-semibold">Arc Testnet receipt returned.</p><a href={result.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold">Open transaction <ArrowUpRight className="size-3" /></a></div>}
    {timeline.length > 0 && <ol aria-label="Execution timeline" aria-live="polite" className="m-5 space-y-2 text-xs">{timeline.map((entry, index) => <li key={`${index}-${entry}`} className="break-all border border-black/15 p-3">{entry}</li>)}</ol>}
    {error && <p role="alert" className="mx-5 mb-5 border border-[#9a433c]/20 bg-[#f5dedb] p-3 text-xs leading-5 text-[#7b332d]">{error}</p>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
