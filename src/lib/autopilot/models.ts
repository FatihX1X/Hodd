import { z } from "zod";
import type { TreasuryPolicy } from "@/lib/treasury/models";

export const AGENT_MAX_BUDGET_MINOR = 1_000_000_000n;
const minor = z.string().regex(/^(0|[1-9]\d{0,15})$/);
export const mandateSchema = z.object({
  budgetMinor: minor, maxMorphoBps: z.number().int().min(0).max(10_000),
  reserveMinor: minor, maxPerRunMinor: minor, enabled: z.boolean(), paused: z.boolean(),
  /** The owner lets the LLM advisor adjust decisions inside the engine's limits (off when absent). */
  advisorEnabled: z.boolean().optional(),
}).strict();
export type Mandate = z.infer<typeof mandateSchema>;
export function validateMandate(input: unknown, policy: TreasuryPolicy): Mandate {
  const m = mandateSchema.parse(input);
  if (BigInt(m.budgetMinor) <= 0n || BigInt(m.budgetMinor) > AGENT_MAX_BUDGET_MINOR || BigInt(m.reserveMinor) > BigInt(m.budgetMinor) || BigInt(m.maxPerRunMinor) <= 0n || BigInt(m.maxPerRunMinor) > BigInt(m.budgetMinor)) throw new Error("INVALID_MANDATE_LIMITS");
  if (m.maxMorphoBps > policy.strategyCapsBps.MORPHO || (m.maxMorphoBps > 0 && !policy.enabledStrategies.MORPHO)) throw new Error("MANDATE_EXCEEDS_POLICY");
  return m;
}
export const agentWalletSchema = z.object({ user_id: z.string().uuid(), circle_wallet_id: z.string().uuid(), wallet_set_id: z.string().uuid(), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), account_type: z.enum(["EOA", "SCA"]), owner_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });
export type AgentWallet = z.infer<typeof agentWalletSchema>;
export const runStatusSchema = z.enum(["RUNNING", "NO_ACTION", "COMPLETED", "PARTIAL", "FAILED", "UNKNOWN"]);
export type RunStatus = z.infer<typeof runStatusSchema>;
export const decisionKindSchema = z.enum(["INVEST", "LIQUIDITY_TOP_UP", "RESERVE_REFILL", "RETURN_ALL", "NO_ACTION", "DE_RISK"]);
export const advisorActionSchema = z.enum(["FOLLOW", "REDUCE", "WAIT", "DE_RISK"]);
/**
 * What the LLM advisor did to a run. The engine's own decision is always kept beside it. APPLIED: the advice changed
 * the decision; FOLLOWED: the advice kept it; REJECTED: the advice broke a limit and the engine decided; UNAVAILABLE:
 * no model answer (the engine decided).
 */
export const advisorRecordSchema = z.object({
  status: z.enum(["APPLIED", "FOLLOWED", "REJECTED", "UNAVAILABLE"]), action: advisorActionSchema.nullable(),
  provider: z.string().nullable(), model: z.string().nullable(), rationale: z.string().max(600),
  engine: z.object({ kind: decisionKindSchema, depositMinor: minor, withdrawMinor: minor, transferMinor: minor, explanation: z.string() }),
});
export type AdvisorRecord = z.infer<typeof advisorRecordSchema>;
export const decisionSchema = z.object({ kind: decisionKindSchema, depositMinor: minor, withdrawMinor: minor, transferMinor: minor, remainingBudgetMinor: minor, protectedMinor: minor, explanation: z.string(), advisor: advisorRecordSchema.optional() });
export type Decision = z.infer<typeof decisionSchema>;
