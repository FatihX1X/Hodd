import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";
export function paymentAdmin() {
  // The project URL is public (hosted fallback); only the secret key is server configuration.
  const { url } = supabaseConfig(); const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("PAYMENT_SERVER_NOT_CONFIGURED");
  // Never forward a browser Authorization header to this restricted server writer.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
