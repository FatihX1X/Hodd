import "server-only";
import { paymentAdmin } from "@/lib/payments/admin";
import { agentWalletSchema, type Decision, type Mandate, type RunStatus } from "./models";
import type { EarnQuote } from "@/lib/earn/models";
import type { EarnCall, EarnStage } from "@/lib/earn/router";
import type { StepState } from "./state";
export const agentDb = paymentAdmin;
export interface AgentRun { id: string; user_id: string; state: RunStatus; snapshot: Record<string,unknown>; decision: Decision; quote: EarnQuote | null; return_all: boolean; created_at: string; failure: string | null; }
export interface AgentStep { id: string; run_id: string; user_id: string; state: StepState; stage: EarnStage | "TRANSFER"; call: EarnCall; gas_limit: string; gas_price_wei: string; started_block: string; circle_transaction_id: string | null; tx_hash: string | null; receipt: Record<string,unknown> | null; amount_minor: string; }
export async function loadWallet(userId: string) {
  const {data,error} = await agentDb().from("agent_wallets").select("*").eq("user_id",userId).maybeSingle();
  if (error) throw new Error("AGENT_SCHEMA_UNAVAILABLE");
  return data ? agentWalletSchema.parse(data) : null;
}
export async function loadMandate(userId: string): Promise<{mandate: Mandate; revision: number; spent_minor: string; return_requested: boolean} | null> {
  const {data,error} = await agentDb().from("agent_mandates").select("*").eq("user_id",userId).maybeSingle();
  if (error) throw new Error("AGENT_SCHEMA_UNAVAILABLE"); return data ? {...data,spent_minor:String(data.spent_minor)} : null;
}
export async function openRun(userId: string): Promise<AgentRun | null> {
  const {data,error}=await agentDb().from("agent_runs").select("*").eq("user_id",userId).in("state",["RUNNING","UNKNOWN"]).maybeSingle();
  if(error)throw new Error("AGENT_STATUS_UNAVAILABLE");return data;
}
export async function patchRun(run: AgentRun, state: RunStatus, failure: string | null = null) {
  const {error}=await agentDb().from("agent_runs").update({state,failure,updated_at:new Date().toISOString()}).eq("id",run.id).eq("user_id",run.user_id);
  if(error)throw new Error("AGENT_STORE_UNAVAILABLE"); return {...run,state,failure};
}
export async function patchStep(step: AgentStep, patch: Partial<AgentStep>) {
  const {data,error}=await agentDb().from("agent_run_steps").update(patch).eq("id",step.id).eq("state",step.state).select("*").maybeSingle();
  if(error || !data)throw new Error("AGENT_STEP_CHANGED");return data as AgentStep;
}
