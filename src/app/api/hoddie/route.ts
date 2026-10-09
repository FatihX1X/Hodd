import { publicOrigin } from "@/lib/agent/origin";
import { askLanguageService } from "@/lib/hoddie/providers";
import { allowRequest } from "@/lib/hoddie/rate-limit";
import { chatRequestSchema, MAX_SNAPSHOT_BYTES } from "@/lib/hoddie/schema";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
const fail = (code: string, status: number) => Response.json({ status: "ERROR", code }, { status, headers });

/**
 * Hoddie's language service. It only turns a question plus a read-only workspace summary into a
 * reply and, at most, one *proposed* change. Nothing is applied here: the browser shows the
 * proposal and applies it only after the user approves.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin(request)) return fail("FORBIDDEN_ORIGIN", 403);

  const user = await requireSupabaseUser();
  // Local development without Supabase may use the assistant; any deployed host needs a signed-in user.
  if (user.status === "UNAUTHENTICATED" || (user.status === "UNCONFIGURED" && process.env.NODE_ENV === "production")) return fail("SIGN_IN_REQUIRED", 401);
  if (!allowRequest(user.status === "READY" ? user.userId : request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local")) return fail("RATE_LIMITED", 429);

  const text = await request.text();
  if (text.length > MAX_SNAPSHOT_BYTES + 30_000) return fail("TOO_LARGE", 413);
  let body: unknown; try { body = JSON.parse(text); } catch { return fail("INVALID_REQUEST", 400); }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success || JSON.stringify(parsed.data.snapshot).length > MAX_SNAPSHOT_BYTES) return fail("INVALID_REQUEST", 400);

  try {
    const reply = await askLanguageService(parsed.data);
    return Response.json({ status: "READY", reply }, { headers });
  } catch {
    return fail("UNAVAILABLE", 503);
  }
}
