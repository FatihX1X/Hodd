import { randomUUID } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { requestSchema, resultSchema, HoddieError, type HoddieMessage, type HoddieResult } from "@/lib/hoddie/models";
import { hoddieContext, requireConsent, reserveUsage, sameOrigin, verifyReview } from "@/lib/hoddie/security";
import { parseIntent, providerAvailability } from "@/lib/hoddie/provider";
import { parseAutomaticIntent } from "@/lib/hoddie/routing";
import { maskCommand } from "@/lib/hoddie/privacy";
import { prepareChange, resolveIntent, resolveSelection } from "@/lib/hoddie/service";
import { errorResponse, readBody } from "@/lib/hoddie/http";
export const maxDuration = 60;
export function GET() { return Response.json({ status: "READY", providers: providerAvailability() }, { headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) {
  try {
    sameOrigin(request); const input = requestSchema.parse(await readBody(request));
    const context = await hoddieContext(); const consent = await requireConsent(context, input.provider);
    let result: HoddieResult;
    if (input.mode === "MESSAGE") {
      if (input.provider !== "AUTO" && !providerAvailability().find((item) => item.id === input.provider)?.ready) throw new HoddieError("PROVIDER_NOT_CONFIGURED", "This provider is awaiting its server API key and free-tier configuration.", 503);
      const command = maskCommand(input.message, context.workspace);
      const selected = input.selectionRef ? verifyReview(input.selectionRef, context, consent, "REFERENCE") : null;
      const interpreted = input.provider === "AUTO"
        ? await parseAutomaticIntent(command.text, Boolean(selected), (provider) => reserveUsage(context, provider, true), request.signal)
        : await (async () => { await reserveUsage(context, input.provider as "GEMINI" | "OPENROUTER", true); return { intent: await parseIntent(input.provider as "GEMINI" | "OPENROUTER", command.text, Boolean(selected), request.signal), provider: input.provider }; })();
      result = resultSchema.parse({ ...await resolveIntent(context, consent, interpreted.intent, command, input.timezone, selected ? String(selected.data.obligationId) : undefined), interpretedBy: interpreted.provider });
      const stream = createUIMessageStream<HoddieMessage>({ execute: ({ writer }) => { writer.write({ type: "start", messageId: randomUUID() }); writer.write({ type: "data-hoddie", data: result }); writer.write({ type: "finish" }); } });
      return createUIMessageStreamResponse({ stream, headers: { "Cache-Control": "no-store" } });
    }
    await reserveUsage(context, input.provider === "AUTO" ? "GEMINI" : input.provider, false);
    result = input.mode === "PREPARE" ? await prepareChange(context, consent, input.kind, input.change) : await resolveSelection(context, consent, input.handle);
    return Response.json({ status: "READY", result: resultSchema.parse(result) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
