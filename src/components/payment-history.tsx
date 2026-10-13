"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, CheckCircle2, ExternalLink, FileText, Hourglass, ReceiptText, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { paymentEventSchema, paymentRecordSchema, paymentResponseSchema, type PaymentEvent, type PaymentRecord } from "@/lib/payments/models";
import { formatMoney } from "@/lib/treasury/format";
import { StatusChip } from "./ledger-visuals";
import { Pagination, SectionCard, SectionHeading, inputClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { InfoTip, moneyColor } from "./visuals";

const PAGE_SIZE = 15;
const muted = "rgba(244,241,232,0.55)";
const recordMeta = (state: PaymentRecord["state"]): { icon: LucideIcon; color: string } => state === "CONFIRMED" ? { icon: CheckCircle2, color: moneyColor.safe } : state === "FAILED" ? { icon: XCircle, color: moneyColor.danger } : state === "CANCELLED" || state === "EXPIRED" ? { icon: AlertTriangle, color: muted } : state === "REVIEW_REQUIRED" ? { icon: ShieldCheck, color: moneyColor.deployable } : { icon: Hourglass, color: moneyColor.protected };
/** Paging happens at the foot of a long list: bring the list's top back into view if it has scrolled away. */
const showTop = (element: HTMLElement | null) => { if (element && element.getBoundingClientRect().top < 0) element.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };

export function PaymentHistory() {
  const { workspaceScope, workspace, paymentLedgerRevision, refreshPaymentLedger } = useTreasuryWorkspace();
  const [records, setRecords] = useState<PaymentRecord[]>([]); const [error, setError] = useState(""); const [refresh, setRefresh] = useState(0);
  const [candidateHashes, setCandidateHashes] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [recordPage, setRecordPage] = useState(1); const [eventPage, setEventPage] = useState(1); const [pageScope, setPageScope] = useState(workspaceScope);
  // A different scope is a different ledger: start both lists on their first page.
  if (pageScope !== workspaceScope) { setPageScope(workspaceScope); setRecordPage(1); setEventPage(1); }
  const recordPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE)); const eventPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const currentRecordPage = Math.min(recordPage, recordPages); const currentEventPage = Math.min(eventPage, eventPages);
  const recordsRef = useRef<HTMLDivElement>(null); const eventsRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const client = createSupabaseBrowserClient();
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
        setRecords([]); setEvents([]); setError(""); setCandidateHashes({}); setRecordPage(1); setEventPage(1); setRefresh((value) => value + 1);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let active = true; const client = createSupabaseBrowserClient();
    if (!client) return;
    void (async () => {
      const { data: auth } = await client.auth.getUser();
      if (!auth.user) { if (active) { setRecords([]); setEvents([]); } return; }
      const { data, error: queryError } = await client.from("payment_proposals").select("id,state,proposal,tx_hash,user_operation_hash,receipt").eq("user_id", auth.user.id).eq("scope", workspaceScope).order("updated_at", { ascending: false }).limit(50);
      const audit = await client.from("payment_events").select("id,proposal_id,stage,kind,tx_hash,occurred_at").eq("user_id", auth.user.id).eq("scope", workspaceScope).order("occurred_at", { ascending: false }).limit(100);
      const { data: current } = await client.auth.getUser();
      if (!active || current.user?.id !== auth.user.id) return;
      if (queryError || audit.error) { setError("Payment ledger unavailable. Local activity is not proof of payment."); setRecords([]); setEvents([]); return; }
      try { setRecords((data ?? []).map((row) => paymentRecordSchema.parse({ id: row.id, state: row.state, proposal: row.proposal, txHash: row.tx_hash, userOperationHash: row.user_operation_hash, receipt: row.receipt }))); setError(""); }
      catch { setRecords([]); setError("Payment ledger failed validation."); }
      try { setEvents((audit.data ?? []).map((event) => paymentEventSchema.parse(event))); }
      catch { setEvents([]); setError("Payment audit failed validation."); }
    })().catch(() => { if (active) { setRecords([]); setEvents([]); setError("Payment ledger unavailable."); } });
    return () => { active = false; };
  }, [workspaceScope, workspace.updatedAt, paymentLedgerRevision, refresh]);
  const recheck = async (record: PaymentRecord) => {
    setError("");
    try {
      const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: workspaceScope, action: "RECHECK", proposalId: record.id, txHash: record.txHash ? undefined : candidateHashes[record.id] || undefined }) });
      const result = paymentResponseSchema.parse(await response.json());
      if (result.status === "ERROR") throw new Error(result.message);
      await refreshPaymentLedger();
      setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Receipt unverified; do not retry payment."); }
  };
  return <SectionCard className="mt-6"><SectionHeading icon={<ReceiptText className="size-4" />} title="Server payment ledger" action={<InfoTip label="About the payment ledger" className="-my-1">Owner-scoped records. Only confirmed canonical USDC receipts establish payment.</InfoTip>} /><div ref={recordsRef} className="scroll-mt-20 space-y-3 p-5">
    {!records.length && <p className="flex items-start gap-2 text-xs text-white/65"><FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />No verified payment history loaded. Sign in to read your payment ledger.</p>}
    {records.slice((currentRecordPage - 1) * PAGE_SIZE, currentRecordPage * PAGE_SIZE).map((record) => {
      const meta = recordMeta(record.state); const Icon = meta.icon;
      return <article key={record.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-b border-white/10 pb-4 text-xs">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-full border" style={{ borderColor: meta.color, color: meta.color }}><Icon className="size-4" /></span>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><p className="text-sm font-semibold"><span>{record.proposal.recipientLabel ?? "Recipient"}</span></p><p className="mono text-sm tabular-nums">{formatMoney(record.proposal.amount)}</p></div>
          <StatusChip icon={Icon} label={record.state.replaceAll("_", " ")} color={meta.color} />
          <p className="mono break-all text-[11px] text-white/45">Proposal {record.id}</p>
          {record.userOperationHash && <p className="break-all"><span className="inline-flex items-center gap-1 text-white/55">UserOperation hash<InfoTip label="About the UserOperation hash" className="-my-1">Not a transaction receipt.</InfoTip></span> <span className="mono">{record.userOperationHash}</span></p>}
          {record.txHash && <a className="flex items-start gap-2 break-all underline" href={`https://testnet.arcscan.app/tx/${record.txHash}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{record.state === "CONFIRMED" ? "Verified onchain receipt" : record.state === "FAILED" ? "Verified reverted execution, obligation remains unpaid" : "Submitted hash, not verified"}: {record.txHash}</span></a>}
          {["SUBMITTED", "UNKNOWN"].includes(record.state) && <button onClick={() => void recheck(record)} className="inline-flex min-h-11 items-center gap-2 border border-white/20 px-3 hover:bg-white/[0.06]"><RefreshCw aria-hidden="true" className="size-3.5" />Recheck existing payment (no retry)</button>}
        </div>
      </article>;
    })}
    <Pagination page={currentRecordPage} pageCount={recordPages} onChange={(next) => { setRecordPage(next); showTop(recordsRef.current); }} label="Server payment ledger pages" total={records.length} pageSize={PAGE_SIZE} />
    {records.filter((record) => record.state === "UNKNOWN" && !record.txHash).map((record) => <div key={`recover-${record.id}`} className="text-xs"><label className="block"><span className="flex items-center gap-1">Existing transaction hash for proposal {record.id}</span><input aria-label={`Existing transaction hash ${record.id}`} value={candidateHashes[record.id] ?? ""} onChange={(event) => setCandidateHashes((current) => ({ ...current, [record.id]: event.target.value }))} placeholder="0x… (from your wallet or explorer)" className={`${inputClass} mono`} /></label><p className="mt-2 flex items-center gap-1 text-white/55">Recheck only verifies this existing hash.<InfoTip label="About rechecking" className="-my-1">Recheck above only verifies this existing hash. It cannot submit another transaction.</InfoTip></p></div>)}
    {events.length > 0 && <><ol ref={eventsRef} aria-label="Server payment audit timeline" className="relative scroll-mt-20 pt-2 before:absolute before:bottom-3 before:left-[9px] before:top-4 before:w-px before:bg-white/15">{events.slice((currentEventPage - 1) * PAGE_SIZE, currentEventPage * PAGE_SIZE).map((event) => {
      const onchain = event.kind === "ONCHAIN_RECEIPT"; const Icon = onchain ? BadgeCheck : FileText;
      return <li key={event.id} className="relative break-all py-2 pl-9 text-xs"><span aria-hidden="true" className="absolute left-0 top-2 grid size-5 place-items-center rounded-full bg-[#101319]" style={{ color: onchain ? moneyColor.safe : muted }}><Icon className="size-4" /></span><span className="font-medium">{onchain ? "Onchain receipt" : "Local audit"}</span> <span className="lowercase first-letter:uppercase" style={{ color: muted }}>{event.stage.replaceAll("_", " ")}</span> <span className="mono whitespace-nowrap text-white/45">{new Date(event.occurred_at).toLocaleString()}</span><span className="mono mt-1 block text-[11px] text-white/45">Proposal {event.proposal_id}</span></li>;
    })}</ol>
    <Pagination page={currentEventPage} pageCount={eventPages} onChange={(next) => { setEventPage(next); showTop(eventsRef.current); }} label="Server payment audit timeline pages" total={events.length} pageSize={PAGE_SIZE} /></>}
    {error && <p role="status" className="text-xs text-[#ff9a92]">{error}</p>}
  </div></SectionCard>;
}
