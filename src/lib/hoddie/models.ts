import { z } from "zod";
import type { UIMessage } from "ai";

export const providerSchema = z.enum(["GEMINI", "OPENROUTER"]);
export type HoddieProvider = z.infer<typeof providerSchema>;
export const routingSchema = z.enum(["AUTO", "GEMINI", "OPENROUTER"]);
export type HoddieRouting = z.infer<typeof routingSchema>;
export const kindSchema = z.enum(["CREATE_OBLIGATION", "UPDATE_OBLIGATION", "UPDATE_POLICY", "SET_TARGETS", "PAYMENT_REQUEST", "EARN_REQUEST"]);
export const routeSchema = z.enum(["/", "/invest", "/obligations", "/activity", "/connections"]);
const token = z.string().regex(/^\[[A-Z]+\d+\]$/).nullable();
/** No output field can contain an amount, address, SQL, approval or arbitrary tool name. */
export const intentSchema = z.object({
  action: z.enum(["OVERVIEW", "OBLIGATIONS", "ACTIVITY", "PAYMENTS", "POLICY", "ALLOCATION", "VAULTS", "CHECK_PAYMENT", "NAVIGATE", "CREATE_OBLIGATION", "UPDATE_OBLIGATION", "UPDATE_POLICY", "SET_TARGETS", "PAYMENT_REQUEST", "EARN_REQUEST", "HELP"]),
  language: z.enum(["en", "tr"]),
  obligationToken: token, amountToken: token, titleToken: token, dateToken: token, addressToken: token,
  dateMode: z.enum(["NONE", "TODAY", "TOMORROW", "EXPLICIT"]),
  useCurrentSelection: z.boolean(),
  status: z.enum(["UPCOMING", "DRAFT", "PAID", "OVERDUE"]).nullable(),
  policyField: z.enum(["SAFETY_BUFFER", "MIN_COVERAGE", "STRATEGY_CAP", "ENABLED_STRATEGY"]).nullable(),
  strategy: z.enum(["LIQUID", "MORPHO", "USYC", "BTC_RESERVE"]).nullable(),
  enabled: z.boolean().nullable(),
  percentToken: token,
  targets: z.array(z.object({ strategy: z.enum(["LIQUID", "MORPHO", "USYC", "BTC_RESERVE"]), percentToken: z.string().regex(/^\[[A-Z]+\d+\]$/) })).max(4),
  operation: z.enum(["DEPOSIT", "WITHDRAW", "REDEEM_ALL"]).nullable(),
  route: routeSchema.nullable(),
}).strict();
export type HoddieIntent = z.infer<typeof intentSchema>;
export const cardSchema = z.object({ title: z.string(), fields: z.array(z.object({ label: z.string(), value: z.string() })), status: z.string().optional() });
export const draftSchema = z.object({ kind: kindSchema, values: z.record(z.string(), z.unknown()) });
export const proposalSchema = z.object({ handle: z.string(), kind: kindSchema, summary: z.string(), lines: z.array(z.string()), expiresAt: z.string().datetime(), impact: z.array(z.object({ label: z.string(), before: z.string(), after: z.string() })) });
export const resultSchema = z.object({
  message: z.string(), language: z.enum(["en", "tr"]), cards: z.array(cardSchema),
  source: z.enum(["LIVE", "NOT_CONNECTED", "PARTIAL"]).optional(), observedAt: z.string().optional(),
  proposal: proposalSchema.optional(), draft: draftSchema.optional(),
  choices: z.array(z.object({ label: z.string(), handle: z.string() })).optional(),
  selectionRef: z.string().optional(), navigation: routeSchema.optional(),
  interpretedBy: providerSchema.optional(),
});
export type HoddieResult = z.infer<typeof resultSchema>;
export type HoddieMessage = UIMessage<unknown, { hoddie: HoddieResult }>;
export const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("MESSAGE"), provider: routingSchema, message: z.string().trim().min(1).max(2000), timezone: z.string().max(100).default("UTC"), selectionRef: z.string().max(16000).optional() }).strict(),
  z.object({ mode: z.literal("PREPARE"), provider: routingSchema, kind: kindSchema, change: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ mode: z.literal("SELECT"), provider: routingSchema, handle: z.string().max(16000) }).strict(),
]);
export class HoddieError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
