import type { TreasuryWorkspace } from "@/lib/treasury/models";
import { HoddieError } from "./models";

export type Slot = { type: "OBLIGATION" | "AMOUNT" | "PERCENT" | "DATE" | "TEXT" | "ADDRESS" | "EMAIL"; value: string; obligationIds?: string[] };
export type MaskedCommand = { text: string; slots: Record<string, Slot> };
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Only this text crosses the LLM boundary. Slot values stay inside Hodd. */
export function maskCommand(message: string, workspace: TreasuryWorkspace): MaskedCommand {
  if (/(?:\b\d+(?:[.,]\d+)?\s*(?:BTC|ETH|EUR|TRY|USD|TL)\b|\b(?:BTC|ETH|EUR|TRY|USD|TL)\s*\d|[$€₺]\s*\d|\d\s*[$€₺])/i.test(message)) throw new HoddieError("UNSUPPORTED_CURRENCY", "Hoddie accepts explicit USDC amounts only. It does not convert currencies.");
  if (/(?<![\d\w])-\s*\d/.test(message) || /\b\d+,\d{3}\b/.test(message)) throw new HoddieError("AMBIGUOUS_AMOUNT", "Use a positive amount without thousands separators, for example 1250.50.");
  if (/\[(?:OBLIGATION|AMOUNT|PERCENT|DATE|TEXT|ADDRESS|EMAIL)\d+\]/i.test(message)) throw new HoddieError("RESERVED_INPUT", "Use ordinary text, not internal placeholder tokens.");
  if (/\b(?:AIza[\w-]{20,}|sk-[\w-]{16,}|sb_secret_[\w-]+)\b|\b0x[\da-f]{64}\b|\b(?:seed phrase|private key|entity secret|recovery phrase)\b/i.test(message)) throw new HoddieError("SENSITIVE_INPUT", "Remove credentials, private keys and recovery information before sending a command.");
  let text = message; const slots: Record<string, Slot> = {}; let counter = 0;
  const put = (slot: Slot) => { const key = `[${slot.type}${++counter}]`; slots[key] = slot; return key; };
  const replace = (pattern: RegExp, fn: (...args: string[]) => string) => {
    text = text.split(/(\[[A-Z]+\d+\])/g).map((part) => /^\[[A-Z]+\d+\]$/.test(part) ? part : part.replace(pattern, fn)).join("");
  };
  // Longest matches first. Duplicate titles remain ambiguous until the user chooses.
  const titles = [...new Set(workspace.obligations.map((item) => item.title))].filter((value) => value.length >= 2).sort((a, b) => b.length - a.length);
  for (const title of titles) replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped(title)}(?![\\p{L}\\p{N}])`, "giu"), () => put({ type: "OBLIGATION", value: title, obligationIds: workspace.obligations.filter((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase()).map((item) => item.id) }));
  const privateText = [...new Set(workspace.obligations.flatMap((item) => [item.recipient, item.description]).filter((value): value is string => Boolean(value && value.length >= 2)))].sort((a, b) => b.length - a.length);
  for (const value of privateText) replace(new RegExp(escaped(value), "giu"), () => put({ type: "TEXT", value }));
  replace(/0x[\da-f]{40}\b/gi, (value) => put({ type: "ADDRESS", value }));
  replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, (value) => put({ type: "EMAIL", value }));
  replace(/["“]([^"”\n]{1,500})["”]/g, (_match, value) => put({ type: "TEXT", value }));
  replace(/\b\d{4}-\d{2}-\d{2}\b/g, (value) => put({ type: "DATE", value }));
  replace(/%\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*%/g, (_match, before, after) => put({ type: "PERCENT", value: (before || after).replace(",", ".") }));
  replace(/\b\d+(?:[.,]\d+)?\b/g, (value) => put({ type: "AMOUNT", value: value.replace(",", ".") }));
  return { text, slots };
}

export function slotValue(command: MaskedCommand, token: string | null, type: Slot["type"]): string | undefined {
  if (!token) return undefined;
  const slot = command.slots[token];
  if (!slot || slot.type !== type) throw new HoddieError("INVALID_INTENT", "The model referred to a missing or incompatible input. Nothing was changed.");
  return slot.value;
}

export function percentageBps(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new HoddieError("INVALID_PERCENTAGE", "Use a percentage with at most two decimals.");
  const result = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (result > 100000n) throw new HoddieError("INVALID_PERCENTAGE", "The percentage is too large.");
  return Number(result);
}

export function dueDate(mode: "NONE" | "TODAY" | "TOMORROW" | "EXPLICIT", explicit: string | undefined, timezone: string, now = new Date()): string | undefined {
  if (mode === "NONE") return undefined;
  if (mode === "EXPLICIT") {
    if (!explicit || !/^\d{4}-\d{2}-\d{2}$/.test(explicit) || !Number.isFinite(Date.parse(`${explicit}T12:00:00Z`)) || new Date(`${explicit}T12:00:00Z`).toISOString().slice(0, 10) !== explicit) throw new HoddieError("INVALID_DATE", "Enter a valid YYYY-MM-DD date.");
    return explicit;
  }
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); }
  catch { throw new HoddieError("INVALID_TIMEZONE", "Your browser timezone is unavailable."); }
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  const date = new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00Z`);
  if (mode === "TOMORROW") date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
