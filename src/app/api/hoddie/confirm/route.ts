import { z } from "zod";
import { routingSchema } from "@/lib/hoddie/models";
import { hoddieContext, requireConsent, sameOrigin } from "@/lib/hoddie/security";
import { confirmChange } from "@/lib/hoddie/service";
import { errorResponse, readBody } from "@/lib/hoddie/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request); const input = z.object({ provider: routingSchema, handle: z.string().max(16000), confirmed: z.literal(true) }).strict().parse(await readBody(request));
    const context = await hoddieContext(); const consent = await requireConsent(context, input.provider);
    return Response.json(await confirmChange(context, consent, input.handle), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
