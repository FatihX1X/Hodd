"use client";
import { useState } from "react";
import { percentageBps } from "@/lib/hoddie/privacy";
import type { HoddieResult } from "@/lib/hoddie/models";
import { moneyToInput } from "@/lib/treasury/money";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { useHoddie } from "./hoddie-provider";
import { buttonClass, inputClass, labelClass } from "./primitives";
const strategies = ["LIQUID", "MORPHO", "USYC", "BTC_RESERVE"] as const;
const bpsText = (value: number) => `${BigInt(value) / 100n}.${(BigInt(value) % 100n).toString().padStart(2, "0")}`;
const input = `${inputClass} min-w-0`;
export function HoddieDraft({ draft }: { draft: NonNullable<HoddieResult["draft"]> }) {
  const { workspace, earnState } = useTreasuryWorkspace(); const { manual, busy } = useHoddie(); const [error, setError] = useState("");
  const values = draft.values; const value = (name: string) => typeof values[name] === "string" ? values[name] as string : "";
  const bill = draft.kind === "CREATE_OBLIGATION" || draft.kind === "UPDATE_OBLIGATION";
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); const fields = new FormData(event.currentTarget); const get = (name: string) => String(fields.get(name) ?? "").trim();
    try {
      let change: Record<string, unknown> = {};
      if (bill) { change = Object.fromEntries(["title", "amount", "dueDate", "recipientAddress", "description", "status"].map((name) => [name, get(name)]).filter(([, item]) => item)); if (draft.kind === "UPDATE_OBLIGATION") change.obligationId = get("obligationId"); }
      if (draft.kind === "PAYMENT_REQUEST") change.obligationId = get("obligationId");
      if (draft.kind === "UPDATE_POLICY") change = { safetyBuffer: get("safetyBuffer"), minimumLiquidityCoverageBps: percentageBps(get("coverage")), strategyCapsBps: Object.fromEntries(strategies.map((item) => [item, percentageBps(get(`cap:${item}`))])), enabledStrategies: Object.fromEntries(strategies.map((item) => [item, fields.has(`enabled:${item}`)])) };
      if (draft.kind === "SET_TARGETS") change.targetsBps = Object.fromEntries(strategies.map((item) => [item, percentageBps(get(item))]));
      if (draft.kind === "EARN_REQUEST") change = { operation: get("operation"), vaultAddress: get("vaultAddress"), ...(get("amount") ? { amount: get("amount") } : {}) };
      void manual({ mode: "PREPARE", kind: draft.kind, change });
    } catch { setError("Enter valid percentages with at most two decimals."); }
  };
  const field = (name: string, label: string, type = "text", defaultValue = value(name), required = false) => <label className={`block ${labelClass}`}>{label}<input name={name} type={type} defaultValue={defaultValue} required={required} maxLength={name === "description" ? 500 : 120} inputMode={name === "amount" ? "decimal" : undefined} className={input} /></label>;
  const obligationSelect = <label className={`block ${labelClass}`}>Obligation<select name="obligationId" required defaultValue={value("obligationId")} className={input}><option value="">Choose an obligation</option>{workspace.obligations.filter((item) => item.status !== "PAID").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>;
  return <form onSubmit={submit} className="mt-4 space-y-4 border border-white/[0.14] bg-[#0b0b0d] p-4">
    <p className="disp text-sm">Complete details · preview first</p>
    {(draft.kind === "UPDATE_OBLIGATION" || draft.kind === "PAYMENT_REQUEST") && obligationSelect}
    {bill && <><div className="grid gap-4 sm:grid-cols-2">{field("title", "Title", "text", value("title"), draft.kind === "CREATE_OBLIGATION")}{field("amount", "Amount (USDC)", "text", value("amount"), draft.kind === "CREATE_OBLIGATION")}{field("dueDate", "Due date", "date", value("dueDate"), draft.kind === "CREATE_OBLIGATION")}<label className={`block ${labelClass}`}>Status<select name="status" defaultValue={value("status") || (draft.kind === "CREATE_OBLIGATION" ? "UPCOMING" : "")} className={input}><option value="">Keep existing status</option><option value="UPCOMING">Upcoming</option><option value="DRAFT">Draft</option></select></label></div>{field("recipientAddress", "Recipient address (optional; required before payment)")}{field("description", "Description (optional)")}</>}
    {draft.kind === "UPDATE_POLICY" && <><div className="grid gap-4 sm:grid-cols-2">{field("safetyBuffer", "Safety buffer (USDC)", "text", value("safetyBuffer") || moneyToInput(workspace.policy.safetyBuffer), true)}{field("coverage", "Minimum coverage (%)", "text", bpsText(typeof values.minimumLiquidityCoverageBps === "number" ? values.minimumLiquidityCoverageBps : workspace.policy.minimumLiquidityCoverageBps), true)}</div><div className="grid gap-4 sm:grid-cols-2">{strategies.map((item) => <div key={item}>{field(`cap:${item}`, `${item} cap (%)`, "text", bpsText(Number((values.strategyCapsBps as Record<string, number> | undefined)?.[item] ?? workspace.policy.strategyCapsBps[item])), true)}<label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name={`enabled:${item}`} defaultChecked={((values.enabledStrategies as Record<string, boolean> | undefined)?.[item] ?? workspace.policy.enabledStrategies[item])} />Enabled</label></div>)}</div></>}
    {draft.kind === "SET_TARGETS" && <div className="grid gap-4 sm:grid-cols-2">{strategies.map((item) => <div key={item}>{field(item, `${item} target (%)`, "text", bpsText(Number((values.targetsBps as Record<string, number> | undefined)?.[item] ?? workspace.targetAllocationsBps[item])), true)}</div>)}</div>}
    {draft.kind === "EARN_REQUEST" && <><label className={`block ${labelClass}`}>Operation<select name="operation" required defaultValue={value("operation")} className={input}><option value="">Choose an operation</option><option value="DEPOSIT">Deposit</option><option value="WITHDRAW">Withdraw</option><option value="REDEEM_ALL">Redeem all</option></select></label>{field("amount", "Amount (USDC; leave empty for redeem all)")}<label className={`block ${labelClass}`}>Verified vault<select name="vaultAddress" required defaultValue={value("vaultAddress")} className={input}><option value="">Choose a verified vault</option>{earnState.status === "READY" && earnState.portfolio.vaults.map((item) => <option key={item.address} value={item.address}>{item.name}</option>)}</select></label></>}
    <button disabled={busy} className={buttonClass.primary}>Review change</button>
    {error && <p role="alert" className="text-xs text-[#ff9a92]">{error}</p>}
  </form>;
}
