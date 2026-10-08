import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AFTER_LOGIN_COOKIE, safeAfterLogin } from "@/lib/agent/after-login";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  const client = await createSupabaseServerClient();
  if (!client || !code) return NextResponse.redirect(new URL("/login?error=auth_unavailable", url.origin));
  const { error } = await client.auth.exchangeCodeForSession(code);
  // A pending Claude connection consent resumes after sign-in.
  const resume = error ? null : safeAfterLogin(request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${AFTER_LOGIN_COOKIE}=([^;]*)`))?.[1]);
  const response = NextResponse.redirect(new URL(error ? "/login?error=callback_failed" : resume ?? safeNext, url.origin));
  if (resume) response.cookies.delete(AFTER_LOGIN_COOKIE);
  return response;
}
