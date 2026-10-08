import { NextResponse, type NextRequest } from "next/server";
import { APP_ORIGIN, isMarketingAsset, siteForHost } from "@/lib/site/hosts";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (siteForHost(request.headers.get("host")) === "marketing") {
    if (pathname === "/") return NextResponse.rewrite(new URL("/landing", request.url));
    if (pathname === "/landing") return NextResponse.redirect(new URL("/", request.url), 308);
    if (isMarketingAsset(pathname)) return NextResponse.next();
    // The marketing host never exposes API routes or console pages: send people to the app host.
    if (pathname === "/api" || pathname.startsWith("/api/")) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.redirect(`${APP_ORIGIN}${pathname}${search}`, 308);
  }

  return updateSupabaseSession(request);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
