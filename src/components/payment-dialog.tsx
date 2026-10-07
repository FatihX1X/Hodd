"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { Obligation } from "@/lib/treasury/models";
import { formatMoney } from "@/lib/treasury/format";
import { paymentResponseSchema, type PaymentRecord } from "@/lib/payments/models";
import { getActiveWalletRuntime, isSignerFor } from "@/lib/wallet/runtime";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

export function PaymentDialog({ obligation }: { obligation: Obligation }) {
  const { workspace, workspaceScope, syncForEarn, refreshPaymentLedger } = useTreasuryWorkspace();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<PaymentRecord | null>(null); const [error, setError] = useState("");
  const request = async (body: object) => {
    const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: workspaceScope, ...body }) });
    const result = paymentResponseSchema.parse(await response.json());
    if (result.status === "ERROR") throw new Error(result.message);
    setRecord(result.record); return result;
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
          try { hash = await signer.sendCalls!(pending.calls.map((call) => ({ ...call, to: call.to as `0x${string}`, data: call.data as `0x${string}` })), pending.gasBudgetWei, async (userOperationHash) => { await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, userOperationHash }); }, record.proposal.feeQuote ?? undefined); }
          catch { await request({ action: "REPLY", proposalId: record.id, requestId: pending.id, cancelled: true }); throw new Error("Signing did not return a verified hash. The payment is held for review."); }
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
  return <Dialog.Root open={open} onOpenChange={(value) => { if (busy && !value) return; setOpen(value); if (!value) { setRecord(null); setError(""); } }}>
    <Dialog.Trigger asChild><button disabled={!workspace.walletConnection || !obligation.recipientAddress || !["UPCOMING", "OVERDUE"].includes(obligation.status)} aria-label={`Review payment for ${obligation.title}`} className="min-h-10 border border-black/20 px-3 text-xs disabled:opacity-35">Review payment</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#fffdf7] p-5 focus:outline-none">
      <div className="flex items-center justify-between gap-4"><Dialog.Title className="text-xl font-semibold">Pay obligation in full</Dialog.Title><Dialog.Close disabled={busy} aria-label="Close payment dialog" className="grid size-10 place-items-center border border-black/20"><X className="size-4" /></Dialog.Close></div>
      <Dialog.Description className="mt-4 text-sm text-black/60">Arc Testnet only. Review the server policy, separately confirm, then approve in your wallet. No batch payroll, bridge or automatic withdrawal.</Dialog.Description>
      <p className="mt-5 font-semibold">{obligation.title} · {formatMoney(obligation.amount)}</p><p className="mt-2 break-all text-xs">Recipient: {obligation.recipientAddress}</p>
      {!record && <button disabled={busy} onClick={review} className="mt-5 w-full bg-[#0b0d0c] p-4 text-sm text-white disabled:opacity-40">Review fresh payment proposal</button>}
      {record && <div className="mt-5 space-y-4"><p role="status" className="border border-black/20 p-3 text-sm">{record.state.replaceAll("_", " ")}</p><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt>Fee reserve</dt><dd>{formatMoney(record.proposal.feeReserve, { fractionDigits: 6 })}</dd></div><div><dt>Liquid after payment</dt><dd>{formatMoney(record.proposal.balanceAfter, { fractionDigits: 6 })}</dd></div></dl><p className="text-sm">{record.proposal.policy.status}: {record.proposal.policy.reason}</p><p className="text-xs text-black/60">{record.proposal.executionReason}</p><p className="text-xs">Expires {new Date(record.proposal.expiresAt).toLocaleTimeString()}</p>
        {record.state === "REVIEW_REQUIRED" && <button disabled={busy || !record.proposal.executionEnabled || record.proposal.policy.status !== "PASS"} onClick={confirm} className="w-full bg-[#0b0d0c] p-4 text-sm text-white disabled:opacity-35">Confirm full testnet payment</button>}
        {record.txHash && <a className="block break-all text-xs underline" href={`https://testnet.arcscan.app/tx/${record.txHash}`} target="_blank" rel="noreferrer">Inspect transaction: {record.txHash}</a>}
        {["SUBMITTED", "UNKNOWN"].includes(record.state) && <button disabled={busy} onClick={async () => { setBusy(true); try { await request({ action: "RECHECK", proposalId: record.id }); await refreshPaymentLedger(); } catch { setError("Receipt or workspace remains unverified. Do not resubmit."); } finally { setBusy(false); } }} className="border border-black/20 p-3 text-sm">Recheck existing receipt (no new transaction)</button>}
        {record.state === "CONFIRMED" && <p className="text-sm">The server verified the canonical USDC receipt. The authoritative PAID record is loaded without a page reload.</p>}
      </div>}
      {error && <p role="alert" className="mt-4 border border-[#9a433c]/20 bg-[#f5dedb] p-3 text-xs text-[#7b332d]">{error}</p>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
