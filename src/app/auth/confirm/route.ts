import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const client = await createSupabaseServerClient();
  if (!client || !tokenHash || url.searchParams.get("type") !== "email") return NextResponse.redirect(new URL("/login?error=invalid_confirmation", url.origin));
  const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  return NextResponse.redirect(new URL(error ? "/login?error=confirmation_failed" : "/", url.origin));
}
