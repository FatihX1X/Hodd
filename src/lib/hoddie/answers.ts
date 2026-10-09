/**
 * Hoddie answers questions about the treasury from the same inputs the Treasury Engine uses.
 * Everything here is read-only: it formats engine and view output and never creates, changes
 * or authorizes anything. The chat UI depends only on `HoddieReply`, so another source of
 * replies (for example a server route) can be plugged in without touching the interface.
 */
import { assessPayment, getProtectedObligations } from "@/lib/treasury/engine";
import { formatDate, formatMoney, formatPercentFromBps } from "@/lib/treasury/format";
import type { Obligation, TreasuryAssessment, TreasuryWorkspace } from "@/lib/treasury/models";
import { policyChecks, policySentences, runwayProjection, strategyLabels, usdcNumber } from "@/lib/treasury/views";

export type HoddieTone = "success" | "warning" | "danger" | "info" | "neutral";
export type HoddieReply = Readonly<{
  paragraphs: readonly string[];
  facts?: readonly { label: string; value: string }[];
  status?: Readonly<{ label: string; tone: HoddieTone }>;
  sources: readonly { label: string; href: string }[];
  followUps: readonly string[];
}>;
export type HoddieContext = Readonly<{ question: string; workspace: TreasuryWorkspace; assessment: TreasuryAssessment | null; evaluatedAt: Date }>;

export const starterPrompts = [
  "Can I pay the next bill?",
  "What is due in the next 30 days?",
  "How long does my cash last?",
  "How much can I put to work?",
] as const;

const src = {
  overview: { label: "Overview", href: "/" },
  obligations: { label: "Obligations", href: "/obligations" },
  strategies: { label: "Strategies", href: "/invest" },
  policy: { label: "Policy", href: "/policy" },
  activity: { label: "Activity", href: "/activity" },
} as const;

const shortDate = (iso: string) => formatDate(iso, { year: undefined, month: "short", day: "numeric" });
const dayLabel = (ms: number) => shortDate(new Date(ms).toISOString());
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9#\s]/g, " ").split(/\s+/).filter(Boolean);
const has = (text: string, pattern: RegExp) => pattern.test(text);

/** The obligation a question names, if any: every meaningful word of its title appears in the question. */
function findObligation(question: string, obligations: readonly Obligation[]) {
  const asked = new Set(words(question));
  return obligations.find((item) => {
    const tokens = words(item.title).filter((token) => token.length > 2 || /\d/.test(token));
    return tokens.length > 0 && tokens.every((token) => asked.has(token));
  });
}

function paymentAnswer(ctx: HoddieContext, obligation: Obligation | undefined): HoddieReply {
  const { workspace, evaluatedAt } = ctx;
  const target = obligation ?? getProtectedObligations(workspace, evaluatedAt)[0];
  if (!target) return { paragraphs: ["Nothing is due inside the 30-day horizon, so there is no payment to check."], sources: [src.obligations], followUps: ["What is due in the next 30 days?"] };
  const plan = assessPayment(workspace, target.id, evaluatedAt);
  const head = `${target.title} · ${formatMoney(target.amount)} · due ${shortDate(target.dueAt)}`;
  if (!plan) {
    const reason = target.status === "PAID" ? "It is already marked paid." : target.status === "DRAFT" ? "It is a draft, so it is not part of the protected total yet." : "It is outside the 30-day horizon or already reserved for an approved payment.";
    return { paragraphs: [`${head}. ${reason}`], status: { label: target.status, tone: "neutral" }, sources: [src.obligations], followUps: ["What is due in the next 30 days?"] };
  }
  const safe = plan.status === "SAFE";
  return {
    paragraphs: [safe ? `Yes. ${target.title} is covered after earlier obligations and the safety buffer are set aside.` : `Not in full. After earlier obligations and the safety buffer, ${target.title} is short by ${formatMoney(plan.shortfall)}.`],
    facts: [
      { label: "Amount", value: formatMoney(target.amount) },
      { label: "Due", value: shortDate(target.dueAt) },
      { label: "Available after reserves", value: formatMoney(plan.availableAfterReserves) },
      ...(safe ? [] : [{ label: "Shortfall", value: formatMoney(plan.shortfall) }]),
    ],
    status: { label: plan.status, tone: safe ? "success" : "danger" },
    sources: [src.obligations],
    followUps: ["How long does my cash last?", "What does my policy say?"],
  };
}

function dueAnswer(ctx: HoddieContext): HoddieReply {
  const upcoming = getProtectedObligations(ctx.workspace, ctx.evaluatedAt);
  if (upcoming.length === 0) return { paragraphs: ["Nothing is due inside the 30-day horizon."], sources: [src.obligations], followUps: ["How long does my cash last?"] };
  const total = ctx.assessment ? formatMoney(ctx.assessment.upcomingObligations) : null;
  return {
    paragraphs: [`${upcoming.length} ${upcoming.length === 1 ? "obligation is" : "obligations are"} protected over the next ${ctx.workspace.policy.obligationHorizonDays} days${total ? `, ${total} in total` : ""}.`],
    facts: upcoming.slice(0, 5).map((item) => ({ label: `${shortDate(item.dueAt)} · ${item.title}`, value: formatMoney(item.amount) })),
    sources: [src.obligations],
    followUps: ["Can I pay the next bill?", "Is anything overdue?"],
  };
}

function overdueAnswer(ctx: HoddieContext): HoddieReply {
  const overdue = ctx.workspace.obligations.filter((item) => item.status === "OVERDUE" || (item.status === "UPCOMING" && Date.parse(item.dueAt) < ctx.evaluatedAt.getTime()));
  if (overdue.length === 0) return { paragraphs: ["Nothing is overdue."], status: { label: "ON TIME", tone: "success" }, sources: [src.obligations], followUps: ["What is due in the next 30 days?"] };
  return {
    paragraphs: [`${overdue.length} ${overdue.length === 1 ? "obligation is" : "obligations are"} past its due date and still unpaid.`],
    facts: overdue.map((item) => ({ label: `${shortDate(item.dueAt)} · ${item.title}`, value: formatMoney(item.amount) })),
    status: { label: "OVERDUE", tone: "danger" },
    sources: [src.obligations],
    followUps: ["Can I pay the next bill?"],
  };
}

function runwayAnswer(ctx: HoddieContext): HoddieReply {
  const series = runwayProjection(ctx.workspace, ctx.evaluatedAt);
  const end = series.points[series.points.length - 1];
  const fixed = (value: number) => `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
  const belowZero = series.points.find((point) => point.day === series.firstBelowZeroDay);
  const belowBuffer = series.points.find((point) => point.day === series.firstBelowBufferDay);
  const verdict = belowZero ? `The balance falls below zero on ${dayLabel(belowZero.at)} if nothing changes.` : belowBuffer ? `The balance dips below the safety buffer on ${dayLabel(belowBuffer.at)}.` : `The balance stays above the safety buffer for the full ${series.horizonDays} days.`;
  return {
    paragraphs: [verdict, "This is a projection from current balances and scheduled obligations. It includes no yield and no new inflows."],
    facts: [
      { label: "Today", value: fixed(series.start) },
      { label: `After ${series.horizonDays} days`, value: fixed(end.value) },
      { label: "Safety buffer", value: fixed(series.buffer) },
    ],
    status: belowZero ? { label: "BELOW ZERO", tone: "danger" } : belowBuffer ? { label: "BELOW BUFFER", tone: "warning" } : { label: "ABOVE BUFFER", tone: "success" },
    sources: [src.overview, src.obligations],
    followUps: ["What is due in the next 30 days?", "What does my policy say?"],
  };
}

function balanceAnswer(ctx: HoddieContext): HoddieReply {
  const { workspace, assessment } = ctx;
  return {
    paragraphs: [`Your treasury holds ${formatMoney(workspace.totalTreasury)}, of which ${formatMoney(workspace.liquidUsdc)} is liquid USDC.`],
    facts: [
      { label: "Total treasury", value: formatMoney(workspace.totalTreasury) },
      { label: "Liquid USDC", value: formatMoney(workspace.liquidUsdc) },
      ...(assessment ? [{ label: "Protected capital", value: formatMoney(assessment.protectedCapital) }, { label: "Deployable capital", value: formatMoney(assessment.deployableCapital) }] : []),
    ],
    sources: [src.overview],
    followUps: ["How much can I put to work?", "How long does my cash last?"],
  };
}

function deployAnswer(ctx: HoddieContext): HoddieReply {
  const { workspace, assessment } = ctx;
  if (!assessment) return { paragraphs: ["Deployable capital is paused until a verified balance is available."], sources: [src.strategies], followUps: [] };
  const morpho = workspace.strategies.find((strategy) => strategy.kind === "MORPHO");
  const enabled = workspace.policy.enabledStrategies.MORPHO;
  const deployable = usdcNumber(assessment.deployableCapital);
  return {
    paragraphs: [
      deployable > 0 ? `${formatMoney(assessment.deployableCapital)} is deployable after obligations, the safety buffer and pending transactions are protected.` : "Nothing is deployable right now. Obligations and the safety buffer use all available capital.",
      "I cannot deploy capital. Open Strategies to review a plan and approve it with your own wallet.",
    ],
    facts: [
      { label: "Deployable capital", value: formatMoney(assessment.deployableCapital) },
      { label: `${strategyLabels.MORPHO} cap`, value: enabled ? formatPercentFromBps(workspace.policy.strategyCapsBps.MORPHO) : "Disabled" },
      ...(morpho?.apyBps != null ? [{ label: `${strategyLabels.MORPHO} APY`, value: formatPercentFromBps(morpho.apyBps, 2) }] : []),
    ],
    sources: [src.strategies, src.policy],
    followUps: ["What does my policy say?"],
  };
}

function policyAnswer(ctx: HoddieContext): HoddieReply {
  const sentences = policySentences(ctx.workspace.policy);
  const checks = ctx.assessment ? policyChecks(ctx.workspace, ctx.assessment) : [];
  const attention = checks.filter((check) => check.status === "ATTENTION");
  return {
    paragraphs: [...sentences.slice(0, 3), attention.length === 0 ? "All current checks pass." : `${attention.length} ${attention.length === 1 ? "check needs" : "checks need"} attention: ${attention.map((check) => check.title.toLowerCase()).join(", ")}.`],
    status: checks.length === 0 ? undefined : attention.length === 0 ? { label: "ALL CHECKS PASS", tone: "success" } : { label: "ATTENTION", tone: "danger" },
    sources: [src.policy],
    followUps: ["How long does my cash last?"],
  };
}

function activityAnswer(ctx: HoddieContext): HoddieReply {
  const recent = ctx.workspace.activities.slice(0, 3);
  if (recent.length === 0) return { paragraphs: ["There is no recorded activity yet."], sources: [src.activity], followUps: [] };
  return {
    paragraphs: ["Here are the latest records. Local audit records are not proof of an onchain payment."],
    facts: recent.map((entry) => ({ label: `${shortDate(entry.occurredAt)} · ${entry.actor}`, value: entry.action })),
    sources: [src.activity],
    followUps: ["What does my policy say?"],
  };
}

function refusal(): HoddieReply {
  return {
    paragraphs: ["I can read your treasury, but I cannot change it or move funds. Edits and payments happen on their own pages, and every payment needs your wallet signature."],
    sources: [src.obligations, src.policy, src.strategies],
    followUps: ["Can I pay the next bill?", "What is due in the next 30 days?"],
  };
}

function helpAnswer(prefix = "I can answer questions about your treasury."): HoddieReply {
  return {
    paragraphs: [`${prefix} Try asking about a bill, your runway, what is deployable, or your policy.`],
    sources: [src.overview],
    followUps: [...starterPrompts],
  };
}

export function answerQuestion(ctx: HoddieContext): HoddieReply {
  const question = ctx.question.trim().toLowerCase();
  if (!question) return helpAnswer();
  if (!ctx.assessment) return { paragraphs: ["Treasury figures are paused until the linked Arc Testnet balance is verified, so I cannot answer from stale data."], status: { label: "PAUSED", tone: "danger" }, sources: [src.overview], followUps: [] };

  const asking = has(question, /^(can|could|will|would|do|does|is|are|what|how|when|which|why|am)\b/);
  const named = findObligation(question, ctx.workspace.obligations);
  if (has(question, /\b(can|could|am)\b.*\b(i|we)\b.*\b(pay|afford|cover|make)\b|\bafford\b|\benough\b.*\b(pay|cover)\b/) || (named && has(question, /\b(pay|cover|afford|covered|safe)\b/))) return paymentAnswer(ctx, named);
  if (!asking && has(question, /\b(create|add|delete|remove|update|change|edit|set|transfer|send|deposit|withdraw|approve|execute|pay|move|buy|sell)\b/)) return refusal();
  if (has(question, /\b(runway|run out|forecast|projection|cash flow|how long)\b/)) return runwayAnswer(ctx);
  if (has(question, /\b(overdue|late|past due|missed)\b/)) return overdueAnswer(ctx);
  if (has(question, /\b(deploy|deployable|invest|yield|earn|allocate|allocation|strateg\w*|morpho|apy|put to work)\b/)) return deployAnswer(ctx);
  if (has(question, /\b(polic\w*|rules?|buffer|coverage|limits?|caps?|guardrails?)\b/)) return policyAnswer(ctx);
  if (has(question, /\b(activity|history|happened|recent|log|audit|decisions?)\b/)) return activityAnswer(ctx);
  if (named) return paymentAnswer(ctx, named);
  if (has(question, /\b(due|bills?|obligations?|upcoming|payments?|owe|next)\b/)) return has(question, /\bnext\b/) && !has(question, /\b(days|week|month|bills|obligations|payments)\b/) ? paymentAnswer(ctx, undefined) : dueAnswer(ctx);
  if (has(question, /\b(balance|how much|total|treasury|cash|liquid|funds|money|worth|usdc)\b/)) return balanceAnswer(ctx);
  if (has(question, /^(hi|hello|hey|help|what can you|who are you)\b/)) return helpAnswer("Hi, I am Hoddie.");
  return helpAnswer("I did not catch that.");
}
