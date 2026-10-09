"use client";

import { isExecutionAvailable } from "@/lib/earn/access-policy";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { moneyToInput } from "@/lib/treasury/money";
import { planEarn, type EarnChange } from "@/lib/hoddie/earn";
import { earnRequestChange } from "@/lib/agent/changes";
import { EarnOperationDialog } from "./earn-operation-dialog";
import { PaymentDialog } from "./payment-dialog";
import { SectionCard, SectionHeading, StatusPill } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

type AgentRequest = { id: string; kind: "PAYMENT_REQUEST" | "EARN_REQUEST"; source?: "CLAUDE_MCP" | "HODDIE"; summary: string; change: Record<string, unknown>; created_at: string; expires_at: string | null };

/**
 * Payment and Morpho requests approved in Claude. Claude never moves money: each
 * request opens the normal Hodd flow (fresh quote, confirmation, wallet signature).
 */
export function AgentRequests() {
  const { workspaceScope, workspace, assessment, operationalWorkspace, earnState, hydrated, mode, readOnly } = useTreasuryWorkspace();
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);
  const resolving = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (mode === "DEMO" || readOnly) return;
    const client = createSupabaseBrowserClient();
    if (!client) return;
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) { setRequests([]); return; }
    const { data } = await client.from("agent_actions").select("id,kind,source,summary,change,created_at,expires_at").eq("user_id", auth.user.id).eq("scope", workspaceScope).eq("status", "OPEN").order("created_at", { ascending: false }).limit(20);
    setRequests((data ?? []) as AgentRequest[]); setLoadedAt(Date.now());
  }, [workspaceScope, mode, readOnly]);

  const resolve = useCallback(async (id: string, status: "DONE" | "DISMISSED") => {
    if (mode === "DEMO" || readOnly) return;
    if (resolving.current.has(id)) return;
    resolving.current.add(id);
    const client = createSupabaseBrowserClient();
    const { error: rpcError } = client ? await client.rpc("hodd_resolve_agent_request", { p_id: id, p_status: status }) : { error: new Error("unavailable") };
    resolving.current.delete(id);
    if (rpcError) setError("The request could not be updated. Reload and try again."); else setError("");
    await load();
  }, [load, mode, readOnly]);

  useEffect(() => {
    if (!hydrated) return;
    const refresh = () => { void load(); };
    const first = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("hodd:agent-actions", refresh);
    return () => { window.clearTimeout(first); window.clearInterval(interval); window.removeEventListener("focus", refresh); window.removeEventListener("hodd:agent-actions", refresh); };
  }, [hydrated, load]);

  // A requested bill that is now PAID (verified receipt) completes its request.
  useEffect(() => {
    const paid = requests.filter((request) => request.kind === "PAYMENT_REQUEST" && workspace.obligations.some((item) => item.id === request.change.obligationId && item.status === "PAID"));
    if (!paid.length) return;
    const timer = window.setTimeout(() => { for (const request of paid) void resolve(request.id, "DONE"); }, 0);
    return () => window.clearTimeout(timer);
  }, [requests, workspace.obligations, resolve]);

  if (!requests.length || mode === "DEMO" || readOnly) return null;
  const portfolio = earnState.status === "READY" ? earnState.portfolio : null;
  const localExecution = portfolio ? isExecutionAvailable(portfolio.integration.execution) : false;

  return <SectionCard className="mt-6">
    <SectionHeading index="00" title="Agent requests" description="Reviewed requests · finish here with your own wallet signature" action={<StatusPill label={`${requests.length} OPEN`} tone="info" />} />
    <div className="divide-y divide-white/10">
      {requests.map((request) => {
        const expired = request.expires_at !== null && Date.parse(request.expires_at) <= loadedAt;
        let action: React.ReactNode = null;
        if (!expired && request.kind === "PAYMENT_REQUEST") {
          const obligation = workspace.obligations.find((item) => item.id === request.change.obligationId);
          action = obligation ? <PaymentDialog obligation={obligation} /> : <span className="text-xs text-white/60">Obligation not found in this workspace.</span>;
        }
        if (!expired && request.kind === "EARN_REQUEST") {
          try {
            const change = earnRequestChange.parse(request.change) as EarnChange;
            const plan = planEarn({ workspace, operationalWorkspace, assessment, portfolio }, change);
            action = <EarnOperationDialog operation={plan.operation} vault={plan.vault} position={plan.position} policyLimit={plan.limit} enabled={localExecution} initialAmount={plan.amount ? moneyToInput(plan.amount) : ""} onComplete={() => void resolve(request.id, "DONE")} />;
          } catch (cause) { action = <span role="status" className="text-xs text-white/60">{cause instanceof Error ? cause.message : "Waiting for live Morpho data…"}</span>; }
        }
        return <article key={request.id} className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3"><Bot aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#8fb0ff]" /><div>
            <p className="text-sm font-semibold">{request.summary}</p>
            <p className="mt-1 text-xs text-white/55">Source: {request.source === "HODDIE" ? "Hoddie" : "Claude connector"}</p>
            <p className="mono mt-1 text-[10px] uppercase tracking-[0.1em] text-white/55">{request.kind === "PAYMENT_REQUEST" ? "Payment" : "Morpho"} · requested {new Date(request.created_at).toLocaleString()}{expired ? " · expired" : request.expires_at ? ` · expires ${new Date(request.expires_at).toLocaleString()}` : ""}</p>
            {!expired && !localExecution && <p className="mt-1 text-xs text-white/65">Wallet signing is not available on this host right now. Open app.hoddfinance.xyz to finish it.</p>}
          </div></div>
          <div className="flex flex-wrap items-center gap-2">{action}
            {!expired && <button onClick={() => void resolve(request.id, "DONE")} className="border border-white/20 px-3 py-2 text-xs">Mark done</button>}
            <button onClick={() => void resolve(request.id, "DISMISSED")} className="border border-white/20 px-3 py-2 text-xs text-[#ff9a92]">Dismiss</button>
          </div>
        </article>;
      })}
    </div>
    {error && <p role="alert" className="border-t border-[#ff9a92]/30 bg-[#d03b3b]/15 px-5 py-3 text-xs text-[#ff9a92]">{error}</p>}
  </SectionCard>;
}
