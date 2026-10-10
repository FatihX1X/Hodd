"use client";
import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { paymentEventSchema, paymentRecordSchema, paymentResponseSchema, type PaymentEvent, type PaymentRecord } from "@/lib/payments/models";
import { formatMoney } from "@/lib/treasury/format";
import { Pagination, SectionCard, SectionHeading } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

const PAGE_SIZE = 15;
/** Paging happens at the foot of a long list: bring the list's top back into view if it has scrolled away. */
const showTop = (element: HTMLElement | null) => { if (element && element.getBoundingClientRect().top < 0) element.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };

export function PaymentHistory({ index = "03.4" }: { index?: string }) {
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
  return <SectionCard className="mt-6"><SectionHeading index={index} title="Server payment ledger" description="Owner-scoped records · only confirmed canonical USDC receipts establish payment" /><div ref={recordsRef} className="scroll-mt-20 space-y-3 p-5">
    {!records.length && <p className="text-xs text-white/65">No verified payment history loaded. Sign in to read your payment ledger.</p>}
    {records.slice((currentRecordPage - 1) * PAGE_SIZE, currentRecordPage * PAGE_SIZE).map((record) => <article key={record.id} className="space-y-2 border-b border-white/10 pb-3 text-xs"><p className="font-semibold">{record.state.replaceAll("_", " ")} · {formatMoney(record.proposal.amount)} · {record.proposal.recipientLabel ?? "Recipient"}</p><p className="break-all">Proposal {record.id}</p>{record.userOperationHash && <p className="break-all">UserOperation hash · not a transaction receipt: {record.userOperationHash}</p>}{record.txHash && <a className="block break-all underline" href={`https://testnet.arcscan.app/tx/${record.txHash}`} target="_blank" rel="noreferrer">{record.state === "CONFIRMED" ? "Verified onchain receipt" : record.state === "FAILED" ? "Verified reverted execution · obligation remains unpaid" : "Submitted hash · not verified"}: {record.txHash}</a>}{["SUBMITTED", "UNKNOWN"].includes(record.state) && <button onClick={() => void recheck(record)} className="min-h-10 border border-white/20 px-3">Recheck existing payment (no retry)</button>}</article>)}
    <Pagination page={currentRecordPage} pageCount={recordPages} onChange={(next) => { setRecordPage(next); showTop(recordsRef.current); }} label="Server payment ledger pages" total={records.length} pageSize={PAGE_SIZE} />
    {records.filter((record) => record.state === "UNKNOWN" && !record.txHash).map((record) => <label key={`recover-${record.id}`} className="block text-xs">Existing transaction hash for proposal {record.id}<input aria-label={`Existing transaction hash ${record.id}`} value={candidateHashes[record.id] ?? ""} onChange={(event) => setCandidateHashes((current) => ({ ...current, [record.id]: event.target.value }))} placeholder="0x… (from your wallet or explorer)" className="mt-2 w-full border border-white/20 p-3" /><span className="mt-2 block">Recheck above only verifies this existing hash. It cannot submit another transaction.</span></label>)}
    {events.length > 0 && <><ol ref={eventsRef} aria-label="Server payment audit timeline" className="scroll-mt-20 space-y-2">{events.slice((currentEventPage - 1) * PAGE_SIZE, currentEventPage * PAGE_SIZE).map((event) => <li key={event.id} className="break-all border border-white/[0.14] p-3 text-xs">{event.kind.replaceAll("_", " ")} · {event.stage.replaceAll("_", " ")} · {new Date(event.occurred_at).toLocaleString()}<span className="mt-1 block">Proposal {event.proposal_id}</span></li>)}</ol>
    <Pagination page={currentEventPage} pageCount={eventPages} onChange={(next) => { setEventPage(next); showTop(eventsRef.current); }} label="Server payment audit timeline pages" total={events.length} pageSize={PAGE_SIZE} /></>}
    {error && <p role="status" className="text-xs text-[#ff9a92]">{error}</p>}
  </div></SectionCard>;
}
