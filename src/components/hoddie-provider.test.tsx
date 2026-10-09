import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useCallback, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import type { HoddieMessage } from "@/lib/hoddie/models";
const fake = vi.hoisted(() => ({ auth: undefined as undefined | ((event: string, session: { user: { id: string } } | null) => void), scope: "TREASURY", refresh: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: (callback: typeof fake.auth) => { fake.auth = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } }) }));
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ workspace: initialWorkspace, workspaceScope: fake.scope, refreshWorkspace: fake.refresh }) }));
vi.mock("@ai-sdk/react", () => ({ useChat: () => {
  const [messages, setMessages] = useState<HoddieMessage[]>([]); const noop = useCallback(() => undefined, []);
  return { messages, setMessages, stop: noop, clearError: noop, sendMessage: noop, status: "ready" };
} }));
import { HoddieProvider, useHoddie } from "./hoddie-provider";
let state: ReturnType<typeof useHoddie>;
function Probe() { const value = useHoddie(); useEffect(() => { state = value; }, [value]); return null; }
const ready = { status: "READY", result: { language: "en", message: "Safe result", cards: [] } };
beforeEach(() => {
  fake.scope = "TREASURY"; fake.auth = undefined; fake.refresh.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("consent") ? { status: "READY", allowed: true } : { providers: [] })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mountSignedIn() {
  const view = render(<HoddieProvider><Probe /></HoddieProvider>);
  await act(async () => fake.auth?.("SIGNED_IN", { user: { id: "owner" } }));
  await waitFor(() => expect(state.allowed).toBe(true)); return view;
}
describe("Hoddie session-local isolation", () => {
  it("does not request consent before authentication", async () => {
    render(<HoddieProvider><Probe /></HoddieProvider>);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hoddie/chat", expect.anything()));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("consent"))).toBe(false);
  });
  it("drops a late preparation after logout and clears busy state", async () => {
    await mountSignedIn(); let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    let pending!: Promise<void>;
    act(() => { pending = state.manual({ mode: "PREPARE", kind: "UPDATE_POLICY", change: { safetyBuffer: "1" } }); });
    act(() => fake.auth?.("SIGNED_OUT", null));
    await act(async () => { resolve(Response.json(ready)); await pending; });
    expect(state.messages).toEqual([]); expect(state.allowed).toBe(false); expect(state.busy).toBe(false);
  });
  it("clears memory and pending review use state on workspace/wallet scope change", async () => {
    const view = await mountSignedIn(); vi.mocked(fetch).mockResolvedValueOnce(Response.json(ready));
    await act(async () => state.manual({ mode: "PREPARE", kind: "UPDATE_POLICY", change: { safetyBuffer: "1" } }));
    expect(state.messages).toHaveLength(1); act(() => state.dismiss("review"));
    fake.scope = "SMOKE_TEST"; view.rerender(<HoddieProvider><Probe /></HoddieProvider>);
    await waitFor(() => expect(state.messages).toHaveLength(0)); expect(state.handled).toEqual([]);
  });
  it("double-click confirmation makes one request, even before a rerender", async () => {
    await mountSignedIn(); let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = state.confirm("review"); second = state.confirm("review"); });
    await act(async () => { resolve(Response.json({ status: "READY", request: false })); await Promise.all([first, second]); });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/confirm"))).toHaveLength(1);
    expect(fake.refresh).toHaveBeenCalledTimes(1);
  });
});
