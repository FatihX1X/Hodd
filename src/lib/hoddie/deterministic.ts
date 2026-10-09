import { answerQuestion, questionLanguage, type HoddieContext } from "./answers";
import type { HoddieResult } from "./models";
import { assessTreasury } from "@/lib/treasury/engine";
import type { TreasuryAssessment, TreasuryWorkspace } from "@/lib/treasury/models";

/** Disconnected live accounts never inherit sample or persisted balances. */
export function answerContext(question: string, workspace: TreasuryWorkspace, operational: TreasuryWorkspace | null, assessment: TreasuryAssessment | null, demo: boolean, evaluatedAt = new Date()): HoddieContext {
  if (demo) return { question, workspace, assessment: assessTreasury(workspace, evaluatedAt), evaluatedAt };
  if (!workspace.walletConnection) {
    const zero = { ...workspace.liquidUsdc, minorUnits: "0" };
    const empty = { ...workspace, totalTreasury: zero, liquidUsdc: zero, pendingTransactions: zero, strategies: workspace.strategies.map((strategy) => ({ ...strategy, balance: zero, redeemable: zero })) };
    return { question, workspace: empty, assessment: assessTreasury(empty, evaluatedAt), evaluatedAt };
  }
  return { question, workspace: operational ?? workspace, assessment: operational && assessment ? assessTreasury(operational, evaluatedAt) : null, evaluatedAt };
}

export function deterministicResult(context: HoddieContext, source: HoddieResult["source"]): HoddieResult {
  const reply = answerQuestion(context);
  const language = questionLanguage(context.question);
  return {
    language, message: reply.paragraphs.join("\n\n"), source, observedAt: context.evaluatedAt.toISOString(),
    cards: reply.facts?.length ? [{ title: language === "tr" ? "Hazine verileri" : "Treasury facts", fields: [...reply.facts] }] : [],
    status: reply.status, sources: [...reply.sources], followUps: [...reply.followUps],
  };
}
