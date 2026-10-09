"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { resultSchema, type HoddieMessage, type HoddieProvider as ProviderId, type HoddieResult } from "@/lib/hoddie/models";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";

type ProviderInfo = { id: ProviderId; label: string; model: string; ready: boolean; note: string };
function useHoddieState() {
  const { workspace, workspaceScope, refreshWorkspace } = useTreasuryWorkspace();
  const provider = "AUTO" as const;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [allowed, setAllowed] = useState(false); const [signedIn, setSignedIn] = useState(false);
  const [manualBusy, setManualBusy] = useState(false); const [issue, setIssue] = useState("");
  const [selectionRef, setSelectionRef] = useState<string | undefined>();
  const [handled, setHandled] = useState<string[]>([]); const used = useRef(new Set<string>());
  const generation = useRef(0); const sending = useRef(false);
  const transport = useMemo(() => new DefaultChatTransport<HoddieMessage>({ api: "/api/hoddie/chat", prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, mode: "MESSAGE", message: messages.filter((item) => item.role === "user").at(-1)?.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "" } }) }), []);
  const chat = useChat<HoddieMessage>({ transport, dataPartSchemas: { hoddie: resultSchema }, onData: (part) => { if (part.type === "data-hoddie" && part.data.selectionRef) setSelectionRef(part.data.selectionRef); } });
  const { stop, setMessages, clearError } = chat;
  const clear = useCallback(() => { generation.current++; sending.current = false; setManualBusy(false); void stop(); setMessages([]); clearError(); setIssue(""); setSelectionRef(undefined); used.current.clear(); setHandled([]); }, [stop, setMessages, clearError]);
  useEffect(() => {
    const client = createSupabaseBrowserClient(); if (!client) return;
    let owner: string | undefined;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || owner !== session?.user.id) { clear(); setAllowed(false); }
      owner = session?.user.id; setSignedIn(Boolean(session?.user));
    });
    return () => data.subscription.unsubscribe();
  }, [clear]);
  const walletIdentity = `${workspaceScope}:${workspace.walletConnection?.provider ?? "demo"}:${workspace.walletConnection?.address ?? ""}:${workspace.walletConnection?.connectedAt ?? ""}`;
  useEffect(() => { const timer = window.setTimeout(clear, 0); return () => window.clearTimeout(timer); }, [walletIdentity, clear]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/hoddie/chat", { signal: controller.signal }).then((response) => response.json()).then((data: { providers: ProviderInfo[] }) => { if (Array.isArray(data.providers)) setProviders(data.providers); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void fetch(`/api/hoddie/consent?provider=${provider}`, { signal: controller.signal }).then((response) => response.json()).then((data) => { if (controller.signal.aborted) return; setAllowed(data.allowed === true); if (data.status === "READY") setSignedIn(true); if (data.code === "AUTH_REQUIRED") setSignedIn(false); }).catch(() => undefined);
    return () => controller.abort();
  }, [provider, signedIn]);
  const busy = manualBusy || chat.status === "submitted" || chat.status === "streaming";
  const accept = async () => {
    const epoch = generation.current; setManualBusy(true); setIssue("");
    try { const response = await fetch("/api/hoddie/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, allow: true }) }); const data = await response.json(); if (epoch !== generation.current) return; if (data.status !== "READY") throw new Error(data.message); setAllowed(true); }
    catch (error) { if (epoch === generation.current) setIssue(error instanceof Error ? error.message : "Permission could not be saved."); }
    finally { if (epoch === generation.current) setManualBusy(false); }
  };
  const revoke = async () => { clear(); setAllowed(false); try { await fetch("/api/hoddie/consent", { method: "DELETE" }); } catch { setIssue("Permission revocation could not be confirmed. Reload before sending another command."); } };
  const append = (result: HoddieResult) => { setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "data-hoddie", data: result }] }]); if (result.selectionRef) setSelectionRef(result.selectionRef); };
  const send = async (message: string) => {
    if (busy || sending.current || !allowed || workspaceScope !== "TREASURY") return;
    sending.current = true; const epoch = generation.current; setManualBusy(true); setIssue("");
    try { await refreshWorkspace(); if (epoch !== generation.current) return; await chat.sendMessage({ text: message }, { body: { provider, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(selectionRef ? { selectionRef } : {}) } }); }
    catch (error) { if (epoch === generation.current) setIssue(error instanceof Error ? error.message : "Hoddie is unavailable."); }
    finally { if (epoch === generation.current) { sending.current = false; setManualBusy(false); } }
  };
  const manual = async (input: { mode: "PREPARE"; kind: string; change: Record<string, unknown> } | { mode: "SELECT"; handle: string }) => {
    const epoch = generation.current; setManualBusy(true); setIssue("");
    try { const response = await fetch("/api/hoddie/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, provider }) }); const data = await response.json(); if (epoch !== generation.current) return; if (data.status !== "READY") throw new Error(data.message); append(resultSchema.parse(data.result)); }
    catch (error) { if (epoch === generation.current) setIssue(error instanceof Error ? error.message : "The preparation failed."); }
    finally { if (epoch === generation.current) setManualBusy(false); }
  };
  const confirm = async (handle: string) => {
    if (used.current.has(handle)) return;
    used.current.add(handle); setHandled([...used.current]);
    const epoch = generation.current; setManualBusy(true); setIssue("");
    try {
      const response = await fetch("/api/hoddie/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, handle, confirmed: true }) }); const data = await response.json();
      if (epoch !== generation.current) return; if (data.status !== "READY") throw new Error(data.message);
      await refreshWorkspace(); window.dispatchEvent(new Event("hodd:agent-actions"));
      if (epoch !== generation.current) return;
      append({ language: "en", message: data.request ? "Request saved. Review it below, then use the separate quote and your wallet signature." : "The approved change was saved. Portfolio and Activity now reflect it.", cards: [] });
    } catch (error) { if (epoch === generation.current) setIssue(error instanceof Error ? error.message : "Confirmation outcome is unavailable. Inspect Activity before preparing it again."); }
    finally { if (epoch === generation.current) setManualBusy(false); }
  };
  const dismiss = (handle: string) => { used.current.add(handle); setHandled([...used.current]); };
  return { messages: chat.messages, provider, providers, allowed, signedIn, busy, status: chat.status, issue: issue || chat.error?.message || "", accept, revoke, send, stop, clear, manual, confirm, dismiss, handled, workspaceScope };
}
type State = ReturnType<typeof useHoddieState>;
const HoddieContext = createContext<State | null>(null);
export function HoddieProvider({ children }: { children: React.ReactNode }) { const value = useHoddieState(); return <HoddieContext.Provider value={value}>{children}</HoddieContext.Provider>; }
export function useHoddie() { const value = useContext(HoddieContext); if (!value) throw new Error("HoddieProvider is required"); return value; }
