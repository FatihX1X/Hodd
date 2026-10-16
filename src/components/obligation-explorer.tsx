"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { AlertTriangle, BadgeCheck, CalendarClock, CalendarRange, ListChecks, Lock, Pencil, Plus, ShieldCheck, Trash2, UserRound, Wallet, X } from "lucide-react";
import { getAddress, isAddress } from "viem";
import { PaymentDialog } from "./payment-dialog";
import { GatewayPaymentDialog } from "./gateway-payment-dialog";
import { PaymentHistory } from "./payment-history";
import { EmptyState } from "./page-states";
import { WeeklyOutflowChart } from "./charts";
import { CalendarTile, ChipFilter, Field, ObligationTimeline, PriorityBars, StatusChip, billColor, categoryMeta, mutedColor, statusMeta, type BillKind, type ChipOption } from "./ledger-visuals";
import { KpiGrid, MoneyValue, PageBody, SectionCard, SectionHeading, buttonClass, inputClass, labelClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { Figure, InfoTip, Ring, moneyColor } from "./visuals";
import { assessPayment, protectionPlan } from "@/lib/treasury/engine";
import { formatDate, formatMoney } from "@/lib/treasury/format";
import { moneyToInput, parseMoneyInput } from "@/lib/treasury/money";
import type { LiquiditySource, Money, Obligation, ObligationInput } from "@/lib/treasury/models";
import { canDeleteObligation } from "@/lib/treasury/sample-cleanup";
import { protectionReasonLabel, usdcNumber, weeklyOutflows } from "@/lib/treasury/views";

type Filter = "ALL" | Obligation["status"];
const DAY_MS = 86_400_000;
const sourceColor: Record<LiquiditySource, string> = { LIQUID_USDC: moneyColor.LIQUID, MORPHO: moneyColor.MORPHO, USYC: moneyColor.USYC, BTC_CREDIT: moneyColor.BTC_RESERVE, BTC_SALE: moneyColor.BTC_RESERVE };
const sourceLabel = (source: string) => source.replaceAll("_", " ");
const tomorrow = () => { const date = new Date(); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const ratio = (part: Money, whole: Money) => { const total = usdcNumber(whole); return total > 0 ? usdcNumber(part) / total : null; };
const percent = (value: number | null) => value === null ? "0%" : `${Math.round(Math.min(value, 1) * 100)}%`;
type FormState = { title: string; category: Obligation["category"]; amount: string; dueDate: string; recipient: string; recipientAddress: string; priority: Obligation["priority"]; status: "DRAFT" | "UPCOMING"; description: string };
const emptyForm = (): FormState => ({ title: "", category: "VENDOR", amount: "", dueDate: tomorrow(), recipient: "", recipientAddress: "", priority: "NORMAL", status: "UPCOMING", description: "" });
const toForm = (item: Obligation): FormState => ({ title: item.title, category: item.category, amount: moneyToInput(item.amount), dueDate: item.dueAt.slice(0, 10), recipient: item.recipient ?? "", recipientAddress: item.recipientAddress ?? "", priority: item.priority, status: item.status === "DRAFT" ? "DRAFT" : "UPCOMING", description: item.description });

export function ObligationExplorer() {
  const { workspace, operationalWorkspace, assessment, createObligation, updateObligation, deleteObligation, storageIssue, readOnly, mode, autopilotActive } = useTreasuryWorkspace();
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
  const plan = selected && operationalWorkspace && assessment ? assessPayment(operationalWorkspace, selected.id, evaluatedAt, { autopilotActive }) : null;
  const protection = operationalWorkspace && assessment ? protectionPlan(operationalWorkspace, evaluatedAt, { autopilotActive }) : null;
  const protectionLabel = (id: string) => {
    const entry = protection?.protected.find((entry) => entry.obligation.id === id);
    return entry ? protectionReasonLabel(entry.reason, assessment!.protectionLeadDays) : protection?.planned.some((item) => item.id === id) ? "Planned" : null;
  };
  const weeks = weeklyOutflows(workspace.obligations, evaluatedAt);
  const leadDays = assessment?.protectionLeadDays ?? 7;
  // Where each open bill sits: overdue, protected (due soon or unsafe to fund from Morpho), planned (funded later) or draft.
  const kindOf = (item: Obligation): BillKind | null => {
    if (item.status === "PAID") return null;
    if (item.status === "DRAFT") return "draft";
    if (item.status === "OVERDUE") return "overdue";
    if (protection) return protection.protected.some((entry) => entry.obligation.id === item.id) ? "protected" : "planned";
    return Date.parse(item.dueAt) - evaluatedAt.getTime() <= leadDays * DAY_MS ? "protected" : "planned";
  };
  const daysText = (item: Obligation) => {
    if (item.status === "PAID" || item.status === "DRAFT") return null;
    const days = Math.round((utcDay(new Date(item.dueAt)) - utcDay(evaluatedAt)) / DAY_MS);
    return days < 0 ? `Overdue by ${-days} ${-days === 1 ? "day" : "days"}` : days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`;
  };
  const timelineBills = visible.flatMap((item) => { const kind = kindOf(item); return kind ? [{ id: item.id, title: item.title, amount: usdcNumber(item.amount), amountLabel: formatMoney(item.amount), dueAt: item.dueAt, kind }] : []; });
  const largest = Math.max(...visible.map((item) => usdcNumber(item.amount)), 0);
  const count = (status: Obligation["status"]) => workspace.obligations.filter((item) => item.status === status).length;
  const filterOptions: ChipOption<Filter>[] = [
    { value: "ALL", label: "All", count: workspace.obligations.length },
    { value: "UPCOMING", label: "Upcoming", icon: statusMeta.UPCOMING.icon, count: count("UPCOMING") },
    { value: "DRAFT", label: "Draft", icon: statusMeta.DRAFT.icon, count: count("DRAFT") },
    { value: "OVERDUE", label: "Overdue", icon: statusMeta.OVERDUE.icon, count: count("OVERDUE") },
    { value: "PAID", label: "Paid", icon: statusMeta.PAID.icon, count: count("PAID") },
  ];
  const treasury = operationalWorkspace?.totalTreasury ?? workspace.totalTreasury;
  const selectedKind = selected ? kindOf(selected) : null;
  const selectedColor = selectedKind ? billColor[selectedKind] : mutedColor;
  const SelectedCategoryIcon = categoryMeta[selected?.category ?? "OTHER"].icon;

  return <PageBody>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <ChipFilter label="Filter obligations" options={filterOptions} value={filter} onChange={setFilter} />
      <button onClick={openCreate} disabled={readOnly || Boolean(storageIssue)} className={buttonClass.primary}><Plus aria-hidden="true" className="size-4" />New obligation</button>
    </div>

    <SectionCard>
      <SectionHeading icon={<CalendarRange className="size-4" />} title="Next 30 days" action={<InfoTip label="About the timeline" className="-my-1">Each mark is a bill on its due day, sized by amount. Red squares are overdue, amber circles are protected (due soon or unsafe to fund from Morpho), blue rings are planned for later funding from Morpho, and dashed rings are drafts that are not counted. Select a mark to open its plan.</InfoTip>} />
      <div className="py-6"><ObligationTimeline bills={timelineBills} from={evaluatedAt} selectedId={selected?.id ?? null} onSelect={setSelectedId} leadDays={assessment ? leadDays : undefined} /></div>
    </SectionCard>

    {assessment
      ? <KpiGrid label="Obligation totals" columns={4} className="mt-6">
          <Figure label="Protected obligations" tip={`Bills due within ${assessment.protectionLeadDays} days or unsafe to fund from Morpho.`} value={<MoneyValue money={assessment.upcomingObligations} className="text-2xl" />} visual={<span aria-hidden="true" className="grid size-14 place-items-center rounded-full border" style={{ borderColor: moneyColor.protected, color: moneyColor.protected }}><Lock className="size-5" /></span>} />
          <Figure label="Planned obligations" tip="Bills that can be funded later from Morpho within 30 days." value={<MoneyValue money={assessment.plannedObligations} className="text-2xl" />} visual={<span aria-hidden="true" className="grid size-14 place-items-center rounded-full border border-dashed" style={{ borderColor: moneyColor.deployable, color: moneyColor.deployable }}><CalendarClock className="size-5" /></span>} />
          <Figure label="Protected capital" tip="Obligations, the safety buffer and pending payments, kept liquid." value={<MoneyValue money={assessment.protectedCapital} className="text-2xl" />} visual={<Ring ratio={ratio(assessment.protectedCapital, treasury)} label="Protected share of the treasury" color={moneyColor.protected} size={64}><span className="mono text-[13px] tabular-nums">{percent(ratio(assessment.protectedCapital, treasury))}</span></Ring>} />
          <Figure label="Deployable capital" tip="Recalculated after every saved change." tone={moneyColor.deployable} value={<MoneyValue money={assessment.deployableCapital} className="text-2xl" />} visual={<Ring ratio={ratio(assessment.deployableCapital, treasury)} label="Deployable share of the treasury" color={moneyColor.deployable} size={64}><span className="mono text-[13px] tabular-nums">{percent(ratio(assessment.deployableCapital, treasury))}</span></Ring>} />
        </KpiGrid>
      : <div role="status" className="mt-6 flex items-start gap-3 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-5 text-sm text-[#ff9a92]"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Obligations remain editable, but financial totals are paused until the linked Arc Testnet balance is verified.</div>}

    <SectionCard className="mt-6">
      <SectionHeading icon={<ListChecks className="size-4" />} title="Payment calendar" action={<InfoTip label="About the payment calendar" className="-my-1">Draft and paid records are excluded from protected capital.</InfoTip>} />
      {visible.length === 0 || !selected ? <EmptyState title="No records in this view" description="Create an obligation or choose another status." /> : (
        <div className="grid xl:grid-cols-[1fr_360px]">
          <ul aria-label="Obligations" className="min-w-0">
            {visible.map((item) => {
              const kind = kindOf(item);
              const color = kind ? billColor[kind] : mutedColor;
              const status = statusMeta[item.status];
              const category = categoryMeta[item.category];
              const CategoryIcon = category.icon;
              const label = protectionLabel(item.id);
              const isSelected = item.id === selected.id;
              const active = item.status === "UPCOMING" || item.status === "OVERDUE";
              return (
                <li key={item.id} className={clsx("relative border-b border-white/10 last:border-b-0", isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")}>
                  {isSelected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5" style={{ background: color }} />}
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
                    <CalendarTile iso={item.dueAt} color={color} />
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold"><button type="button" onClick={() => setSelectedId(item.id)} aria-pressed={isSelected} className="min-h-11 text-left">{item.title}</button></h2>
                      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55"><span className="inline-flex items-center gap-1.5"><CategoryIcon aria-hidden="true" className="size-3.5" />{category.label}</span><span className="inline-flex items-center gap-1.5"><UserRound aria-hidden="true" className="size-3.5" />{item.recipient ?? "No recipient"}</span></p>
                      <span className="sr-only">Due {formatDate(item.dueAt)}</span>
                    </div>
                    <div className="text-right">
                      <MoneyValue money={item.amount} className="whitespace-nowrap text-sm font-semibold" />
                      <span aria-hidden="true" className="ml-auto mt-2 block h-1 w-16 bg-white/10"><span className="block h-full" style={{ width: `${largest > 0 ? Math.max(6, (usdcNumber(item.amount) / largest) * 100) : 0}%`, background: color }} /></span>
                    </div>
                    <div className="col-span-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-start-2 sm:col-span-2">
                      <StatusChip icon={status.icon} label={status.label} color={status.color} />
                      {label && label.toLowerCase() !== status.label.toLowerCase() && <StatusChip icon={kind === "planned" ? CalendarClock : Lock} label={label} color={color} />}
                      <PriorityBars priority={item.priority} />
                      {item.status === "PAID" && <span className="inline-flex items-center gap-1.5 text-xs text-white/55"><BadgeCheck aria-hidden="true" className="size-3.5" />{item.paymentReference ? "Server receipt reference available" : "Historical record, no verified payment receipt"}</span>}
                      {active && !item.recipientAddress && <span className="inline-flex items-center gap-1.5 text-xs text-white/55"><Wallet aria-hidden="true" className="size-3.5" />Add a recipient address to review a payment.</span>}
                      <span className="ml-auto flex flex-wrap items-center gap-2">
                        {active && <><PaymentDialog obligation={item} /><GatewayPaymentDialog obligation={item} /></>}
                        <button onClick={() => openEdit(item)} disabled={readOnly || !canDeleteObligation(workspace, item) || Boolean(storageIssue)} aria-label={`Edit ${item.title}`} title="Edit" className="grid size-11 place-items-center border border-white/[0.14] hover:bg-white/5 disabled:opacity-30"><Pencil aria-hidden="true" className="size-4" /></button>
                        {canDeleteObligation(workspace, item) && <button disabled={readOnly || Boolean(storageIssue)} onClick={() => { setDeleteError(""); setDeletingId(item.id); }} aria-label={`Delete ${item.title}`} title="Delete" className="grid size-11 place-items-center border border-white/20 text-[#ff9a92] disabled:opacity-30"><Trash2 aria-hidden="true" className="size-4" /></button>}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-white/[0.14] xl:border-l xl:border-t-0"><aside aria-label="Payment plan" className="p-5 xl:sticky xl:top-4">
            <div className="flex items-start gap-4">
              <CalendarTile iso={selected.dueAt} color={selectedColor} size="lg" />
              <div className="min-w-0">
                <p className={clsx(labelClass, "inline-flex items-center gap-1.5")}><SelectedCategoryIcon aria-hidden="true" className="size-3.5" />{categoryMeta[selected.category].label}</p>
                <p className="disp mt-1.5 text-[17px] [overflow-wrap:anywhere]">Plan for {selected.title}</p>
                {daysText(selected) && <p className="mt-2 text-xs text-white/60">{daysText(selected)}</p>}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2"><StatusChip icon={statusMeta[selected.status].icon} label={statusMeta[selected.status].label} color={statusMeta[selected.status].color} /><span className="inline-flex items-center gap-2 text-xs text-white/60"><PriorityBars priority={selected.priority} />{selected.priority.toLowerCase()} priority</span>{protectionLabel(selected.id) && protectionLabel(selected.id)!.toLowerCase() !== statusMeta[selected.status].label.toLowerCase() && <StatusChip icon={selectedKind === "planned" ? CalendarClock : Lock} label={protectionLabel(selected.id)!} color={selectedColor} />}</div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-white/10 pt-5">
              <div><dt className={labelClass}>Due</dt><dd className="mono mt-2 text-sm">{formatDate(selected.dueAt)}</dd></div>
              <div><dt className={labelClass}>Amount</dt><dd><MoneyValue money={selected.amount} className="mt-2 block text-sm" /></dd></div>
              <div className="col-span-2"><dt className={labelClass}>Recipient</dt><dd className="mt-2 text-sm">{selected.recipient ?? "Not provided"}</dd>{selected.recipientAddress && <dd className="mono mt-1 break-all text-[11px] text-white/55">{selected.recipientAddress}</dd>}</div>
              {selected.description && <div className="col-span-2"><dt className={labelClass}>Note</dt><dd className="mt-2 text-xs leading-5 text-white/65">{selected.description}</dd></div>}
            </dl>
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className={clsx(labelClass, "flex items-center gap-1")}>Funding plan{plan && <InfoTip label="About the funding plan" className="-my-1">{plan.status === "SAFE" ? "Earlier obligations and the safety buffer are reserved first. This payment fits in what remains." : "After earlier obligations and the safety buffer, available liquidity does not cover this payment."}</InfoTip>}</p>
              {plan ? <>
                <div className="mt-3 flex items-center gap-4">
                  <Ring ratio={usdcNumber(plan.required) > 0 ? usdcNumber(plan.availableAfterReserves) / usdcNumber(plan.required) : 1} label="Share of this payment covered after reserves" color={plan.status === "SAFE" ? moneyColor.safe : moneyColor.danger} size={64}>
                    {plan.status === "SAFE" ? <ShieldCheck aria-hidden="true" className="size-5" style={{ color: moneyColor.safe }} /> : <AlertTriangle aria-hidden="true" className="size-5" style={{ color: moneyColor.danger }} />}
                  </Ring>
                  <div className="min-w-0">
                    <StatusChip icon={plan.status === "SAFE" ? ShieldCheck : AlertTriangle} label={plan.status.replace("_", " ")} color={plan.status === "SAFE" ? moneyColor.safe : moneyColor.danger} className="text-sm" />
                    <p className="mono mt-1 text-xs tabular-nums text-white/60">{percent(usdcNumber(plan.required) > 0 ? usdcNumber(plan.availableAfterReserves) / usdcNumber(plan.required) : 1)} covered</p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-4">
                  <div><dt className={labelClass}>Available after reserves</dt><dd><MoneyValue money={plan.availableAfterReserves} className="mt-2 block text-sm" /></dd></div>
                  <div><dt className={labelClass}>Shortfall</dt><dd><MoneyValue money={plan.shortfall} className={clsx("mt-2 block text-sm", BigInt(plan.shortfall.minorUnits) > 0n && "text-[#ff9a92]")} /></dd></div>
                </dl>
                {plan.steps.length > 0 && <>
                  <div aria-hidden="true" className="mt-4 flex h-2 gap-px overflow-hidden bg-white/10">{plan.steps.map((step) => <span key={step.source} style={{ flex: `${Math.max(usdcNumber(step.amount), 0.000001)} 1 0`, background: sourceColor[step.source] }} />)}</div>
                  <ol aria-label="Funding sources" className="mt-3 space-y-2">{plan.steps.map((step) => <li key={step.source} className="flex items-center justify-between gap-3 border border-white/10 px-3 py-2"><span className={clsx(labelClass, "inline-flex items-center gap-2")}><span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: sourceColor[step.source] }} />{sourceLabel(step.source)}</span><MoneyValue money={step.amount} className="text-xs" /></li>)}</ol>
                </>}
              </> : <p className="mt-3 flex items-center gap-1 text-xs leading-5 text-white/55">{assessment ? <>This record is not part of the protected total.<InfoTip label="About planned bills" className="-my-1">Planned bills up to 30 days ahead can be funded later from safely withdrawable Morpho liquidity.</InfoTip></> : "The funding plan is paused until the linked Arc Testnet balance is verified."}</p>}
            </div>
          </aside></div>
        </div>
      )}
    </SectionCard>

    <SectionCard className="mt-6">
      <SectionHeading icon={<CalendarRange className="size-4" />} title="Outflows by week" action={<InfoTip label="About weekly outflows" className="-my-1">Upcoming and overdue obligations over the next 13 weeks. Draft and paid records are excluded.</InfoTip>} />
      <div className="p-5 md:p-6"><WeeklyOutflowChart weeks={weeks} /></div>
    </SectionCard>

    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content aria-describedby="obligation-form-description" className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto bg-[#101319] shadow-2xl focus:outline-none">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/[0.14] bg-[#101319] px-5 py-4"><div className="flex items-center gap-3"><span aria-hidden="true" className="grid size-10 place-items-center border border-white/[0.14]">{editingId ? <Pencil className="size-4" /> : <Plus className="size-4" />}</span><Dialog.Title className="text-xl font-semibold">{editingId ? "Edit obligation" : "New obligation"}</Dialog.Title></div><Dialog.Close aria-label="Close obligation form" className="grid size-11 place-items-center border border-white/[0.14] hover:bg-white/5"><X aria-hidden="true" className="size-4" /></Dialog.Close></div>
      <Dialog.Description id="obligation-form-description" className="flex items-start gap-2 px-5 pt-5 text-sm text-white/65"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#7fa6ff]" />Saving recalculates the Treasury Engine. It does not create a payment or contact a wallet.</Dialog.Description>
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(id) => <input id={id} aria-label="Obligation title" value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={80} className={inputClass} />}</Field>
        <Field label="Amount (USDC)">{(id) => <input id={id} aria-label="Obligation amount" value={form.amount} onChange={(event) => set("amount", event.target.value)} inputMode="decimal" className={clsx(inputClass, "mono")} />}</Field>
        <Field label="Due date">{(id) => <input id={id} aria-label="Due date" type="date" value={form.dueDate} onChange={(event) => set("dueDate", event.target.value)} className={inputClass} />}</Field>
        <Field label="Arc Testnet recipient address (optional)" tip="A label is not a payment address. Adding an address does not move funds." tipLabel="About the recipient address" className="sm:col-span-2">{(id) => <input id={id} aria-label="Recipient address" value={form.recipientAddress} onChange={(event) => set("recipientAddress", event.target.value)} maxLength={42} className={`${inputClass} mono`} placeholder="0x…" />}</Field>
        <Field label="Category">{(id) => <select id={id} aria-label="Category" value={form.category} onChange={(event) => set("category", event.target.value as FormState["category"])} className={inputClass}>{(Object.keys(categoryMeta) as Obligation["category"][]).map((value) => <option key={value} value={value}>{categoryMeta[value].label}</option>)}</select>}</Field>
        <Field label="Priority">{(id) => <select id={id} aria-label="Priority" value={form.priority} onChange={(event) => set("priority", event.target.value as FormState["priority"])} className={inputClass}>{(["CRITICAL", "HIGH", "NORMAL", "LOW"] as const).map((value) => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}</select>}</Field>
        <Field label="Status">{(id) => <select id={id} aria-label="Status" value={form.status} onChange={(event) => set("status", event.target.value as FormState["status"])} className={inputClass}><option value="UPCOMING">Upcoming</option><option value="DRAFT">Draft</option></select>}</Field>
        <Field label="Recipient">{(id) => <input id={id} aria-label="Recipient" value={form.recipient} onChange={(event) => set("recipient", event.target.value)} maxLength={120} className={inputClass} />}</Field>
        <Field label="Description" className="sm:col-span-2">{(id) => <textarea id={id} aria-label="Description" value={form.description} onChange={(event) => set("description", event.target.value)} maxLength={500} rows={3} className={inputClass} />}</Field>
        {error && <p role="alert" className="border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-xs text-[#ff9a92] sm:col-span-2">{error}</p>}
        <button type="submit" className={clsx(buttonClass.primary, "min-h-12 sm:col-span-2")}>Save and recalculate</button>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    {mode === "LIVE" && <PaymentHistory />}
    <Dialog.Root open={Boolean(deletingId)} onOpenChange={(value) => { if (!value && !deleting) setDeletingId(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 border border-white/20 bg-[#101319] p-6 text-[#f4f1e8]"><div className="flex items-center gap-3"><span aria-hidden="true" className="grid size-10 place-items-center border border-[#ff9a92]/40 text-[#ff9a92]"><Trash2 className="size-4" /></span><Dialog.Title className="text-lg">Delete bill?</Dialog.Title></div><Dialog.Description className="mt-3 text-sm text-white/65">Remove {workspace.obligations.find((item) => item.id === deletingId)?.title} from your treasury. Bills with payment history are kept for your audit trail.</Dialog.Description>{deleteError && <p role="alert" className="mt-4 text-sm text-[#ff9a92]">{deleteError}</p>}<div className="mt-6 flex gap-3"><button disabled={deleting || readOnly} className={buttonClass.primary} onClick={async () => { if (!deletingId) return; setDeleting(true); setDeleteError(""); try { await deleteObligation(deletingId); setDeletingId(null); } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "Bill could not be deleted."); } finally { setDeleting(false); } }}>Confirm deletion</button><Dialog.Close disabled={deleting} className={buttonClass.ghost}>Cancel</Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </PageBody>;
}
