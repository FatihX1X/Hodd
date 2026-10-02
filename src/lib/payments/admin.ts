import "server-only";
import { createClient } from "@supabase/supabase-js";
export function paymentAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(); const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("PAYMENT_SERVER_NOT_CONFIGURED");
  // Never forward a browser Authorization header to this restricted server writer.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
