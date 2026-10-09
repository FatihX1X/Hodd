"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { getAddress, isAddress } from "viem";
import { PaymentDialog } from "./payment-dialog";
import { PaymentHistory } from "./payment-history";
import { EmptyState } from "./page-states";
import { WeeklyOutflowChart } from "./charts";
import { FilterGroup, Kpi, KpiGrid, MoneyValue, PageBody, SectionCard, SectionHeading, StatusPill, buttonClass, labelClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { assessPayment } from "@/lib/treasury/engine";
import { formatDate } from "@/lib/treasury/format";
import { moneyToInput, parseMoneyInput } from "@/lib/treasury/money";
import type { Obligation, ObligationInput } from "@/lib/treasury/models";
import { canDeleteObligation } from "@/lib/treasury/sample-cleanup";
import { weeklyOutflows } from "@/lib/treasury/views";

type Filter = "ALL" | Obligation["status"];
const filters = ["ALL", "UPCOMING", "DRAFT", "OVERDUE", "PAID"] as const;
const inputClass = "mt-2 w-full border border-white/20 bg-[#0b0b0d] text-[#f4f1e8] px-3 py-2.5 text-sm outline-none focus:border-[#7fa6ff]";
const statusTone = (status: Obligation["status"]) => status === "OVERDUE" ? "danger" as const : status === "PAID" ? "success" as const : status === "DRAFT" ? "neutral" as const : "info" as const;
const priorityTone = (priority: Obligation["priority"]) => priority === "CRITICAL" ? "danger" as const : priority === "HIGH" ? "warning" as const : "neutral" as const;
const sourceLabel = (source: string) => source.replaceAll("_", " ");
const tomorrow = () => { const date = new Date(); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
type FormState = { title: string; category: Obligation["category"]; amount: string; dueDate: string; recipient: string; recipientAddress: string; priority: Obligation["priority"]; status: "DRAFT" | "UPCOMING"; description: string };
const emptyForm = (): FormState => ({ title: "", category: "VENDOR", amount: "", dueDate: tomorrow(), recipient: "", recipientAddress: "", priority: "NORMAL", status: "UPCOMING", description: "" });
const toForm = (item: Obligation): FormState => ({ title: item.title, category: item.category, amount: moneyToInput(item.amount), dueDate: item.dueAt.slice(0, 10), recipient: item.recipient ?? "", recipientAddress: item.recipientAddress ?? "", priority: item.priority, status: item.status === "DRAFT" ? "DRAFT" : "UPCOMING", description: item.description });

export function ObligationExplorer() {
  const { workspace, operationalWorkspace, assessment, createObligation, updateObligation, deleteObligation, storageIssue, readOnly, mode } = useTreasuryWorkspace();
  const [filter, setFilter] = useState<Filter>("ALL"); const [selectedId, setSelectedId] = useState<string | null>(null); const [open, setOpen] = useState(false); const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm); const [error, setError] = useState("");
  const visible = useMemo(() => filter === "ALL" ? workspace.obligations : workspace.obligations.filter((item) => item.status === filter), [filter, workspace.obligations]);
  const openCreate = () => { setEditingId(null); setForm(emptyForm()); setError(""); setOpen(true); };
  const openEdit = (item: Obligation) => { setEditingId(item.id); setForm(toForm(item)); setError(""); setOpen(true); };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try {
      if (!form.title.trim()) throw new Error("Title is required");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate)) throw new Error("A valid due date is required");
      const address = form.recipientAddress.trim();
      if (address && !isAddress(address)) throw new Error("Enter a valid checksummed recipient address or leave it empty.");
      const input: ObligationInput = { title: form.title.trim(), category: form.category, amount: parseMoneyInput(form.amount), dueAt: `${form.dueDate}T17:00:00.000Z`, recipient: form.recipient.trim() || null, recipientAddress: address ? getAddress(address) : null, priority: form.priority, status: form.status, description: form.description.trim() };
      if (editingId) updateObligation(editingId, input); else createObligation(input);
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Obligation is invalid"); }
  };
  const evaluatedAt = assessment ? new Date(assessment.evaluatedAt) : new Date();
  const selected = visible.find((item) => item.id === selectedId) ?? visible.find((item) => item.id === assessment?.nextPayment?.id) ?? visible[0] ?? null;
  const plan = selected && operationalWorkspace && assessment ? assessPayment(operationalWorkspace, selected.id, evaluatedAt) : null;
  const weeks = weeklyOutflows(workspace.obligations, evaluatedAt);

  return <PageBody>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <FilterGroup label="Filter obligations" options={filters} value={filter} onChange={setFilter} />
      <button onClick={openCreate} disabled={readOnly || Boolean(storageIssue)} className={buttonClass.primary}><Plus aria-hidden="true" className="size-4" />New obligation</button>
    </div>

    <SectionCard>
      <SectionHeading index="03.1" title="Outflows by week" description="Upcoming and overdue obligations over the next 13 weeks. Draft and paid records are excluded." />
      <div className="p-5 md:p-6"><WeeklyOutflowChart weeks={weeks} /></div>
    </SectionCard>

    {assessment
      ? <KpiGrid label="Obligation totals" columns={3} className="mt-6">
          <Kpi label="Protected obligations" value={<MoneyValue money={assessment.upcomingObligations} className="text-2xl" />} detail="Active within the fixed 30-day horizon" />
          <Kpi label="Protected capital" value={<MoneyValue money={assessment.protectedCapital} className="text-2xl" />} detail="Obligations + safety buffer + pending" />
          <Kpi label="Deployable capital" value={<MoneyValue money={assessment.deployableCapital} className="text-2xl" />} detail="Recalculated after every saved change" accent />
        </KpiGrid>
      : <div role="status" className="mt-6 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-5 text-sm text-[#ff9a92]">Obligations remain editable, but financial totals are paused until the linked Arc Testnet balance is verified.</div>}

    <SectionCard className="mt-6">
      <SectionHeading index="03.2" title="Payment calendar" description="Draft and paid records are excluded from protected capital" />
      {visible.length === 0 || !selected ? <EmptyState title="No records in this view" description="Create an obligation or choose another status." /> : (
        <div className="grid xl:grid-cols-[1fr_340px]">
          <div role="region" aria-label="Obligations table" tabIndex={0} className="relative overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#7fa6ff]">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <caption className="sr-only">Obligations with due date, amount, priority and status</caption>
              <thead><tr className="border-b border-white/[0.14]">
                {["Due", "Obligation", "Amount", "Priority", "Status"].map((heading) => <th key={heading} scope="col" className={`${labelClass} px-5 py-3 text-left font-normal`}>{heading}</th>)}
                <th scope="col" className="w-16 px-5 py-3"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{visible.map((item) => (
                <tr key={item.id} className={item.id === selected.id ? "border-b border-white/10 bg-white/[0.06] last:border-b-0" : "border-b border-white/10 last:border-b-0 hover:bg-white/[0.03]"}>
                  <td className="mono whitespace-nowrap px-5 py-3 text-xs">{formatDate(item.dueAt, { month: "short", day: "numeric" })}</td>
                  <td className="px-5 py-3"><h2 className="text-sm font-semibold"><button type="button" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === selected.id} className="min-h-11 text-left">{item.title}</button></h2><p className="text-xs text-white/50">{item.category} · {item.recipient ?? "No recipient"}</p></td>
                  <td className="px-5 py-3"><MoneyValue money={item.amount} className="whitespace-nowrap text-sm font-semibold" /></td>
                  <td className="px-5 py-3"><StatusPill label={item.priority} tone={priorityTone(item.priority)} /></td>
                  <td className="px-5 py-3"><StatusPill label={item.status} tone={statusTone(item.status)} /></td>
                  <td className="px-5 py-3"><button onClick={() => openEdit(item)} disabled={readOnly || !canDeleteObligation(workspace, item) || Boolean(storageIssue)} aria-label={`Edit ${item.title}`} className="grid size-10 place-items-center border border-white/[0.14] hover:bg-white/5 disabled:opacity-30"><Pencil aria-hidden="true" className="size-4" /></button>{canDeleteObligation(workspace, item) && <button disabled={readOnly || Boolean(storageIssue)} onClick={() => { setDeleteError(""); setDeletingId(item.id); }} aria-label={`Delete ${item.title}`} className="mt-2 grid size-10 place-items-center border border-white/20 text-[#ff9a92] disabled:opacity-30"><Trash2 aria-hidden="true" className="size-4" /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <aside aria-label="Payment plan" className="border-t border-white/[0.14] p-5 xl:border-l xl:border-t-0">
            <p className={labelClass}>{selected.category}</p>
            <p className="disp mt-2 text-[17px]">Plan for {selected.title}</p>
            <div className="mt-3 flex flex-wrap gap-4"><StatusPill label={selected.status} tone={statusTone(selected.status)} /><StatusPill label={selected.priority} tone={priorityTone(selected.priority)} /></div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-white/10 pt-5">
              <div><dt className={labelClass}>Due</dt><dd className="mono mt-2 text-sm">{formatDate(selected.dueAt)}</dd></div>
              <div><dt className={labelClass}>Amount</dt><dd><MoneyValue money={selected.amount} className="mt-2 block text-sm" /></dd></div>
              <div className="col-span-2"><dt className={labelClass}>Recipient</dt><dd className="mt-2 text-sm">{selected.recipient ?? "Not provided"}</dd>{selected.recipientAddress && <dd className="mono mt-1 break-all text-[11px] text-white/55">{selected.recipientAddress}</dd>}</div>
              {selected.description && <div className="col-span-2"><dt className={labelClass}>Note</dt><dd className="mt-2 text-xs leading-5 text-white/65">{selected.description}</dd></div>}
            </dl>
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className={labelClass}>Funding plan</p>
              {plan ? <>
                <div className="mt-3"><StatusPill label={plan.status} tone={plan.status === "SAFE" ? "success" : "danger"} /></div>
                <p className="mt-3 text-xs leading-5 text-white/60">{plan.status === "SAFE" ? "Earlier obligations and the safety buffer are reserved first. This payment fits in what remains." : "After earlier obligations and the safety buffer, available liquidity does not cover this payment."}</p>
                <dl className="mt-4 grid grid-cols-2 gap-4">
                  <div><dt className={labelClass}>Available after reserves</dt><dd><MoneyValue money={plan.availableAfterReserves} className="mt-2 block text-sm" /></dd></div>
                  <div><dt className={labelClass}>Shortfall</dt><dd><MoneyValue money={plan.shortfall} className="mt-2 block text-sm" /></dd></div>
                </dl>
                {plan.steps.length > 0 && <ol aria-label="Funding sources" className="mt-4 space-y-2">{plan.steps.map((step) => <li key={step.source} className="flex items-center justify-between gap-3 border border-white/10 px-3 py-2"><span className={labelClass}>{sourceLabel(step.source)}</span><MoneyValue money={step.amount} className="text-xs" /></li>)}</ol>}
              </> : <p className="mt-3 text-xs leading-5 text-white/55">{assessment ? "Only upcoming and overdue obligations inside the 30-day horizon are funded from the treasury. This record is not part of the protected total." : "The funding plan is paused until the linked Arc Testnet balance is verified."}</p>}
            </div>
          </aside>
        </div>
      )}
    </SectionCard>
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="obligation-form-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto bg-[#101319] shadow-2xl focus:outline-none"><div className="sticky top-0 flex items-start justify-between border-b border-white/[0.14] bg-[#101319] px-5 py-4"><div><p className="mono text-[9px] uppercase tracking-[0.15em] text-white/50">Your treasury workspace</p><Dialog.Title className="mt-1 text-xl font-semibold">{editingId ? "Edit obligation" : "New obligation"}</Dialog.Title></div><Dialog.Close aria-label="Close obligation form" className="grid size-10 place-items-center border border-white/[0.14] hover:bg-white/5"><X className="size-4" /></Dialog.Close></div><Dialog.Description id="obligation-form-description" className="px-5 pt-5 text-sm text-white/65">Saving recalculates the Treasury Engine. It does not create a payment or contact a wallet.</Dialog.Description>
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-xs font-semibold sm:col-span-2">Title<input aria-label="Obligation title" value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={80} className={inputClass} /></label><label className="text-xs font-semibold">Amount (USDC)<input aria-label="Obligation amount" value={form.amount} onChange={(event) => set("amount", event.target.value)} inputMode="decimal" className={inputClass} /></label><label className="text-xs font-semibold">Due date<input aria-label="Due date" type="date" value={form.dueDate} onChange={(event) => set("dueDate", event.target.value)} className={inputClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Arc Testnet recipient address (optional)<input aria-label="Recipient address" value={form.recipientAddress} onChange={(event) => set("recipientAddress", event.target.value)} maxLength={42} className={`${inputClass} mono`} placeholder="0x…" /><span className="mt-2 block font-normal text-white/65">A label is not a payment address. Adding an address does not move funds.</span></label>
      <label className="text-xs font-semibold">Category<select aria-label="Category" value={form.category} onChange={(event) => set("category", event.target.value as FormState["category"])} className={inputClass}>{["PAYROLL", "VENDOR", "SUBSCRIPTION", "RENT", "TAX", "OTHER"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold">Priority<select aria-label="Priority" value={form.priority} onChange={(event) => set("priority", event.target.value as FormState["priority"])} className={inputClass}>{["CRITICAL", "HIGH", "NORMAL", "LOW"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold">Status<select aria-label="Status" value={form.status} onChange={(event) => set("status", event.target.value as FormState["status"])} className={inputClass}><option>UPCOMING</option><option>DRAFT</option></select></label><label className="text-xs font-semibold">Recipient<input aria-label="Recipient" value={form.recipient} onChange={(event) => set("recipient", event.target.value)} maxLength={120} className={inputClass} /></label><label className="text-xs font-semibold sm:col-span-2">Description<textarea aria-label="Description" value={form.description} onChange={(event) => set("description", event.target.value)} maxLength={500} rows={3} className={inputClass} /></label>{error && <p role="alert" className="border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92] sm:col-span-2">{error}</p>}<button type="submit" className="bg-[#f4f1e8] px-5 py-4 text-sm font-semibold text-[#0b0b0d] sm:col-span-2">Save and recalculate</button></form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <SectionCard className="mt-6"><SectionHeading index="03.3" title="User-approved payments" description="Arc Testnet USDC - your wallet approves each payment" /><div className="space-y-3 p-5">{visible.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3"><div className="min-w-0"><p className="text-sm font-semibold">Payment for {item.title}</p><p className="break-all text-xs text-white/65">{item.recipientAddress ?? "Add a recipient address to review a payment."}</p>{item.status === "PAID" && <p className="text-xs">{item.paymentReference ? "Server receipt reference available" : "Historical record - no verified payment receipt"}</p>}</div>{mode === "DEMO" ? <button disabled className={buttonClass.ghost}>Pay - exit demo first</button> : <PaymentDialog obligation={item} />}</div>)}</div></SectionCard>
    {mode === "LIVE" && <PaymentHistory />}
    <Dialog.Root open={Boolean(deletingId)} onOpenChange={(value) => { if (!value && !deleting) setDeletingId(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 border border-white/20 bg-[#101319] p-6 text-[#f4f1e8]"><Dialog.Title className="text-lg">Delete bill?</Dialog.Title><Dialog.Description className="mt-3 text-sm text-white/65">Remove {workspace.obligations.find((item) => item.id === deletingId)?.title} from your treasury. Bills with payment history are kept for your audit trail.</Dialog.Description>{deleteError && <p role="alert" className="mt-4 text-sm text-[#ff9a92]">{deleteError}</p>}<div className="mt-6 flex gap-3"><button disabled={deleting || readOnly} className={buttonClass.primary} onClick={async () => { if (!deletingId) return; setDeleting(true); setDeleteError(""); try { await deleteObligation(deletingId); setDeletingId(null); } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "Bill could not be deleted."); } finally { setDeleting(false); } }}>Confirm deletion</button><Dialog.Close disabled={deleting} className={buttonClass.ghost}>Cancel</Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </PageBody>;
}
