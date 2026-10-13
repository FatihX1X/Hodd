"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ExternalLink, Fuel, Hourglass, Info, Send, ShieldCheck, Timer, Wallet, X } from "lucide-react";
import type { Obligation } from "@/lib/treasury/models";
import { formatDate, formatMoney } from "@/lib/treasury/format";
import { paymentResponseSchema, type PaymentRecord } from "@/lib/payments/models";
import { getActiveWalletRuntime, isSignerFor } from "@/lib/wallet/runtime";
import { WalletPreflightError } from "@/lib/wallet/preflight";
import { PaymentSteps, StatusChip } from "./ledger-visuals";
import { buttonClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { InfoTip, moneyColor } from "./visuals";

const stateMeta = (state: PaymentRecord["state"]) => state === "CONFIRMED" ? { icon: CheckCircle2, color: moneyColor.safe } : state === "FAILED" || state === "CANCELLED" || state === "EXPIRED" ? { icon: AlertTriangle, color: moneyColor.danger } : state === "REVIEW_REQUIRED" ? { icon: ShieldCheck, color: moneyColor.deployable } : { icon: Hourglass, color: moneyColor.protected };

export function PaymentDialog({ obligation }: { obligation: Obligation }) {
  const { workspace, workspaceScope, syncForEarn, refreshPaymentLedger } = useTreasuryWorkspace();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<PaymentRecord | null>(null); const [error, setError] = useState(""); const [candidate, setCandidate] = useState("");
  const request = async (body: object) => {
    const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: workspaceScope, ...body }) });
    const result = paymentResponseSchema.parse(await response.json());
    if (result.status === "ERROR") throw new Error(result.message);
    setRecord(result.record); return result;
  };
  // Recheck, verify a pasted hash, or release with a nonce proof; never a new transfer.
  const resolve = async (body: object) => {
    setBusy(true); setError("");
    try { await request(body); await refreshPaymentLedger(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The payment remains unverified. Do not resubmit."); }
    finally { setBusy(false); }
  };
  const review = async () => {
    setBusy(true); setError("");
    try { await syncForEarn(); await request({ action: "REVIEW", obligationId: obligation.id }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Review unavailable."); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!record) return;
    // Check before CONFIRM so a missing in-memory signer never claims the proposal.
    const current = getActiveWalletRuntime();
    if (!isSignerFor(current, record.proposal.wallet) || current.connection.provider !== record.proposal.wallet.provider) { setError("Signer session is not active. Reconnect the wallet in the wallet panel; the proposal was not claimed."); return; }
    setBusy(true); setError("");
    try {
      let job = await request({ action: "CONFIRM", proposalId: record.id, confirmed: true });
      await refreshPaymentLedger();
      const deadline = Date.now() + 7 * 60_000; const answered = new Set<string>();
      while (["AWAITING_SIGNATURE", "SUBMITTED"].includes(job.record.state) && Date.now() < deadline) {
        if (job.pending && !answered.has(job.pending.id)) {
          const pending = job.pending; answered.add(pending.id);
          // Never open the wallet for a request the server no longer accepts.
          if (pending.expiresAt && Date.parse(pending.expiresAt) <= Date.now()) { await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, cancelled: true }); throw new Error("The signing window expired before the wallet opened. Review a fresh proposal."); }
          const signer = getActiveWalletRuntime();
          if (!signer || signer.connection.provider !== record.proposal.wallet.provider || signer.connection.chainId !== record.proposal.wallet.chainId || signer.connection.connectedAt !== record.proposal.wallet.connectedAt || signer.connection.address.toLowerCase() !== record.proposal.wallet.address.toLowerCase() || (pending.challengeId ? !signer.approveChallenge : !signer.sendCalls)) {
            await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, cancelled: true }); throw new Error("Signer changed. Reconnect and inspect the pending payment; do not retry automatically.");
          }
          if (pending.challengeId) {
            try { await signer.approveChallenge!(pending.challengeId); }
            catch { await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, cancelled: true }); throw new Error("PIN approval did not complete. Inspect the Circle challenge and existing payment before retrying."); }
            job = await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, challengeApproved: true });
            continue;
          }
          let hash: string;
          // Browser wallets sign at the server-bound gas ceiling; smart accounts and the dev signer use the fee quote.
          const injected = signer.connection.provider === "INJECTED_METAMASK" || signer.connection.provider === "INJECTED_RABBY";
          try { hash = await signer.sendCalls!(pending.calls.map((call) => ({ ...call, to: call.to as `0x${string}`, data: call.data as `0x${string}` })), pending.gasBudgetWei, async (userOperationHash) => { await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, userOperationHash }); }, injected && pending.gasCeiling ? undefined : record.proposal.feeQuote ?? undefined, injected ? pending.gasCeiling : undefined); }
          catch (caught) {
            // A rejection or a failed check before the wallet API sent nothing; anything else may have reached the chain.
            const denied = typeof caught === "object" && caught !== null && "code" in caught && caught.code === 4001;
            const preflight = caught instanceof WalletPreflightError;
            await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, cancelled: true, uncertain: !denied && !preflight });
            if (preflight) throw new Error(`Wallet check (${caught.code}): ${caught.message}`);
            throw new Error(denied ? "The payment was rejected in the wallet. Nothing was sent." : "Signing did not return a verified hash. The payment is held for review; use Recheck before trying again.");
          }
          job = await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, txHash: hash });
        } else {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          job = await request({ action: "STATUS", proposalId: record.id });
        }
      }
      if (job.record.state !== "CONFIRMED") throw new Error("Payment outcome needs review. Do not resubmit automatically.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Payment requires review."); }
    finally { try { await refreshPaymentLedger(); } catch { setError((current) => current || "Payment ledger refresh failed. Recheck the existing payment before continuing."); } setBusy(false); }
  };
  const meta = record ? stateMeta(record.state) : null;
  const secondary = "inline-flex min-h-11 items-center justify-center rounded-[2px] border border-white/25 px-3 text-xs font-medium text-[#f4f1e8] transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40";
  return <Dialog.Root open={open} onOpenChange={(value) => { if (busy && !value) return; setOpen(value); if (!value) { setRecord(null); setError(""); } }}>
    <Dialog.Trigger asChild><button disabled={!workspace.walletConnection || !obligation.recipientAddress || !["UPCOMING", "OVERDUE"].includes(obligation.status)} aria-label={`Review payment for ${obligation.title}`} className="inline-flex min-h-11 items-center gap-2 rounded-[2px] border border-white/25 px-3 text-xs font-medium transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"><Send aria-hidden="true" className="size-3.5" />Review payment</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] p-5 focus:outline-none">
      <div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="grid size-10 shrink-0 place-items-center border border-white/[0.14]"><Send className="size-4" /></span><Dialog.Title className="text-xl font-semibold">Pay obligation in full</Dialog.Title></div><Dialog.Close disabled={busy} aria-label="Close payment dialog" className="grid size-11 shrink-0 place-items-center border border-white/20"><X aria-hidden="true" className="size-4" /></Dialog.Close></div>
      <div className="mt-3 flex items-center gap-1"><Dialog.Description className="text-sm text-white/70">Arc Testnet only. Your wallet approves the payment.</Dialog.Description><InfoTip label="About this payment">Review the server policy, separately confirm, then approve in your wallet. No batch payroll, bridge or automatic withdrawal.</InfoTip></div>
      <div className="mt-5 border border-white/[0.14] p-4">
        <p className="font-semibold [overflow-wrap:anywhere]">{obligation.title}</p>
        <p className="mono mt-1 text-2xl tabular-nums">{formatMoney(obligation.amount)}</p>
        <p className="mt-2 flex items-start gap-2 break-all text-xs text-white/70"><Wallet aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>Recipient: {obligation.recipientAddress}</span></p>
        <p className="mt-1 text-xs text-white/50">Due {formatDate(obligation.dueAt)}</p>
      </div>
      <div className="mt-5"><PaymentSteps state={record?.state ?? null} /></div>
      {!record && <button disabled={busy} onClick={review} className={clsx(buttonClass.primary, "mt-5 w-full")}>Review fresh payment proposal</button>}
      {record && meta && <div className="mt-5 space-y-4">
        <p role="status" className="border border-white/20 p-3"><StatusChip icon={meta.icon} label={record.state.replaceAll("_", " ")} color={meta.color} className="text-sm" /></p>
        <dl className="grid grid-cols-2 gap-px border border-white/[0.14] bg-white/[0.14] text-sm"><div className="bg-[#101319] p-3"><dt className="flex items-center gap-1.5 text-xs text-white/55"><Fuel aria-hidden="true" className="size-3.5" />Fee reserve</dt><dd className="mono mt-1.5 tabular-nums">{formatMoney(record.proposal.feeReserve, { fractionDigits: 6 })}</dd></div><div className="bg-[#101319] p-3"><dt className="flex items-center gap-1.5 text-xs text-white/55"><Wallet aria-hidden="true" className="size-3.5" />Liquid after payment</dt><dd className="mono mt-1.5 tabular-nums">{formatMoney(record.proposal.balanceAfter, { fractionDigits: 6 })}</dd></div></dl>
        <p className="flex items-start gap-2 text-sm"><StatusChip icon={record.proposal.policy.status === "PASS" ? ShieldCheck : AlertTriangle} label={record.proposal.policy.status} color={record.proposal.policy.status === "PASS" ? moneyColor.safe : moneyColor.danger} className="shrink-0" /><span className="text-white/80">{record.proposal.policy.reason}</span></p>
        <p className="flex items-start gap-2 text-xs text-white/70"><Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{record.proposal.executionReason}</span></p>
        <p className="flex items-center gap-2 text-xs text-white/60"><Timer aria-hidden="true" className="size-3.5" />Expires {new Date(record.proposal.expiresAt).toLocaleTimeString()}</p>
        {record.state === "REVIEW_REQUIRED" && <button disabled={busy || !record.proposal.executionEnabled || record.proposal.policy.status !== "PASS"} onClick={confirm} className={clsx(buttonClass.primary, "w-full")}>Confirm full testnet payment</button>}
        {record.txHash && <a className="flex items-start gap-2 break-all text-xs underline" href={`https://testnet.arcscan.app/tx/${record.txHash}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>Inspect transaction: {record.txHash}</span></a>}
        {["SUBMITTED", "UNKNOWN", "AWAITING_SIGNATURE"].includes(record.state) && !busy && <div role="group" aria-label="Resolve payment outcome" className="space-y-3 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs text-[#ffd27f]">
          <p>{record.state === "UNKNOWN" ? "Outcome unknown. The bill and this wallet stay locked until it is resolved — never send the payment again by hand." : "Waiting for the transaction. You can recheck it here."}</p>
          <button onClick={() => void resolve({ action: "RECHECK", proposalId: record.id })} className={secondary}>Recheck existing receipt (no new transaction)</button>
          <label className="block">Transaction hash from your wallet<input value={candidate} onChange={(event) => setCandidate(event.target.value.trim())} placeholder="0x…" className="mono mt-1 w-full border border-white/20 bg-[#0b0b0d] p-2 text-[#f4f1e8]" /></label>
          <button disabled={!/^0x[\da-fA-F]{64}$/.test(candidate)} onClick={() => void resolve({ action: "RECHECK", proposalId: record.id, txHash: candidate })} className={secondary}>Verify this transaction</button>
          {/* The server releases only after expiry and with an unchanged wallet nonce. */}
          {!record.txHash && !record.userOperationHash && <button onClick={() => void resolve({ action: "RECOVER", proposalId: record.id, acknowledgeNoPendingTransaction: true })} className={clsx(secondary, "block text-left")}>I rejected or closed the wallet request — release this payment</button>}
        </div>}
        {record.state === "CONFIRMED" && <p className="flex items-start gap-2 text-sm"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" style={{ color: moneyColor.safe }} />The server verified the canonical USDC receipt. The authoritative PAID record is loaded without a page reload.</p>}
      </div>}
      {error && <p role="alert" className="mt-4 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]">{error}</p>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
