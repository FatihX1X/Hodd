"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
  return <div className="text-xs">{signedIn ? <button onClick={() => void signOut()} className="border border-black/15 px-3 py-2">Sign out</button> : <Link href="/login" className="border border-black/15 px-3 py-2">Sign in</Link>}{error && <span role="alert">{error}</span>}</div>;
}
