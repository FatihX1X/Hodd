"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AFTER_LOGIN_COOKIE } from "@/lib/agent/after-login";

type Details = { clientName: string; clientUri: string; redirectUri: string; scope: string; email: string };
type State = { status: "LOADING" } | { status: "ERROR"; message: string } | { status: "READY"; details: Details } | { status: "REDIRECTING" };

/**
 * Supabase OAuth 2.1 consent screen for the Hodd Claude connector. Supabase sends
 * the browser here with ?authorization_id=…; the signed-in user approves or denies.
 */
export function OAuthConsent({ authorizationId }: { authorizationId: string | null }) {
  const [state, setState] = useState<State>({ status: "LOADING" });
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const load = async () => {
      const client = createSupabaseBrowserClient();
      if (!authorizationId || !/^[\w-]{8,200}$/.test(authorizationId)) return setState({ status: "ERROR", message: "This authorization link is incomplete. Start the connection again from Claude." });
      if (!client) return setState({ status: "ERROR", message: "Hodd sign-in is not configured on this server." });
      const { data: user } = await client.auth.getUser();
      if (!user.user) {
        // Come back to this exact consent request after signing in.
        document.cookie = `${AFTER_LOGIN_COOKIE}=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}; Max-Age=900; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
        router.push("/login");
        return;
      }
      const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error || !data) return setState({ status: "ERROR", message: "This authorization request expired or is invalid. Start the connection again from Claude." });
      // Already approved earlier: Supabase returns only the redirect back to the client.
      if (!("client" in data)) { setState({ status: "REDIRECTING" }); window.location.assign(data.redirect_url); return; }
      setState({ status: "READY", details: { clientName: data.client.name || "An application", clientUri: data.client.uri, redirectUri: data.redirect_uri, scope: data.scope, email: data.user.email } });
    };
    void load();
    return () => { active = false; };
  }, [authorizationId, router]);

  const decide = async (approve: boolean) => {
    const client = createSupabaseBrowserClient();
    if (!client || !authorizationId) return;
    setBusy(true);
    const { data, error } = approve ? await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true }) : await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) { setBusy(false); setState({ status: "ERROR", message: "The decision could not be saved. Start the connection again from Claude." }); return; }
    setState({ status: "REDIRECTING" });
    window.location.assign(data.redirect_url);
  };

  return (
    <div data-theme="dark" className="ink-grid min-h-screen bg-[#0b0b0d] px-5 py-12 text-[#f4f1e8]">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-lg flex-col justify-center">
        <Image src="/brand/hodd-lockup-dark.png" alt="Hodd Finance" width={1912} height={608} priority className="mb-8 h-auto w-[200px]" />
        <section className="w-full border border-white/[0.14] bg-[#101319] p-6 md:p-8" aria-live="polite">
          <p className="mono text-[10px] uppercase tracking-[0.18em] text-white/60">Connection request</p>
          {state.status === "LOADING" && <p className="mt-4 text-sm text-white/70">Checking the request…</p>}
          {state.status === "REDIRECTING" && <p className="mt-4 text-sm text-white/70">Returning to the application…</p>}
          {state.status === "ERROR" && <p role="alert" className="mt-4 border border-[#ff9a92]/30 bg-[#d03b3b]/15 p-3 text-sm text-[#ff9a92]">{state.message}</p>}
          {state.status === "READY" && <>
            <h1 className="disp mt-4 text-[clamp(1.4rem,5vw,1.9rem)]"><span className="text-[#8fb0ff]">{state.details.clientName}</span> wants to use your Hodd account.</h1>
            <p className="mt-3 text-xs text-white/65">Signed in as {state.details.email}{state.details.clientUri ? ` · ${state.details.clientUri}` : ""}</p>
            <ul className="mt-6 space-y-3 text-sm leading-6 text-white/75">
              <li><strong>It can read</strong> your treasury: balances, obligations, policy, positions, activity and payment history.</li>
              <li><strong>It can change</strong> obligations, policy and targets, and create payment or Morpho requests, but only after you approve each change in the chat.</li>
              <li><strong>It cannot move money.</strong> Payments and Morpho operations always finish in Hodd with your own wallet signature.</li>
            </ul>
            <p className="mt-5 text-xs leading-5 text-white/65">Tip: in Claude keep Hodd&apos;s write tools on &ldquo;Needs approval&rdquo;. You can revoke this connection anytime from Hodd → Connections.</p>
            <p className="mono mt-3 break-all text-[10px] text-white/50">Returns to {state.details.redirectUri}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button disabled={busy} onClick={() => void decide(true)} className="mono min-h-12 bg-[#f4f1e8] px-5 py-4 text-xs font-medium uppercase tracking-[0.09em] text-[#0b0b0d] disabled:opacity-50">Allow</button>
              <button disabled={busy} onClick={() => void decide(false)} className="mono min-h-12 border border-white/30 px-5 py-4 text-xs font-medium uppercase tracking-[0.09em] disabled:opacity-50">Deny</button>
            </div>
          </>}
        </section>
      </div>
    </div>
  );
}
