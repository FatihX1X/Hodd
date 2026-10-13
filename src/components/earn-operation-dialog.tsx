"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle, TriangleAlert, X, Zap } from "lucide-react";
import { LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { earnJobApiSchema, earnQuoteApiSchema, type EarnExecutionResult, type EarnOperation, type EarnPosition, type EarnQuote, type EarnVault } from "@/lib/earn/models";
import { getActiveWalletRuntime, isSignerFor } from "@/lib/wallet/runtime";
import { useHasActiveSigner } from "@/lib/wallet/use-active-signer";
import { WalletPreflightError } from "@/lib/wallet/preflight";
import type { Money } from "@/lib/treasury/models";
import { formatMoney as formatTreasuryMoney } from "@/lib/treasury/format";
import { EarnEventDetails, EarnProgress, type EarnEvent, type EarnOutcome } from "./earn-progress";
import { Meter, StatusPill, buttonClass, labelClass } from "./primitives";
import { ConfirmButton } from "./confirm-button";
import { InfoTip, moneyColor } from "./visuals";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const inputClass = "mt-2 w-full border border-white/25 bg-[#0b0b0d] text-[#f4f1e8] px-3 py-3 text-sm outline-none placeholder:text-white/35 focus:border-[#7fa6ff]";
const labels: Record<EarnOperation, string> = { DEPOSIT: "Deposit", WITHDRAW: "Withdraw", REDEEM_ALL: "Redeem all" };
const formatMoney = (money: Money) => formatTreasuryMoney(money, { fractionDigits: 6 });

export function EarnOperationDialog({ operation, vault, position, policyLimit, enabled, initialAmount = "", onComplete }: { operation: EarnOperation; vault: EarnVault; position?: EarnPosition; policyLimit: Money; enabled: boolean; initialAmount?: string; onComplete?: (result: EarnExecutionResult) => void }) {
  const { workspaceScope, workspace, syncForEarn, recordEarnActivity, recordEarnEvent, refreshEarn, refreshWallet } = useTreasuryWorkspace();
  const [timeline, setTimeline] = useState<EarnEvent[]>([]); const [started, setStarted] = useState(false);
  const [open, setOpen] = useState(false); const [amount, setAmount] = useState(initialAmount); const [quote, setQuote] = useState<EarnQuote | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [acknowledged, setAcknowledged] = useState(false); const [result, setResult] = useState<{ txHash: string; explorerUrl: string; status: string } | null>(null); const [unknownId, setUnknownId] = useState<string | null>(null); const [candidate, setCandidate] = useState("");
  const walletAddress = workspace.walletConnection?.address;
  // The signer lives only in memory; a persisted connection alone cannot sign.
  const hasSigner = useHasActiveSigner(workspace.walletConnection);
  const signerMissing = "Signer session is not active (page reload, expiry or workspace switch). Reconnect the wallet, then request a fresh quote. No quote was used.";
  const reset = () => { setAmount(initialAmount); setQuote(null); setError(""); setBusy(false); setAcknowledged(false); setResult(null); setTimeline([]); setStarted(false); setUnknownId(null); setCandidate(""); };
  const executionRequest = async (executionId: string, body: object) => {
    const reply = await fetch("/api/earn/execution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceScope, executionId, ...body }) });
    const next = earnJobApiSchema.parse(await reply.json()); if (next.status === "ERROR") throw new Error(next.message); return next;
  };
  const finished = (execution: EarnExecutionResult) => { setResult(execution); setUnknownId(null); recordEarnActivity(`Earn ${labels[operation].toLowerCase()} confirmed`, `${formatMoney(execution.amount)} completed with status ${execution.status}.`, "A successful Arc receipt was checked against the selected vault, operation, amount and receiving wallet.", execution); refreshEarn(); refreshWallet(); onComplete?.(execution); };
  // Uncertain outcomes move only with evidence: a mined hash, or an unchanged wallet nonce the user confirms.
  const recover = async (body: object) => {
    if (!unknownId) return; setBusy(true); setError("");
    try {
      const job = await executionRequest(unknownId, body);
      setTimeline(job.events);
      if (job.result) finished(job.result);
      else if (job.state === "FAILED") { setUnknownId(null); setError("Released: nothing was submitted from this request. Request a new quote to try again."); }
      else setError(job.state === "UNKNOWN" ? "The outcome is still unknown. Check your wallet activity or paste the transaction hash." : "Verification is in progress. Check again in a moment.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Recovery could not be verified."); } finally { setBusy(false); }
  };
  const requestQuote = async (event: React.FormEvent) => {
    event.preventDefault(); if (!walletAddress) return; if (!hasSigner) { setError(signerMissing); return; } setBusy(true); setError(""); setQuote(null); setResult(null);
    let next: EarnQuote | null = null;
    try {
      await syncForEarn();
      const response = await fetch("/api/earn/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceScope, operation, vaultAddress: vault.address, amount: operation === "REDEEM_ALL" ? undefined : amount }) });
      const parsed = earnQuoteApiSchema.safeParse(await response.json()); if (!parsed.success) throw new Error("The quote response failed validation."); if (parsed.data.status === "ERROR") throw new Error(parsed.data.message);
      next = parsed.data.quote; setQuote(next); recordEarnActivity("Earn quote reviewed", `${labels[operation]} quote prepared for ${formatMoney(next.amount)} in ${vault.name}.`, "The quote is short-lived and no transaction has been submitted.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The quote could not be prepared."); }
    // One click: a clean quote (policy PASS, no warnings) goes straight to the wallet. A block or warnings stop here for the user.
    if (next?.quoteId && next.policy.status === "PASS" && !next.warnings.length && !next.requiresWarningAcknowledgement) return execute(next);
    setBusy(false);
  };
  const execute = async (target: EarnQuote | null = quote) => {
    if (!target?.quoteId) return;
    const quote = target;
    // Check before /execute so a missing signer never consumes the single-use quote.
    const current = getActiveWalletRuntime();
    if (!isSignerFor(current, workspace.walletConnection) || current.connection.address.toLowerCase() !== quote.walletAddress.toLowerCase()) { setError(signerMissing); setBusy(false); return; }
    setBusy(true); setError(""); setStarted(true);
    recordEarnActivity("Earn user confirmation", `${labels[operation]} was confirmed for ${formatMoney(quote.amount)} in ${vault.name}.`, "User confirmation is not a signature or an onchain receipt.", undefined, { approval: "APPROVED", execution: "NOT_STARTED" });
    try {
      const response = await fetch("/api/earn/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceScope, quoteId: quote.quoteId, confirmed: true, warningsAcknowledged: acknowledged }) });
      const parsed = earnJobApiSchema.parse(await response.json()); if (parsed.status === "ERROR") throw new Error(parsed.message);
      let job = parsed; const deadline = Date.now() + 7 * 60_000; const answered = new Set<string>(); let recordedEvents = 0;
      const status = (body: object) => executionRequest(job.executionId, body);
      while (!job.result && Date.now() < deadline) {
        for (const event of job.events.slice(recordedEvents)) recordEarnEvent(event.stage, event.hash);
        recordedEvents = job.events.length;
        setTimeline(job.events);
        if (job.state === "UNKNOWN") setUnknownId(job.executionId);
        if (job.state === "FAILED" || job.state === "UNKNOWN") {
          const details = job.failure ? ` Diagnostic: ${job.failure.stage} / ${job.failure.code}${job.failure.providerCode ? ` / Circle ${job.failure.providerCode}` : ""}.` : "";
          throw new Error((job.state === "FAILED" ? "The operation did not complete. Review any approvals before creating a new quote." : "Submission outcome is unknown. Check the explorer; Hodd will not retry automatically.") + details);
        }
        if (job.pending && !answered.has(job.pending.id)) {
          const pending = job.pending; answered.add(pending.id);
          // Never open the wallet for a request the server no longer accepts.
          if (pending.expiresAt && Date.parse(pending.expiresAt) <= Date.now()) { await status({ requestId: pending.id, cancelled: true }); throw new Error("The signing window expired before the wallet opened. Request a new quote."); }
          const signer = getActiveWalletRuntime();
          if (!isSignerFor(signer, workspace.walletConnection) || (!pending.challengeId && !signer.sendCalls) || (pending.challengeId && !signer.approveChallenge) || signer.connection.address.toLowerCase() !== quote.walletAddress.toLowerCase()) { await status({ requestId: pending.id, cancelled: true }); throw new Error("The signer session changed or expired. Reconnect and request a fresh quote."); }
          if (pending.challengeId) {
            try { await signer.approveChallenge!(pending.challengeId); }
            catch { await status({ requestId: pending.id, cancelled: true, uncertain: true }); throw new Error("PIN approval did not complete. Review the wallet before retrying."); }
            job = await status({ requestId: pending.id, challengeApproved: true }); continue;
          }
          let hash: string;
          try { hash = await signer.sendCalls!(pending.calls, pending.gasBudgetWei, (userOperationHash) => { void status({ requestId: pending.id, userOperationHash }).catch(() => undefined); }, undefined, pending.gasCeiling); }
          catch (caught) {
            const denied = typeof caught === "object" && caught !== null && "code" in caught && caught.code === 4001;
            const preflight = caught instanceof WalletPreflightError;
            await status({ requestId: pending.id, cancelled: true, uncertain: !denied && !preflight });
            if (preflight) throw new Error(`Wallet preflight (${caught.code}): ${caught.message}`);
            throw new Error("Wallet approval was cancelled or could not be verified. Inspect the wallet before retrying.");
          }
          job = await status({ requestId: pending.id, txHash: hash });
        } else { await new Promise((resolve) => window.setTimeout(resolve, 2000)); job = await status({}); }
      }
      if (!job.result) { setUnknownId(job.executionId); throw new Error("Receipt verification is taking longer than expected. Use “Check again” below; do not resubmit."); }
      for (const event of job.events.slice(recordedEvents)) recordEarnEvent(event.stage, event.hash);
      setTimeline(job.events);
      finished(job.result);
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Execution status is unknown. Check the explorer before retrying."; setError(message); setQuote((current) => current ? { ...current, quoteId: null } : current); recordEarnActivity("Earn execution requires review", `${labels[operation]} did not return a confirmed receipt.`, message, undefined, { approval: "APPROVED", execution: "UNKNOWN" }); } finally { setBusy(false); }
  };
  const outcome: EarnOutcome = result ? (result.status === "COMPLETE" ? "done" : "partial") : unknownId ? "unknown" : error && !busy ? "failed" : "running";
  const reduced = useReducedMotion();
  // The typed amount against the policy limit, so a too-large amount shows before a quote is requested.
  const typed = Number(amount.replace(",", ".")); const limit = Number(BigInt(policyLimit.minorUnits)) / 10 ** policyLimit.decimals;
  const enteredRatio = amount.trim() !== "" && Number.isFinite(typed) && typed > 0 && limit > 0 ? typed / limit : null;
  const unavailable = !enabled || !walletAddress || (operation !== "DEPOSIT" && (!position || BigInt(position.currentBalance.minorUnits) === 0n));
  return <Dialog.Root open={open} onOpenChange={(next) => { if (busy && !next) return; setOpen(next); if (!next) reset(); }}><Dialog.Trigger asChild><button disabled={unavailable} className={operation === "DEPOSIT" ? buttonClass.primary : buttonClass.ghost}>{operation === "DEPOSIT" ? <ArrowDownToLine aria-hidden="true" className="size-4" /> : <ArrowUpFromLine aria-hidden="true" className="size-4" />}{labels[operation]}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="earn-operation-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] shadow-2xl focus:outline-none"><LazyMotion features={domAnimation} strict><div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.14] bg-[#101319] px-5 py-4"><div><p className={`${labelClass} flex items-center gap-1.5`}><Zap aria-hidden="true" className="size-3.5 text-[#7fa6ff]" />One click on Arc Testnet</p><Dialog.Title className="disp mt-1 text-lg">{labels[operation]} USDC</Dialog.Title></div><Dialog.Close disabled={busy} aria-label={`Close ${labels[operation]} dialog`} className="grid size-10 place-items-center border border-white/[0.14] disabled:opacity-35"><X className="size-4" /></Dialog.Close></div><Dialog.Description id="earn-operation-description" className="flex items-center gap-1 px-5 pt-4 text-sm leading-6 text-white/65">A fresh quote, then your wallet. Keep this dialog open while signing.<InfoTip label="About this step">Hodd gets a fresh Circle App Kit quote and, when it passes policy without warnings, opens your wallet right away. A policy block or warnings stop here for you to review. The wallet may ask for an approval and an Earn transaction; keep this dialog open while signing.</InfoTip></Dialog.Description>
    <div className="m-5 border border-white/[0.14]"><div className="border-b border-white/10 p-4"><p className={labelClass}>Verified vault</p><p className="mt-2 flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: moneyColor.MORPHO }} />{vault.name}</p><p className="mono mt-1 break-all text-[10px] text-white/50">{vault.address}</p></div><div className="p-4"><div className="flex items-baseline justify-between gap-4"><p className={labelClass}>Policy limit</p><p className="mono text-sm tabular-nums">{formatMoney(policyLimit)}</p></div>{operation !== "REDEEM_ALL" && <Meter ratio={enteredRatio} label="Typed amount against the policy limit" className="mt-3" />}</div></div>
    {!quote && !result && <form onSubmit={requestQuote} className="px-5 pb-5">{operation !== "REDEEM_ALL" ? <label className={`block ${labelClass}`}>Amount (USDC)<input aria-label={`${labels[operation]} amount`} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1.00" className={`${inputClass} mono`} /></label> : <p className="flex items-center gap-1 border border-[#5598e7]/30 bg-[#5598e7]/10 p-3 text-xs leading-5 text-[#9ec5f4]">The whole position is withdrawn.<InfoTip label="About redeeming all">A fresh position read determines the maximum withdrawal. Hodd never loops or retries automatically if dust remains.</InfoTip></p>}<ConfirmButton type="submit" disabled={busy} className="mt-5 w-full py-4">{busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}{labels[operation]} now</ConfirmButton></form>}
    {!hasSigner && !result && <p role="note" className="mx-5 mb-4 flex items-start gap-2 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs leading-5 text-[#ffd27f]"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>Signer session: reconnect required. Use “Reconnect signer” in the wallet panel before quoting or confirming.</span></p>}
    {quote && !result && !(started && busy) && <m.div className="space-y-4 px-5 pb-5" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.35, ease: [0.19, 1, 0.22, 1] }}><div className="border border-white/[0.14] p-4"><div className="flex items-center justify-between gap-4"><p className="text-sm font-semibold">Quote result</p><StatusPill label={quote.policy.status} tone={quote.policy.status === "PASS" ? "success" : quote.policy.status === "BLOCKED" ? "danger" : "warning"} /></div><dl className="mt-4 grid grid-cols-2 gap-4 text-xs"><div><dt className={labelClass}>Amount</dt><dd className="mono mt-1">{formatMoney(quote.amount)}</dd></div><div><dt className={labelClass}>Fee reserve</dt><dd className="mono mt-1">{formatMoney(quote.fees)}</dd></div>{quote.expectedShares && <div><dt className={labelClass}>Expected shares</dt><dd className="mono mt-1 break-all">{quote.expectedShares}</dd></div>}{quote.sharesToRedeem && <div><dt className={labelClass}>Shares to redeem</dt><dd className="mono mt-1 break-all">{quote.sharesToRedeem}</dd></div>}</dl><p className="mt-4 text-xs leading-5 text-white/65">{quote.policy.reason}</p></div>{quote.warnings.length > 0 && <label className="block border border-[#fab219]/30 bg-[#fab219]/10 p-4 text-xs leading-5 text-[#ffd27f]"><span className="font-semibold">Quote warnings</span>{quote.warnings.map((warning) => <span key={warning} className="mt-1 block">{warning}</span>)}<span className="mt-3 flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />I understand these warnings and want to continue.</span></label>}<button onClick={() => void execute()} disabled={busy || !hasSigner || !quote.quoteId || quote.policy.status === "BLOCKED" || (quote.requiresWarningAcknowledgement && !acknowledged)} className={`${buttonClass.primary} w-full py-4`}>{busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}Confirm onchain {labels[operation].toLowerCase()}</button><p className="text-[10px] leading-4 text-white/50">Quote expires at {quote.expiresAt ? new Date(quote.expiresAt).toLocaleTimeString() : "—"}. Confirmation is single-use.</p></m.div>}
    {(started || timeline.length > 0 || result) && <EarnProgress operation={operation} events={timeline} outcome={outcome} explorerUrl={result?.explorerUrl} />}
    <EarnEventDetails events={timeline} />
    {unknownId && !result && <div role="group" aria-label="Resolve unknown outcome" className="m-5 space-y-3 border border-[#fab219]/30 bg-[#fab219]/10 p-4 text-xs leading-5 text-[#ffd27f]"><p className="font-semibold">Outcome unknown. This wallet stays locked for Earn and payments until it is resolved.</p><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void recover({ action: "RECOVER" })} className={buttonClass.ghost}>Check again</button><button disabled={busy} onClick={() => void recover({ action: "RECOVER", acknowledgeNoPendingTransaction: true })} className={buttonClass.ghost}>I rejected or closed the wallet request</button></div><label className={`block ${labelClass} text-[#ffd27f]`}>Transaction hash from your wallet<input value={candidate} onChange={(event) => setCandidate(event.target.value.trim())} placeholder="0x…" className={`${inputClass} mono`} /></label><button disabled={busy || !/^0x[\da-fA-F]{64}$/.test(candidate)} onClick={() => void recover({ action: "RECOVER", candidateTxHash: candidate })} className={buttonClass.ghost}>Verify this transaction</button></div>}
    {error && <p role="alert" className="mx-5 mb-5 flex items-start gap-2 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs leading-5 text-[#ff9a92]"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></p>}
  </LazyMotion></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
