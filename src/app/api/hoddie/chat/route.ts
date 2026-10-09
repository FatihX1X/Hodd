import { randomUUID } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { requestSchema, resultSchema, HoddieError, type HoddieMessage, type HoddieResult } from "@/lib/hoddie/models";
import { hoddieContext, requireConsent, reserveUsage, sameOrigin, verifyReview } from "@/lib/hoddie/security";
import { parseIntent, providerAvailability } from "@/lib/hoddie/provider";
import { parseAutomaticIntent } from "@/lib/hoddie/routing";
import { maskCommand } from "@/lib/hoddie/privacy";
import { prepareChange, resolveIntent, resolveSelection } from "@/lib/hoddie/service";
import { errorResponse, readBody } from "@/lib/hoddie/http";
import { canAnswerInstantly, questionLanguage } from "@/lib/hoddie/answers";
import { deterministicResult } from "@/lib/hoddie/deterministic";
import { liveWorkspace } from "@/lib/agent/context";
import { assessTreasury } from "@/lib/treasury/engine";
export const maxDuration = 60;
export function GET() { return Response.json({ status: "READY", providers: providerAvailability() }, { headers: { "Cache-Control": "no-store" } }); }
function reply(result: HoddieResult) {
  const stream = createUIMessageStream<HoddieMessage>({ execute: ({ writer }) => { writer.write({ type: "start", messageId: randomUUID() }); writer.write({ type: "data-hoddie", data: resultSchema.parse(result) }); writer.write({ type: "finish" }); } });
  return createUIMessageStreamResponse({ stream, headers: { "Cache-Control": "no-store" } });
}
async function basic(context: Awaited<ReturnType<typeof hoddieContext>>, question: string) {
  const now = new Date();
  const live = await liveWorkspace(context.workspace);
  return deterministicResult({ question, workspace: live.workspace, assessment: live.source === "PARTIAL" ? null : assessTreasury(live.workspace, now), evaluatedAt: now }, live.source);
}
export async function POST(request: Request) {
  try {
    sameOrigin(request); const input = requestSchema.parse(await readBody(request));
    const context = await hoddieContext();
    if (input.mode === "MESSAGE" && canAnswerInstantly(input.message)) return reply(await basic(context, input.message));
    let consent;
    try { consent = await requireConsent(context, input.provider); }
    catch (error) {
      if (input.mode === "MESSAGE" && error instanceof HoddieError && error.code === "CONSENT_REQUIRED") return reply(await basic(context, input.message));
      throw error;
    }
    let result: HoddieResult;
    if (input.mode === "MESSAGE") {
      if (!providerAvailability().some((item) => item.ready && (input.provider === "AUTO" || item.id === input.provider))) return reply(await basic(context, input.message));
      const command = maskCommand(input.message, context.workspace);
      const selected = input.selectionRef ? verifyReview(input.selectionRef, context, consent, "REFERENCE") : null;
      let interpreted;
      try { interpreted = input.provider === "AUTO"
        ? await parseAutomaticIntent(command.text, Boolean(selected), (provider) => reserveUsage(context, provider, true), request.signal)
        : await (async () => { await reserveUsage(context, input.provider as "GEMINI" | "OPENROUTER", true); return { intent: await parseIntent(input.provider as "GEMINI" | "OPENROUTER", command.text, Boolean(selected), request.signal), provider: input.provider }; })(); }
      catch (error) {
        if (!request.signal.aborted && error instanceof HoddieError && ["MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "PROVIDER_NOT_CONFIGURED"].includes(error.code)) return reply(await basic(context, input.message));
        throw error;
      }
      result = resultSchema.parse({ ...await resolveIntent(context, consent, { ...interpreted.intent, language: questionLanguage(input.message) }, command, input.timezone, selected ? String(selected.data.obligationId) : undefined), interpretedBy: interpreted.provider });
      return reply(result);
    }
    await reserveUsage(context, input.provider === "AUTO" ? "GEMINI" : input.provider, false);
    result = input.mode === "PREPARE" ? await prepareChange(context, consent, input.kind, input.change) : await resolveSelection(context, consent, input.handle);
    return Response.json({ status: "READY", result: resultSchema.parse(result) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
