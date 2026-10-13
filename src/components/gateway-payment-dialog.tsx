"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, CheckCircle2, ExternalLink, Hourglass, Info, RefreshCw, ShieldCheck, Waypoints, Wallet, X } from "lucide-react";
import { gatewayChainByKey } from "@/lib/gateway/chains";
import { gatewayPaymentResponseSchema, type GatewayPaymentResponse } from "@/lib/gateway/payment-models";
import { formatMoney } from "@/lib/treasury/format";
import type { Obligation } from "@/lib/treasury/models";
import { getActiveWalletRuntime, isSignerFor } from "@/lib/wallet/runtime";
import { Field, PaymentSteps, StatusChip } from "./ledger-visuals";
import { buttonClass, inputClass, labelClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { useUnifiedUsdc } from "./use-unified-usdc";
import { InfoTip, moneyColor } from "./visuals";

type Ready = Extract<GatewayPaymentResponse, { status: "READY" }>;
const stateMeta = (state: Ready["record"]["state"]) => state === "CONFIRMED" ? { icon: CheckCircle2, color: moneyColor.safe } : state === "FAILED" || state === "CANCELLED" || state === "EXPIRED" ? { icon: AlertTriangle, color: moneyColor.danger } : state === "REVIEW_REQUIRED" ? { icon: ShieldCheck, color: moneyColor.deployable } : { icon: Hourglass, color: moneyColor.protected };
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
  const meta = job ? stateMeta(job.record.state) : null;
  const secondary = "inline-flex min-h-11 items-center justify-center rounded-[2px] border border-white/25 px-3 text-xs font-medium text-[#f4f1e8] transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40";
  return <Dialog.Root open={open} onOpenChange={(value) => { if (busy && !value) return; setOpen(value); if (!value) { setJob(null); setError(""); } }}>
    <Dialog.Trigger asChild><button disabled={!connection || connection.accountType !== "EOA" || !obligation.recipientAddress || !active} aria-label={`Pay ${obligation.title} from another chain`} title={connection && connection.accountType !== "EOA" ? "Needs a MetaMask or Rabby wallet" : undefined} className="inline-flex min-h-11 items-center gap-2 rounded-[2px] border border-[#7fa6ff]/50 px-3 text-xs font-medium text-[#b9ccff] transition-colors hover:bg-[#7fa6ff]/10 disabled:cursor-not-allowed disabled:opacity-35"><Waypoints aria-hidden="true" className="size-3.5" />Pay from another chain</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[#101319] p-5 text-[#f4f1e8] focus:outline-none">
      <div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="grid size-10 shrink-0 place-items-center border border-[#7fa6ff]/40 text-[#b9ccff]"><Waypoints className="size-4" /></span><Dialog.Title className="text-xl font-semibold">Pay from another chain</Dialog.Title></div><Dialog.Close disabled={busy} aria-label="Close" className="grid size-11 shrink-0 place-items-center border border-white/20"><X aria-hidden="true" className="size-4" /></Dialog.Close></div>
      <div className="mt-3 flex items-center gap-1"><Dialog.Description className="text-sm leading-6 text-white/65">Pays from your Circle Gateway balance on a supported testnet.</Dialog.Description><InfoTip label="About paying from another chain">Uses your Circle Gateway balance on any supported testnet. Circle mints the exact amount straight to the recipient on Arc. Your Arc wallet and Morpho position are not touched.</InfoTip></div>
      <div className="mt-5 border border-white/[0.14] p-4">
        <p className="font-semibold [overflow-wrap:anywhere]">{obligation.title}</p>
        <p className="mono mt-1 text-2xl tabular-nums">{formatMoney(obligation.amount)}</p>
        <p className="mt-2 flex items-start gap-2 break-all text-xs text-white/65"><Wallet aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>Arc recipient: {obligation.recipientAddress}</span></p>
      </div>
      <div className="mt-5"><PaymentSteps state={job?.record.state ?? null} labels={["Review", "Confirm", "Sign", "Minted"]} /></div>

      {!job && <div className="mt-5">
        <Field label="Pay from Gateway balance on" labelClassName={labelClass}>{(id) => (
          <select id={id} value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} disabled={busy || !view} className={inputClass}>
            <option value="">{view ? sources.length ? "Choose a chain" : "No Gateway balance covers this bill" : "Reading Gateway balances…"}</option>
            {sources.map((item) => <option key={item.key} value={item.key}>{item.label} ({formatMoney(item.gateway!, { fractionDigits: 6 })})</option>)}
          </select>
        )}</Field>
        {view && !sources.length && <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-white/55"><Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />Add USDC to Gateway first: Overview, USDC on every chain, Bring USDC to Arc. Then come back.</p>}
        <div className="mt-4 flex gap-2"><button disabled={busy || !sourceKey} onClick={() => void review()} className={`${buttonClass.primary} flex-1`}>Review payment</button><button disabled={busy} onClick={() => void reload()} className={buttonClass.ghost}><RefreshCw aria-hidden="true" className="size-3.5" />Refresh</button></div>
      </div>}

      {job && meta && <div className="mt-5 space-y-4 text-sm">
        <p role="status" className="border border-white/20 p-3"><StatusChip icon={meta.icon} label={job.record.state.replaceAll("_", " ")} color={meta.color} className="text-sm" /></p>
        {gateway && <dl className="grid grid-cols-2 gap-px border border-white/[0.14] bg-white/[0.14]"><div className="bg-[#101319] p-3"><dt className={labelClass}>From</dt><dd className="mt-1">{source?.label ?? gateway.sourceKey} Gateway</dd></div><div className="bg-[#101319] p-3"><dt className={labelClass}>Max fees</dt><dd className="mono mt-1 tabular-nums">{formatMoney({ currency: "USDC", decimals: 6, minorUnits: gateway.feeMinor }, { fractionDigits: 6 })}</dd></div><div className="bg-[#101319] p-3"><dt className={labelClass}>Recipient gets</dt><dd className="mono mt-1 tabular-nums">{formatMoney(job.record.proposal.amount, { fractionDigits: 6 })}</dd></div><div className="bg-[#101319] p-3"><dt className={labelClass}>Gateway after</dt><dd className="mono mt-1 tabular-nums">{formatMoney(job.record.proposal.balanceAfter, { fractionDigits: 6 })}</dd></div></dl>}
        <p className="flex items-start gap-2"><StatusChip icon={job.record.proposal.policy.status === "PASS" ? ShieldCheck : AlertTriangle} label={job.record.proposal.policy.status} color={job.record.proposal.policy.status === "PASS" ? moneyColor.safe : moneyColor.danger} className="shrink-0" /><span className="text-white/80">{job.record.proposal.policy.reason}</span></p>
        <p className="flex items-start gap-2 text-xs text-white/65"><Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{job.record.proposal.executionReason}</span></p>
        {job.record.state === "REVIEW_REQUIRED" && <button disabled={busy || !job.record.proposal.executionEnabled || job.record.proposal.policy.status !== "PASS"} onClick={() => void confirm()} className={`${buttonClass.primary} w-full`}>Confirm and sign (free)</button>}
        {job.gateway.transferId && <p className="mono break-all text-[10px] text-white/50">Gateway transfer {job.gateway.transferId}</p>}
        {job.record.txHash && <a className="mono flex items-start gap-2 break-all text-[10px] text-[#8fb0ff] underline" href={`https://testnet.arcscan.app/tx/${job.record.txHash}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" className="mt-0.5 size-3 shrink-0" /><span>Arc mint to recipient: {job.record.txHash}</span></a>}
        {["SUBMITTED", "UNKNOWN", "AWAITING_SIGNATURE"].includes(job.record.state) && !busy && <div role="group" aria-label="Resolve payment" className="space-y-2 border border-[#fab219]/30 bg-[#fab219]/10 p-3 text-xs text-[#ffd27f]">
          <p>{job.record.state === "UNKNOWN" ? "Outcome unknown. The bill stays locked until Hodd verifies the mint or proves it cannot happen. Never pay it again by hand." : "Waiting for Circle to mint on Arc."}</p>
          <div className="flex flex-wrap gap-2"><button onClick={() => void recheck()} className={secondary}>Check status (sends nothing)</button>
          <button onClick={() => void release()} className={secondary}>Release if it can no longer be minted</button></div>
        </div>}
        {job.record.state === "CONFIRMED" && <p className="flex items-start gap-2 text-[#7fe3a8]"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Verified on Arc: Circle minted the exact amount to the recipient. The bill is PAID.</p>}
      </div>}
      {error && <p role="alert" className="mt-4 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92]">{error}</p>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
