import { cookies } from "next/headers";
import { circleErrorCode, circleUserWalletClient, isSameOrigin, sessionBinding, UCW_BINDING_COOKIE, UCW_ENCRYPTION_COOKIE, UCW_TOKEN_COOKIE } from "@/lib/circle/user-wallet-server";
import { createSupabaseServerClient, requireSupabaseUser } from "@/lib/supabase/server";
import { requestHostOrigin } from "@/lib/earn/access-policy";
import { EarnAccessError, hostExecutionMode } from "@/lib/earn/security";
import { reserveLiveUsage } from "@/lib/execution/live-readiness";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ status: "ERROR", message: "Same-origin request required." }, { status: 403 });
  const auth = await requireSupabaseUser();
  if (auth.status !== "READY") return Response.json({ status: "ERROR", code: auth.status, message: auth.status === "UNCONFIGURED" ? "Supabase is not configured." : "Sign in before creating an embedded wallet." }, { status: auth.status === "UNCONFIGURED" ? 503 : 401 });
  // Each session costs Circle API calls; the public demo counts them per user.
  const mode = await hostExecutionMode(requestHostOrigin(request).hostname);
  const supabase = mode === "TESTNET_LIVE" ? await createSupabaseServerClient() : null;
  if (supabase) {
    try { await reserveLiveUsage(supabase, mode, "CIRCLE_SESSION"); }
    catch (error) { const known = error instanceof EarnAccessError; return Response.json({ status: "ERROR", code: known ? error.code : "USAGE_UNAVAILABLE", message: known ? error.message : "Try again shortly." }, { status: known ? error.status : 503 }); }
  }
  const client = circleUserWalletClient();
  if (!client) return Response.json({ status: "ERROR", code: "CIRCLE_NOT_CONFIGURED", message: "Circle User-Controlled Wallets is not configured." }, { status: 503 });
  try {
    try { await client.createUser({ userId: auth.userId }); }
    catch (error) { if (circleErrorCode(error) !== 155101 && circleErrorCode(error) !== 155106) throw error; }
    const response = await client.createUserToken({ userId: auth.userId });
    const userToken = response.data?.userToken;
    const encryptionKey = response.data?.encryptionKey;
    if (!userToken || !encryptionKey) throw new Error("Circle did not return session credentials");
    const store = await cookies();
    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 55 * 60 };
    store.set(UCW_TOKEN_COOKIE, userToken, options); store.set(UCW_ENCRYPTION_COOKIE, encryptionKey, options);
    store.set(UCW_BINDING_COOKIE, sessionBinding(auth.userId, userToken), options);
    return Response.json({ status: "READY", userToken, encryptionKey }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ status: "ERROR", code: "CIRCLE_SESSION_FAILED", message: "The embedded wallet session could not be created." }, { status: 502 }); }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ status: "ERROR" }, { status: 403 });
  const store = await cookies();
  for (const name of [UCW_TOKEN_COOKIE, UCW_ENCRYPTION_COOKIE, UCW_BINDING_COOKIE]) store.delete(name);
  return Response.json({ status: "CLEARED" }, { headers: { "Cache-Control": "no-store" } });
}
