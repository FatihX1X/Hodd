import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

export async function createSupabaseServerClient() {
  const config = supabaseConfig();
  if (!config.ready || !config.url || !config.publishableKey) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Server Components cannot write cookies; proxy refreshes them. */ }
      },
    },
  });
}

export async function requireSupabaseUser() {
  const client = await createSupabaseServerClient();
  if (!client) return { status: "UNCONFIGURED" as const };
  const { data, error } = await client.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return { status: "UNAUTHENTICATED" as const };
  return { status: "READY" as const, client, userId };
}
