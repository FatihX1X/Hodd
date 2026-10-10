"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { gatewayChainByKey } from "@/lib/gateway/chains";
import { gatewayPaymentResponseSchema, type GatewayPaymentResponse } from "@/lib/gateway/payment-models";
import { formatMoney } from "@/lib/treasury/format";
import type { Obligation } from "@/lib/treasury/models";
import { getActiveWalletRuntime, isSignerFor } from "@/lib/wallet/runtime";
import { buttonClass, inputClass, labelClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { useUnifiedUsdc } from "./use-unified-usdc";

type Ready = Extract<GatewayPaymentResponse, { status: "READY" }>;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Pays an obligation in full from the user's Circle Gateway balance on another
 * chain. Gateway mints the exact amount straight to the recipient on Arc; the
 * bill turns PAID only after the server verifies that Arc mint.
 */
export function GatewayPaymentDialog({ obligation }: { obligation: Obligation }) {
  const { workspace, workspaceScope, syncForEarn, refreshPaymentLedger } = useTreasuryWorkspace();
  const connection = workspace.walletConnection;
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [job, setJob] = useState<Ready | null>(null); const [sourceKey, setSourceKey] = useState("");
  const { state, reload } = useUnifiedUsdc(open ? connection?.address : null);
  const view = state.status === "READY" ? state.view : null;
  const amount = BigInt(obligation.amount.minorUnits);
  const sources = view?.chains.filter((item) => item.gateway && BigInt(item.gateway.minorUnits) > amount) ?? [];
  const active = ["UPCOMING", "OVERDUE"].includes(obligation.status);

  const request = async (body: object) => {
    const response = await fetch("/api/gateway", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: workspaceScope, ...body }) });
    const result = gatewayPaymentResponseSchema.parse(await response.json());
    if (result.status === "ERROR") throw new Error(result.message);
    setJob(result); return result;
  };
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(""); try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The payment needs review. Do not resend it by hand."); } finally { try { await refreshPaymentLedger(); } catch { /* the dialog still shows the server record */ } setBusy(false); } };

  const review = () => run(async () => { await syncForEarn(); await request({ action: "PAY_REVIEW", obligationId: obligation.id, sourceKey }); });
  const confirm = () => run(async () => {
    if (!job) return;
    const signer = getActiveWalletRuntime();
    // Check before claiming so a missing signer never locks the bill.
    if (!isSignerFor(signer, job.record.proposal.wallet) || !signer.signGatewayIntent) throw new Error("Reconnect MetaMask or Rabby in the wallet panel. The payment was not claimed.");
    let next = await request({ action: "PAY_CONFIRM", proposalId: job.record.id, confirmed: true });
    const sign = next.gateway.sign;
    if (!sign) throw new Error("No signature request was opened. Check the payment status before trying again.");
    let signature: `0x${string}` | null = null;
    try { signature = await signer.signGatewayIntent({ typedData: sign.typedData, intent: sign.intent }); }
    catch (caught) {
      // An unsent EIP-712 signature cannot move funds: release the claim.
      await request({ action: "PAY_SIGN", proposalId: job.record.id, requestId: sign.id, rejected: true });
      const denied = typeof caught === "object" && caught !== null && "code" in caught && caught.code === 4001;
      throw new Error(denied ? "The signature was rejected in the wallet. Nothing was sent and the bill is unlocked." : "The wallet did not sign. Nothing was sent and the bill is unlocked.");
    }
    next = await request({ action: "PAY_SIGN", proposalId: job.record.id, requestId: sign.id, signature });
    const deadline = Date.now() + 6 * 60_000;
    while (["SUBMITTED", "AWAITING_SIGNATURE"].includes(next.record.state) && Date.now() < deadline) { await wait(2_500); next = await request({ action: "PAY_STATUS", proposalId: job.record.id }); }
    if (next.record.state !== "CONFIRMED") throw new Error("The mint is not verified yet. Use Check status; never pay the bill again by hand.");
  });
  const recheck = () => run(async () => { if (job) await request({ action: "PAY_STATUS", proposalId: job.record.id }); });
  const release = () => run(async () => { if (job) await request({ action: "PAY_RECOVER", proposalId: job.record.id }); });

  const gateway = job?.record.proposal.gateway;
  const source = gateway ? gatewayChainByKey(gateway.sourceKey) : null;
  return <Dialog.Root open={open} onOpenChange={(value) => { if (busy && !value) return; setOpen(value); if (!value) { setJob(null); setError(""); } }}>
    <Dialog.Trigger asChild><button disabled={!connection || connection.accountType !== "EOA" || !obligation.recipientAddress || !active} aria-label={`Pay ${obligation.title} from another chain`} title={connection && connection.accountType !== "EOA" ? "Needs a MetaMask or Rabby wallet" : undefined} className="min-h-10 border border-[#7fa6ff]/50 px-3 text-xs text-[#b9ccff] disabled:opacity-35">Pay from another chain</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] p-5 text-[#f4f1e8] focus:outline-none">
      <div className="flex items-center justify-between gap-4"><Dialog.Title className="text-xl font-semibold">Pay from another chain</Dialog.Title><Dialog.Close disabled={busy} aria-label="Close" className="grid size-10 place-items-center border border-white/20"><X className="size-4" /></Dialog.Close></div>
      <Dialog.Description className="mt-3 text-sm leading-6 text-white/65">Uses your Circle Gateway balance on any supported testnet. Circle mints the exact amount straight to the recipient on Arc. Your Arc wallet and Morpho position are not touched.</Dialog.Description>
      <p className="mt-5 font-semibold">{obligation.title} · {formatMoney(obligation.amount)}</p><p className="mt-1 break-all text-xs text-white/65">Arc recipient: {obligation.recipientAddress}</p>

      {!job && <div className="mt-5">
        <label className={`${labelClass} block`}>Pay from Gateway balance on
          <select value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} disabled={busy || !view} className={inputClass}>
            <option value="">{view ? sources.length ? "Choose a chain" : "No Gateway balance covers this bill" : "Reading Gateway balances…"}</option>
            {sources.map((item) => <option key={item.key} value={item.key}>{item.label} · {formatMoney(item.gateway!, { fractionDigits: 6 })}</option>)}
          </select>
        </label>
        {view && !sources.length && <p className="mt-2 text-xs leading-5 text-white/55">Add USDC to Gateway from Overview → USDC on every chain → Bring USDC to Arc (step 1), then come back.</p>}
        <div className="mt-4 flex gap-2"><button disabled={busy || !sourceKey} onClick={() => void review()} className={`${buttonClass.primary} flex-1`}>Review payment</button><button disabled={busy} onClick={() => void reload()} className={buttonClass.ghost}>Refresh</button></div>
      </div>}

      {job && <div className="mt-5 space-y-4 text-sm">
        <p role="status" className="border border-white/20 p-3">{job.record.state.replaceAll("_", " ")}</p>
        {gateway && <dl className="grid grid-cols-2 gap-4"><div><dt className={labelClass}>From</dt><dd className="mt-1">{source?.label ?? gateway.sourceKey} Gateway</dd></div><div><dt className={labelClass}>Max fees</dt><dd className="mono mt-1">{formatMoney({ currency: "USDC", decimals: 6, minorUnits: gateway.feeMinor }, { fractionDigits: 6 })}</dd></div><div><dt className={labelClass}>Recipient gets</dt><dd className="mono mt-1">{formatMoney(job.record.proposal.amount, { fractionDigits: 6 })}</dd></div><div><dt className={labelClass}>Gateway after</dt><dd className="mono mt-1">{formatMoney(job.record.proposal.balanceAfter, { fractionDigits: 6 })}</dd></div></dl>}
        <p>{job.record.proposal.policy.status}: {job.record.proposal.policy.reason}</p>
        <p className="text-xs text-white/65">{job.record.proposal.executionReason}</p>
        {job.record.state === "REVIEW_REQUIRED" && <button disabled={busy || !job.record.proposal.executionEnabled || job.record.proposal.policy.status !== "PASS"} onClick={() => void confirm()} className={`${buttonClass.primary} w-full`}>Confirm and sign (free)</button>}
        {job.gateway.transferId && <p className="mono break-all text-[10px] text-white/50">Gateway transfer {job.gateway.transferId}</p>}
        {job.record.txHash && <a className="mono block break-all text-[10px] text-[#8fb0ff] underline" href={`https://testnet.arcscan.app/tx/${job.record.txHash}`} target="_blank" rel="noreferrer">Arc mint to recipient: {job.record.txHash}</a>}
        {["SUBMITTED", "UNKNOWN", "AWAITING_SIGNATURE"].includes(job.record.state) && !busy && <div role="group" aria-label="Resolve payment" className="space-y-2 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs text-[#ffd27f]">
          <p>{job.record.state === "UNKNOWN" ? "Outcome unknown. The bill stays locked until Hodd verifies the mint or proves it cannot happen. Never pay it again by hand." : "Waiting for Circle to mint on Arc."}</p>
          <button onClick={() => void recheck()} className="border border-white/20 p-2 text-[#f4f1e8]">Check status (sends nothing)</button>
          <button onClick={() => void release()} className="ml-2 border border-white/20 p-2 text-[#f4f1e8]">Release if it can no longer be minted</button>
        </div>}
        {job.record.state === "CONFIRMED" && <p className="text-[#7fe3a8]">Verified on Arc: Circle minted the exact amount to the recipient. The bill is PAID.</p>}
      </div>}
      {error && <p role="alert" className="mt-4 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]">{error}</p>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
