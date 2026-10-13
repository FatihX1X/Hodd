"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Banknote, Check, CircleCheck, CircleDashed, Copy, Eye, FilePen, FilePlus, Link2, Lock, LogIn, MessageSquare, PlugZap, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, TrendingUp, Unplug, type LucideIcon } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SectionCard, SectionHeading, StatusPill } from "./primitives";
import { moneyColor } from "./visuals";
import { Tip } from "./tip";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

type Grant = { clientId: string; name: string; uri: string; grantedAt: string };
type Action = { id: string; kind: string; summary: string; status: string; created_at: string };

/** One icon per kind of change Claude can prepare. */
const changeIcons: Record<string, LucideIcon> = { CREATE_OBLIGATION: FilePlus, UPDATE_OBLIGATION: FilePen, UPDATE_POLICY: SlidersHorizontal, SET_TARGETS: Target, PAYMENT_REQUEST: Banknote, EARN_REQUEST: TrendingUp };
const words = (value: string) => { const text = value.toLowerCase().replaceAll("_", " "); return text.charAt(0).toUpperCase() + text.slice(1); };

/** Where the connection stands, as a picture and a word. */
function statusOf({ checked, signedIn, unavailable, count }: { checked: boolean; signedIn: boolean | null; unavailable: boolean; count: number }) {
  if (!checked) return { Icon: CircleDashed, color: "#8d8b84", title: "Checking the connection", detail: "One moment." };
  if (signedIn === null) return { Icon: Unplug, color: "#8d8b84", title: "Status unavailable", detail: "The connection status cannot be read right now." };
  if (!signedIn) return { Icon: Unplug, color: moneyColor.protected, title: "Sign in to connect", detail: "Sign in to Hodd, then add Hodd in Claude." };
  if (unavailable) return { Icon: Unplug, color: moneyColor.protected, title: "Connected apps unavailable", detail: "The Hodd OAuth server is not enabled yet." };
  if (count > 0) return { Icon: PlugZap, color: moneyColor.safe, title: "Claude is connected", detail: count === 1 ? "1 app can use your Hodd account." : `${count} apps can use your Hodd account.` };
  return { Icon: Unplug, color: "#8d8b84", title: "Not connected yet", detail: "Follow the four steps to connect Claude." };
}

/** Claude connector: setup, connected clients (revocable) and changes made through Claude. */
export function ConnectionsWorkspace() {
  const { workspaceScope, hydrated } = useTreasuryWorkspace();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [checked, setChecked] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [grantNote, setGrantNote] = useState("");
  const [actions, setActions] = useState<Action[]>([]);

  const load = useCallback(async () => {
    setOrigin(window.location.origin);

    const client = createSupabaseBrowserClient();
    if (!client) { setChecked(true); return; }
    const { data: auth } = await client.auth.getUser();
    setSignedIn(Boolean(auth.user));
    if (!auth.user) { setChecked(true); return; }
    const listed = await client.auth.oauth.listGrants();
    if (listed.error) { setGrants([]); setUnavailable(true); setGrantNote("Connected apps are unavailable until the Hodd OAuth server is enabled."); }
    else { setUnavailable(false); setGrantNote(""); setGrants((listed.data ?? []).map((grant) => ({ clientId: grant.client.id, name: grant.client.name || "Unnamed app", uri: grant.client.uri, grantedAt: grant.granted_at }))); }
    const { data } = await client.from("agent_actions").select("id,kind,summary,status,created_at").eq("user_id", auth.user.id).eq("scope", workspaceScope).order("created_at", { ascending: false }).limit(25);
    setActions((data ?? []) as Action[]);
    setChecked(true);
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

  const count = grants?.length ?? 0;
  const connected = signedIn === true && !unavailable && count > 0;
  const status = statusOf({ checked, signedIn, unavailable, count });
  const steps: readonly { Icon: LucideIcon; done: boolean; body: React.ReactNode; extra?: React.ReactNode }[] = [
    { Icon: Settings2, done: connected, body: <>In Claude open <strong>Settings</strong>, then <strong>Connectors</strong>, then <strong>Add custom connector</strong>.</> },
    { Icon: Link2, done: connected, body: <>Name it <strong>Hodd</strong> and paste the connector URL. Leave the OAuth fields empty.</>, extra: <button type="button" onClick={() => void copy()} aria-label="Copy connector URL" disabled={!url} className="mt-2 inline-flex min-h-11 items-center gap-2 border border-white/25 bg-[#0b0b0d] px-3 text-[13px] font-medium text-[#f4f1e8] hover:border-white/50 disabled:opacity-40">{copied ? <Check aria-hidden="true" className="size-4 text-[#7fe3a8]" /> : <Copy aria-hidden="true" className="size-4" />}{copied ? "Copied" : "Copy connector URL"}</button> },
    { Icon: LogIn, done: connected, body: <>Press <strong>Connect</strong>, sign in to Hodd and choose <strong>Allow</strong>. Keep Hodd&apos;s write tools on <strong>Needs approval</strong>.</> },
    { Icon: MessageSquare, done: actions.length > 0, body: <>Ask &ldquo;Can I pay tomorrow&apos;s bills?&rdquo; or &ldquo;Add a 500 USDC rent bill due on the 1st&rdquo;.</> },
  ];
  const promises: readonly { Icon: LucideIcon; color: string; title: string; tip: React.ReactNode }[] = [
    { Icon: Eye, color: moneyColor.safe, title: "Reads run freely", tip: "Balances, bills, policy, positions and history run without asking." },
    { Icon: ShieldCheck, color: moneyColor.protected, title: "Changes need your approval", tip: <>Every change is previewed first and needs your approval in the chat. In Claude&apos;s connector settings keep Hodd&apos;s write tools on <strong>Needs approval</strong>; &ldquo;Always allow&rdquo; would skip that question.</> },
    { Icon: Lock, color: moneyColor.deployable, title: "Money never moves from Claude", tip: "Payments and Morpho operations arrive here as requests; you finish them with your own wallet signature." },
  ];

  return <div className="mx-auto max-w-[1440px] space-y-6 px-5 py-7 md:px-8 lg:px-10 lg:py-10">
    <SectionCard>
      <SectionHeading icon={<PlugZap aria-hidden="true" className="size-4" />} title="Use Hodd from Claude" description="claude.ai, Claude Desktop and the Claude mobile app" />
      <div className="grid gap-px bg-white/[0.14] md:grid-cols-[minmax(0,300px)_1fr]">
        <div role="status" className="flex flex-col items-center gap-4 bg-[#101319] p-6 text-center md:items-start md:text-left">
          <span aria-hidden="true" className="grid size-20 place-items-center rounded-full border-2" style={{ borderColor: status.color, color: status.color }}><status.Icon className="size-9" /></span>
          <div><p className="disp text-lg">{status.title}</p><p className="mt-1 text-[13px] leading-5 text-white/60">{status.detail}</p></div>
        </div>
        <ol aria-label="Setup steps" className="space-y-4 bg-[#101319] p-6">
          {steps.map(({ Icon, done, body, extra }, index) => <li key={index} className="flex items-start gap-3">
            <span aria-hidden="true" className={clsx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border", done ? "border-[#7fe3a8] bg-[#7fe3a8]/10 text-[#7fe3a8]" : "border-white/25 text-white/60")}>{done ? <Check className="size-4" /> : <Icon className="size-4" />}</span>
            <div className="min-w-0 pt-1 text-sm leading-6 text-white/80">{body}{done && <span className="sr-only"> (done)</span>}{extra}</div>
          </li>)}
        </ol>
      </div>
      <ul aria-label="What Claude can do" className="grid gap-px border-t border-white/[0.14] bg-white/[0.14] md:grid-cols-3">
        {promises.map(({ Icon, color, title, tip }, index) => <li key={title} className="flex items-center gap-3 bg-[#101319] px-5 py-3"><Icon aria-hidden="true" className="size-4 shrink-0" style={{ color }} /><span className="min-w-0 text-[13px]">{title}</span><Tip label={`About: ${title}`} align={index === promises.length - 1 ? "end" : "start"}>{tip}</Tip></li>)}
      </ul>
      <details className="border-t border-white/[0.14]"><summary className="flex min-h-11 cursor-pointer items-center gap-2 px-5 py-3 text-[13px] text-white/60 hover:text-white"><Settings2 aria-hidden="true" className="size-4" />Connector details</summary>
        <div className="px-5 pb-5 pt-1">
          <p className={clsx("text-[12px] text-white/55")}>Connector URL</p>
          <code className="mono mt-2 block break-all border border-white/20 bg-[#0b0b0d] px-3 py-3 text-xs text-[#f4f1e8]">{url || "…"}</code>
        </div>
      </details>
    </SectionCard>

    <SectionCard>
      <SectionHeading icon={<Link2 aria-hidden="true" className="size-4" />} title="Connected apps" description="Apps you allowed to use your Hodd account" />
      <div className="divide-y divide-white/10">
        {signedIn === false && <p className="p-5 text-sm text-white/65">Sign in to see and manage connected apps.</p>}
        {grants?.map((grant) => <article key={grant.clientId} className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full border border-[#7fe3a8]/50 text-[#7fe3a8]"><CircleCheck className="size-5" /></span>
            <div className="min-w-0"><p className="text-sm font-semibold">{grant.name}</p><p className="mt-0.5 text-[12px] text-white/55">Allowed {new Date(grant.grantedAt).toLocaleString()}</p>
              <details><summary className="inline-flex min-h-8 cursor-pointer items-center text-[12px] text-white/50 hover:text-white">Technical details</summary><p className="mono break-all pb-1 text-[11px] text-white/55">{grant.uri || grant.clientId}</p></details>
            </div>
          </div>
          <button onClick={() => void revoke(grant.clientId)} className="inline-flex min-h-11 items-center gap-2 border border-white/20 px-3 text-xs text-[#ff9a92] hover:border-[#ff9a92]/60"><Unplug aria-hidden="true" className="size-3.5" />Revoke</button>
        </article>)}
        {grants?.length === 0 && !grantNote && <p className="p-5 text-sm text-white/65">No apps are connected yet.</p>}
        {grantNote && <p role="status" className="p-5 text-sm text-white/70">{grantNote}</p>}
      </div>
    </SectionCard>

    <SectionCard>
      <SectionHeading icon={<Sparkles aria-hidden="true" className="size-4" />} title="Changes made through Claude" description={workspaceScope === "SMOKE_TEST" ? "Smoke-test workspace" : "Main treasury"} />
      <div className="divide-y divide-white/10">
        {actions.length === 0 ? <p className="p-5 text-sm text-white/65">Nothing yet.</p> : actions.map((action) => {
          const Icon = changeIcons[action.kind] ?? Sparkles;
          return <article key={action.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full border border-white/20 text-white/70"><Icon className="size-4" /></span>
              <div className="min-w-0"><p className="break-words text-sm">{action.summary}</p><p className="mt-0.5 text-[12px] text-white/55">{words(action.kind)}, {new Date(action.created_at).toLocaleString()}</p></div>
            </div>
            <StatusPill label={action.status} tone={action.status === "OPEN" ? "info" : action.status === "DISMISSED" ? "neutral" : "success"} />
          </article>;
        })}
      </div>
    </SectionCard>
  </div>;
}
