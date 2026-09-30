import { requireSupabaseUser } from "@/lib/supabase/server";
import { boundUserToken, isSameOrigin } from "@/lib/circle/user-wallet-server";

const allowed = [
  /^v1\/w3s\/wallets$/,
  /^v1\/w3s\/user\/wallets$/,
  /^v1\/w3s\/user\/transactions\/(transfer|contractExecution)$/,
  /^v1\/w3s\/user\/sign\/typedData$/,
  /^v1\/w3s\/user\/challenges\/[A-Za-z0-9-]+$/,
  /^v1\/w3s\/transactions\/[A-Za-z0-9-]+$/,
];

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (request.method !== "GET") return Response.json({ code: "SIGNER_EXECUTION_DISABLED", message: "Wallet transaction execution is not enabled." }, { status: 403 });
  const auth = await requireSupabaseUser();
  if (auth.status !== "READY") return Response.json({ code: "UNAUTHENTICATED", message: "A verified Hodd session is required." }, { status: 401 });
  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") && !isSameOrigin(request)) return Response.json({ code: "ORIGIN_MISMATCH", message: "Cross-origin wallet requests are rejected." }, { status: 403 });
  const apiKey = process.env.CIRCLE_API_KEY?.trim(); const cookieToken = await boundUserToken(auth.userId);
  if (!apiKey || !cookieToken) return Response.json({ code: "WALLET_NOT_CONFIGURED", message: "Circle wallet credentials are unavailable." }, { status: 503 });
  const headerToken = request.headers.get("x-user-token");
  if (!headerToken || headerToken !== cookieToken) return Response.json({ code: "TOKEN_MISMATCH", message: "The wallet session does not match the authenticated user." }, { status: 403 });
  const { path } = await context.params; const targetPath = path.join("/");
  if (!allowed.some((pattern) => pattern.test(targetPath))) return Response.json({ code: "ROUTE_NOT_ALLOWED", message: "This Circle route is not exposed by Hodd." }, { status: 404 });
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  const upstream = await fetch(`https://api.circle.com/${targetPath}${requestUrl.search}`, { method: request.method, headers: { Authorization: `Bearer ${apiKey}`, "X-User-Token": cookieToken, "Content-Type": request.headers.get("content-type") ?? "application/json" }, body, cache: "no-store" });
  return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
}

export const GET = forward;
export const POST = forward;
