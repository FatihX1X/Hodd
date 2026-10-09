import { z } from "zod";
import { changeSchemas } from "@/lib/agent/changes";

/** Changes Hoddie may propose. Payments and Morpho operations are deliberately absent: they are finished by the user in Hodd with a wallet signature. */
export const HODDIE_ACTIONS = ["CREATE_OBLIGATION", "UPDATE_OBLIGATION", "UPDATE_POLICY", "SET_TARGETS"] as const;
export type HoddieActionKind = (typeof HODDIE_ACTIONS)[number];

export const MAX_MESSAGE_CHARS = 2_000;
export const MAX_SNAPSHOT_BYTES = 40_000;

export const chatRequestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }).strict()).min(1).max(14),
  snapshot: z.record(z.string(), z.unknown()),
}).strict().refine((value) => value.messages.at(-1)?.role === "user", "The last message must be from the user.");
export type ChatRequest = z.infer<typeof chatRequestSchema>;

const label = (max: number) => z.string().trim().min(1).max(max);
/** What the model is asked to return. Anything outside this shape is dropped, never trusted. */
export const modelOutputSchema = z.object({
  reply: z.string().trim().min(1).max(4_000),
  language: z.string().trim().max(24).optional(),
  followUps: z.array(label(120)).max(3).catch([]),
  labels: z.object({ approve: label(32), decline: label(32), proposal: label(48), applied: label(32), declined: label(32), expired: label(32) }).partial().catch({}),
  action: z.object({ kind: z.enum(HODDIE_ACTIONS), change: z.record(z.string(), z.unknown()) }).nullable().catch(null),
  approvesPending: z.boolean().catch(false),
});

export type HoddieAction = Readonly<{ kind: HoddieActionKind; change: Record<string, unknown> }>;
export type HoddieModelReply = Readonly<{
  text: string; language?: string; followUps: readonly string[];
  labels: Readonly<Partial<Record<"approve" | "decline" | "proposal" | "applied" | "declined" | "expired", string>>>;
  action: HoddieAction | null; actionRejected: boolean; approvesPending: boolean;
}>;

/** Pulls the JSON object out of a model answer (models sometimes wrap it in prose or code fences). */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/** Validates a model answer. A proposed change survives only if it matches the exact schema the connector uses. */
export function parseModelOutput(raw: string): HoddieModelReply | null {
  const json = extractJson(raw);
  const parsed = modelOutputSchema.safeParse(json ?? { reply: raw.trim() });
  if (!parsed.success) return null;
  const { reply, language, followUps, labels, action, approvesPending } = parsed.data;
  let valid: HoddieAction | null = null;
  if (action) { const checked = changeSchemas[action.kind].safeParse(action.change); if (checked.success) valid = { kind: action.kind, change: action.change }; }
  return { text: reply, language, followUps, labels, action: valid, actionRejected: Boolean(action) && !valid, approvesPending };
}
