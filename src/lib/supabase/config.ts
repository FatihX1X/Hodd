// Public defaults for the hosted Hodd Supabase project. Both values are designed to
// ship to every browser (the publishable key only grants what row-level security
// allows), so hosting works without extra variables. Environment values win.
const HOSTED_SUPABASE_URL = "https://lbdtfzyulgegpsxhszfw.supabase.co";
const HOSTED_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_V0XbqesyO4SaCeZYR9uYBA_rHiIj099";

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || HOSTED_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || HOSTED_SUPABASE_PUBLISHABLE_KEY;
  return { url, publishableKey, ready: Boolean(url && publishableKey) } as const;
}
