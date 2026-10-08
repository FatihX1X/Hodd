"use client";

import { useState } from "react";
import Image from "next/image";
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
  return (
    <div className="metric-grid min-h-screen px-5 py-12">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-lg flex-col justify-center">
        <Image src="/brand/hodd-lockup-light.png" alt="Hodd Finance" width={1912} height={608} priority className="mb-8 h-auto w-[200px]" />
        <section className="w-full border border-black/80 bg-[#f4f1e8] p-6 md:p-8">
          <p className="mono text-[10px] uppercase tracking-[0.18em] text-black/50">Hodd identity</p>
          <h1 className="disp mt-4 text-[clamp(1.5rem,6vw,2rem)]">Sign in before connecting a treasury wallet.</h1>
          <p className="mt-4 text-sm leading-6 text-black/60">Supabase identifies the operator. Wallet custody remains with Circle embedded, passkey, MetaMask or Rabby.</p>
          <form onSubmit={sendLink} className="mt-7">
            <label className="mono text-[10px] font-semibold uppercase tracking-[0.1em] text-black/60">Email
              <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full border border-black/25 bg-white px-3 py-3 font-sans text-sm normal-case tracking-normal outline-none focus:border-[#0a52e8]" />
            </label>
            <button className="mono mt-4 min-h-12 w-full bg-[#0b0b0d] px-5 py-4 text-xs font-medium uppercase tracking-[0.09em] text-white transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#0a52e8]">Continue with email</button>
          </form>
          <button onClick={google} className="mono mt-3 min-h-12 w-full border border-black/30 px-5 py-4 text-xs font-medium uppercase tracking-[0.09em] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#0b0b0d]">Continue with Google</button>
          {message && <p role="status" className="mt-4 border border-black/10 bg-black/[0.03] p-3 text-xs">{message}</p>}
          <Link href="/" className="mono mt-6 inline-block text-[11px] font-semibold uppercase tracking-[0.09em] text-[#0a52e8] underline-offset-4 hover:underline">Return to local demo</Link>
        </section>
      </div>
    </div>
  );
}
