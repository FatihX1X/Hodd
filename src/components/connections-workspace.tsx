"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SectionCard, SectionHeading, StatusPill } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

type Grant = { clientId: string; name: string; uri: string; grantedAt: string };
type Action = { id: string; kind: string; summary: string; status: string; created_at: string };

/** Claude connector: setup, connected clients (revocable) and changes made through Claude. */
export function ConnectionsWorkspace() {
  const { workspaceScope, hydrated } = useTreasuryWorkspace();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [grantNote, setGrantNote] = useState("");
  const [actions, setActions] = useState<Action[]>([]);

  const load = useCallback(async () => {
    setOrigin(window.location.origin);

    const client = createSupabaseBrowserClient();
    if (!client) return;
    const { data: auth } = await client.auth.getUser();
    setSignedIn(Boolean(auth.user));
    if (!auth.user) return;
    const listed = await client.auth.oauth.listGrants();
    if (listed.error) { setGrants([]); setGrantNote("Connected apps are unavailable until the Hodd OAuth server is enabled."); }
    else { setGrantNote(""); setGrants((listed.data ?? []).map((grant) => ({ clientId: grant.client.id, name: grant.client.name || "Unnamed app", uri: grant.client.uri, grantedAt: grant.granted_at }))); }
    const { data } = await client.from("agent_actions").select("id,kind,summary,status,created_at").eq("user_id", auth.user.id).eq("scope", workspaceScope).order("created_at", { ascending: false }).limit(25);
    setActions((data ?? []) as Action[]);
  }, [workspaceScope]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, load]);

  const revoke = async (clientId: string) => {

    const client = createSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.auth.oauth.revokeGrant({ clientId });
    // Reload first: load() clears the note, so the outcome message must come after it.
    await load();
    setGrantNote(error ? "The connection could not be revoked. Try again." : "Connection revoked. Claude must be connected again to use Hodd.");
  };

  const url = origin ? `${origin}/api/mcp` : "";
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } };

  return <div className="mx-auto max-w-[1440px] space-y-6 px-5 py-7 md:px-8 lg:px-10 lg:py-10">
    <SectionCard>
      <SectionHeading index="06.1" title="Use Hodd from Claude" description="claude.ai, Claude Desktop and the Claude mobile app" />
      <div className="grid gap-6 p-5 md:grid-cols-2 md:p-7">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.14em] text-white/55">Connector URL</p>
          <div className="mt-2 flex items-stretch gap-2"><code className="mono flex-1 break-all border border-white/20 bg-[#0b0b0d] text-[#f4f1e8] px-3 py-3 text-xs">{url || "…"}</code><button onClick={() => void copy()} aria-label="Copy connector URL" className="grid w-12 place-items-center border border-white/20 bg-[#0b0b0d] text-[#f4f1e8]">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</button></div>
          <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-white/75">
            <li>In Claude open <strong>Settings → Connectors → Add custom connector</strong>.</li>
            <li>Name it <strong>Hodd</strong> and paste the URL above. Leave the OAuth fields empty.</li>
            <li>Press <strong>Connect</strong>, sign in to Hodd and choose <strong>Allow</strong>.</li>
            <li>Ask things like &ldquo;Can I pay tomorrow&apos;s bills?&rdquo; or &ldquo;Add a 500 USDC rent bill due on the 1st&rdquo;.</li>
          </ol>
        </div>
        <div className="space-y-3 text-sm leading-6 text-white/75">
          <p className="border border-[#2fcf2f]/30 bg-[#2fcf2f]/10 p-4 text-[#7fe3a8]"><strong>Reads</strong> (balances, bills, policy, positions, history) run without asking.</p>
          <p className="border border-[#fab219]/30 bg-[#fab219]/10 p-4 text-[#ffd27f]"><strong>Every change</strong> is previewed first and needs your approval in the chat. In Claude&apos;s connector settings keep Hodd&apos;s write tools on <strong>Needs approval</strong>; &ldquo;Always allow&rdquo; would skip that question.</p>
          <p className="border border-white/[0.14] bg-[#0b0b0d] text-[#f4f1e8] p-4"><strong>Money never moves from Claude.</strong> Payments and Morpho operations arrive here as requests; you finish them with your own wallet signature.</p>
        </div>
      </div>
    </SectionCard>

    <SectionCard>
      <SectionHeading index="06.2" title="Connected apps" description="Apps you allowed to use your Hodd account" />
      <div className="divide-y divide-white/10">
        {signedIn === false && <p className="p-5 text-sm text-white/65">Sign in to see and manage connected apps.</p>}
        {grants?.map((grant) => <article key={grant.clientId} className="flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="text-sm font-semibold">{grant.name}</p><p className="mono mt-1 text-[10px] text-white/55">{grant.uri || grant.clientId} · allowed {new Date(grant.grantedAt).toLocaleString()}</p></div><button onClick={() => void revoke(grant.clientId)} className="border border-white/20 px-3 py-2 text-xs text-[#ff9a92]">Revoke</button></article>)}
        {grants?.length === 0 && !grantNote && <p className="p-5 text-sm text-white/65">No apps are connected yet.</p>}
        {grantNote && <p role="status" className="p-5 text-sm text-white/70">{grantNote}</p>}
      </div>
    </SectionCard>

    <SectionCard>
      <SectionHeading index="06.3" title="Changes made through Claude" description={`Approved in Claude · ${workspaceScope === "SMOKE_TEST" ? "smoke-test workspace" : "main treasury"}`} />
      <div className="divide-y divide-white/10">
        {actions.length === 0 ? <p className="p-5 text-sm text-white/65">Nothing yet.</p> : actions.map((action) => <article key={action.id} className="flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="text-sm">{action.summary}</p><p className="mono mt-1 text-[10px] uppercase text-white/55">{action.kind.replaceAll("_", " ")} · {new Date(action.created_at).toLocaleString()}</p></div><StatusPill label={action.status} tone={action.status === "OPEN" ? "info" : action.status === "DISMISSED" ? "neutral" : "success"} /></article>)}
      </div>
    </SectionCard>
  </div>;
}
