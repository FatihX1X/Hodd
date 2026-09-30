"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const client = createSupabaseBrowserClient();
  const sendLink = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage("");
    if (!client) return setMessage("Supabase is not configured yet.");
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setMessage(error ? error.message : "Check your email to continue.");
  };
  const google = async () => {
    if (!client) return setMessage("Supabase is not configured yet.");
    const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (error) setMessage(error.message);
  };
  return <div className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12"><section className="w-full border border-black/15 bg-[#fffdf7] p-6"><p className="mono text-[9px] uppercase tracking-[0.18em] text-black/40">Hodd identity</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Sign in before connecting a treasury wallet.</h1><p className="mt-3 text-sm leading-6 text-black/55">Supabase identifies the operator. Wallet custody remains with Circle embedded, passkey, MetaMask or Rabby.</p><form onSubmit={sendLink} className="mt-7"><label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-black/50">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full border border-black/20 bg-white px-3 py-3 text-sm outline-none focus:border-[#164b32]" /></label><button className="mt-4 w-full bg-[#0b0d0c] px-5 py-4 text-sm font-semibold text-white">Continue with email</button></form><button onClick={google} className="mt-3 w-full border border-black/20 px-5 py-4 text-sm font-semibold">Continue with Google</button>{message && <p role="status" className="mt-4 border border-black/10 bg-black/[0.03] p-3 text-xs">{message}</p>}<Link href="/" className="mt-6 inline-block text-xs font-semibold text-[#164b32]">Return to local demo</Link></section></div>;
}
