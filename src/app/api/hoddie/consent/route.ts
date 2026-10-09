import { cookies } from "next/headers";
import { z } from "zod";
import { routingSchema } from "@/lib/hoddie/models";
import { CONSENT_COOKIE, hoddieContext, newConsent, requireConsent, sameOrigin } from "@/lib/hoddie/security";
import { errorResponse, readBody } from "@/lib/hoddie/http";
export async function GET(request: Request) {
  try {
    const provider = routingSchema.parse(new URL(request.url).searchParams.get("provider")); const context = await hoddieContext();
    let allowed = false; try { await requireConsent(context, provider); allowed = true; } catch { /* permission is required */ }
    return Response.json({ status: "READY", allowed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request); const { provider } = z.object({ provider: routingSchema, allow: z.literal(true) }).strict().parse(await readBody(request));
    const context = await hoddieContext();
    (await cookies()).set(CONSENT_COOKIE, newConsent(context, provider), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/hoddie" });
    return Response.json({ status: "READY", allowed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try { sameOrigin(request); (await cookies()).delete({ name: CONSENT_COOKIE, path: "/api/hoddie" }); return Response.json({ status: "READY", allowed: false }); }
  catch (error) { return errorResponse(error); }
}
