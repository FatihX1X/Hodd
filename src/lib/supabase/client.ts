"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

export function createSupabaseBrowserClient() {
  const config = supabaseConfig();
  if (!config.ready || !config.url || !config.publishableKey) return null;
  return createBrowserClient(config.url, config.publishableKey);
}
