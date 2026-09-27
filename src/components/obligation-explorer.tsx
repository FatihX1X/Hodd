"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Plus, X } from "lucide-react";
import clsx from "clsx";
import { EmptyState } from "./page-states";
import { MoneyValue, SectionCard, SectionHeading, StatusPill } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { formatDate } from "@/lib/treasury/format";
import { moneyToInput, parseMoneyInput } from "@/lib/treasury/money";
import type { Obligation, ObligationInput } from "@/lib/treasury/models";

type Filter = "ALL" | Obligation["status"];
const filters: Filter[] = ["ALL", "UPCOMING", "DRAFT", "OVERDUE", "PAID"];
const inputClass = "mt-2 w-full border border-black/20 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#164b32]";
const tomorrow = () => { const date = new Date(); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
type FormState = { title: string; category: Obligation["category"]; amount: string; dueDate: string; recipient: string; priority: Obligation["priority"]; status: "DRAFT" | "UPCOMING"; description: string };
const emptyForm = (): FormState => ({ title: "", category: "VENDOR", amount: "", dueDate: tomorrow(), recipient: "", priority: "NORMAL", status: "UPCOMING", description: "" });
const toForm = (item: Obligation): FormState => ({ title: item.title, category: item.category, amount: moneyToInput(item.amount), dueDate: item.dueAt.slice(0, 10), recipient: item.recipient ?? "", priority: item.priority, status: item.status === "DRAFT" ? "DRAFT" : "UPCOMING", description: item.description });

export function ObligationExplorer() {
  const { workspace, assessment, createObligation, updateObligation, storageIssue } = useTreasuryWorkspace();
  const [filter, setFilter] = useState<Filter>("ALL"); const [open, setOpen] = useState(false); const [editingId, setEditingId] = useState<string | null>(null);
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
      const input: ObligationInput = { title: form.title.trim(), category: form.category, amount: parseMoneyInput(form.amount), dueAt: `${form.dueDate}T17:00:00.000Z`, recipient: form.recipient.trim() || null, priority: form.priority, status: form.status, description: form.description.trim() };
      if (editingId) updateObligation(editingId, input); else createObligation(input);
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Obligation is invalid"); }
  };
  return <div className="metric-grid mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-10 lg:py-10">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div role="group" aria-label="Filter obligations" className="flex flex-wrap gap-2">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} aria-pressed={filter === item} className={clsx("border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]", filter === item ? "border-[#164b32] bg-[#164b32] text-white" : "border-black/15 bg-[#fffdf7] text-black/55 hover:border-black/40")}>{item}</button>)}</div><button onClick={openCreate} disabled={Boolean(storageIssue)} className="inline-flex min-h-11 items-center gap-2 bg-[#0b0d0c] px-4 text-xs font-semibold text-white hover:bg-[#242824] disabled:opacity-40"><Plus className="size-4" />New obligation</button></div>
    <SectionCard><SectionHeading index="03.1" title="Payment calendar" description="Draft and paid records are excluded from protected capital" />{visible.length === 0 ? <EmptyState title="No records in this view" description="Create an obligation or choose another status." /> : <div className="divide-y divide-black/10">{visible.map((item) => <article key={item.id} className="grid gap-4 p-5 sm:grid-cols-[120px_1fr_auto_auto] sm:items-center"><div><p className="mono text-[9px] uppercase text-black/40">Due</p><p className="mt-1 text-sm font-semibold">{formatDate(item.dueAt, { month: "short", day: "numeric" })}</p></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{item.title}</h2><StatusPill label={item.status} tone={item.status === "DRAFT" ? "neutral" : "info"} /></div><p className="mt-1 text-xs text-black/45">{item.category} · {item.recipient ?? "No recipient"}</p></div><div className="sm:text-right"><MoneyValue money={item.amount} className="text-sm font-semibold" /><div className="mt-1"><StatusPill label={item.priority} tone={item.priority === "CRITICAL" ? "danger" : item.priority === "HIGH" ? "warning" : "neutral"} /></div></div><button onClick={() => openEdit(item)} disabled={item.status === "PAID" || Boolean(storageIssue)} aria-label={`Edit ${item.title}`} className="grid size-10 place-items-center border border-black/15 hover:bg-black/5 disabled:opacity-30"><Pencil className="size-4" /></button></article>)}</div>}</SectionCard>
    <div className="mt-6 grid gap-4 md:grid-cols-3"><Metric label="Protected obligations" value={<MoneyValue money={assessment.upcomingObligations} />} detail="Active within the fixed 30-day horizon" /><Metric label="Protected capital" value={<MoneyValue money={assessment.protectedCapital} />} detail="Obligations + safety buffer + pending" /><Metric label="Deployable capital" value={<MoneyValue money={assessment.deployableCapital} />} detail="Recalculated after every saved change" /></div>
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="obligation-form-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto bg-[#fffdf7] shadow-2xl focus:outline-none"><div className="sticky top-0 flex items-start justify-between border-b border-black/15 bg-[#fffdf7] px-5 py-4"><div><p className="mono text-[9px] uppercase tracking-[0.15em] text-black/40">Local workspace</p><Dialog.Title className="mt-1 text-xl font-semibold">{editingId ? "Edit obligation" : "New obligation"}</Dialog.Title></div><Dialog.Close aria-label="Close obligation form" className="grid size-10 place-items-center border border-black/15 hover:bg-black/5"><X className="size-4" /></Dialog.Close></div><Dialog.Description id="obligation-form-description" className="px-5 pt-5 text-sm text-black/55">Saving recalculates the Treasury Engine. It does not create a payment or contact a wallet.</Dialog.Description>
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-xs font-semibold sm:col-span-2">Title<input aria-label="Obligation title" value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={80} className={inputClass} /></label><label className="text-xs font-semibold">Amount (USDC)<input aria-label="Obligation amount" value={form.amount} onChange={(event) => set("amount", event.target.value)} inputMode="decimal" className={inputClass} /></label><label className="text-xs font-semibold">Due date<input aria-label="Due date" type="date" value={form.dueDate} onChange={(event) => set("dueDate", event.target.value)} className={inputClass} /></label>
      <label className="text-xs font-semibold">Category<select aria-label="Category" value={form.category} onChange={(event) => set("category", event.target.value as FormState["category"])} className={inputClass}>{["PAYROLL", "VENDOR", "SUBSCRIPTION", "RENT", "TAX", "OTHER"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold">Priority<select aria-label="Priority" value={form.priority} onChange={(event) => set("priority", event.target.value as FormState["priority"])} className={inputClass}>{["CRITICAL", "HIGH", "NORMAL", "LOW"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold">Status<select aria-label="Status" value={form.status} onChange={(event) => set("status", event.target.value as FormState["status"])} className={inputClass}><option>UPCOMING</option><option>DRAFT</option></select></label><label className="text-xs font-semibold">Recipient<input aria-label="Recipient" value={form.recipient} onChange={(event) => set("recipient", event.target.value)} maxLength={120} className={inputClass} /></label><label className="text-xs font-semibold sm:col-span-2">Description<textarea aria-label="Description" value={form.description} onChange={(event) => set("description", event.target.value)} maxLength={500} rows={3} className={inputClass} /></label>{error && <p role="alert" className="border border-[#9a433c]/20 bg-[#f5dedb] p-3 text-xs text-[#7b332d] sm:col-span-2">{error}</p>}<button type="submit" className="bg-[#0b0d0c] px-5 py-4 text-sm font-semibold text-white sm:col-span-2">Save and recalculate</button></form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: React.ReactNode; detail: string }) { return <div className="border border-black/15 bg-[#fffdf7] p-5"><p className="mono text-[9px] uppercase tracking-[0.14em] text-black/40">{label}</p><p className="mono mt-4 text-2xl">{value}</p><p className="mt-2 text-xs text-black/45">{detail}</p></div>; }
