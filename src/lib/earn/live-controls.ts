import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

export type LiveControls = ReadonlyMap<string, boolean>;
const TTL_MS = 30_000;
let cached: { at: number; value: LiveControls } | null = null;

/**
 * Operator switches (`hodd_live_controls`), readable by anyone. A short cache
 * keeps per-request cost low; an unreadable table returns null and callers fail
 * closed.
 */
export async function liveControls(now = Date.now()): Promise<LiveControls | null> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const { url, publishableKey } = supabaseConfig();
    const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.from("hodd_live_controls").select("key,enabled");
    if (error || !data) return null;
    const value: LiveControls = new Map(data.map((row: { key: string; enabled: boolean }) => [row.key, row.enabled === true]));
    cached = { at: now, value };
    return value;
  } catch { return null; }
}

export function resetLiveControlsCache() { cached = null; }
