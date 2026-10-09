"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const accountButton = "mono inline-flex min-h-8 items-center border border-white/25 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#f4f1e8] hover:bg-white/10";

export function AccountMenu() {
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const client = createSupabaseBrowserClient();
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)));
    return () => data.subscription.unsubscribe();
  }, []);
  const signOut = async () => {
    const client = createSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) { setError("Sign out failed. Please try again."); return; }
    await fetch("/api/wallet/circle/session", { method: "DELETE" });
  };
  return <div className="text-xs">{signedIn ? <button onClick={() => void signOut()} className={accountButton}>Sign out</button> : <Link href="/login" className={accountButton}>Sign in</Link>}{error && <span role="alert" className="ml-2 text-[#ff9a92]">{error}</span>}</div>;
}
