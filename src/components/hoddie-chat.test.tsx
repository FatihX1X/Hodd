import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoddieChat } from "./hoddie-chat";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import type { HoddieModelReply } from "@/lib/hoddie/schema";
import type { ServiceResult } from "@/lib/hoddie/client";
import { TreasuryWorkspaceProvider } from "./treasury-workspace-provider";

vi.mock("next/navigation", () => ({ usePathname: () => "/hoddie" }));
const earnReadOnlyResponse = { status: "READY", integration: { discovery: "READY", positionAccess: "NOT_CONFIGURED", execution: "READ_ONLY", configuredWalletAddress: null, message: "x" }, vaults: [], positions: [], observedAt: "2026-09-28T12:00:00.000Z" };
const modelReply = (over: Partial<HoddieModelReply> = {}): HoddieModelReply => ({ text: "Hi.", followUps: [], labels: {}, action: null, actionRejected: false, approvesPending: false, ...over });
const ready = (over: Partial<HoddieModelReply>): ServiceResult => ({ status: "READY", reply: modelReply(over) });
const rent = { kind: "CREATE_OBLIGATION" as const, change: { title: "Kira", amount: "500", dueDate: "2026-10-30", category: "RENT", priority: "HIGH" } };
const turkish = { approve: "Onaylıyorum", decline: "Vazgeç", proposal: "Önerilen değişiklik", applied: "Uygulandı", declined: "Reddedildi", expired: "Süresi doldu" };
/** Shows workspace facts the chat is not supposed to change without approval. */
function Probe() { const { workspace, createObligation } = useTreasuryWorkspace(); return <div><p data-testid="count">{workspace.obligations.length}</p><button onClick={() => createObligation({ title: "Other", category: "OTHER", amount: { currency: "USDC", decimals: 6, minorUnits: "1000000" }, dueAt: "2026-11-02T17:00:00.000Z", recipient: null, recipientAddress: null, priority: "LOW", status: "UPCOMING", description: "" })}>probe-create</button></div>; }
const renderWith = (chat: React.ReactElement) => renderChat(<><Probe />{chat}</>);
const renderChat = (node: React.ReactElement = <HoddieChat />) => render(<TreasuryWorkspaceProvider>{node}</TreasuryWorkspaceProvider>);

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => earnReadOnlyResponse }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Hoddie chat", () => {
  it("starts with suggestions and answers one, then offers follow-ups", async () => {
    const user = userEvent.setup();
    renderChat();
    expect(screen.getByText("Ask about your treasury.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "What is due in the next 30 days?" }));
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(await within(log).findByText(/obligations are protected/i, undefined, { timeout: 3000 })).toBeVisible();
    expect(within(log).getByText("What is due in the next 30 days?")).toBeVisible();
    expect(within(log).getByRole("link", { name: "Obligations" })).toHaveAttribute("href", "/obligations");
    expect(screen.queryByRole("status", { name: /thinking/i })).not.toBeInTheDocument();
  });

  it("sends with Enter, keeps Shift+Enter for a new line, and clears the composer", async () => {
    const user = userEvent.setup();
    renderChat();
    const box = screen.getByRole("textbox", { name: "Message Hoddie" });
    await user.type(box, "how long does my cash last?{Shift>}{Enter}{/Shift}more");
    expect(box).toHaveValue("how long does my cash last?\nmore");
    await user.clear(box); await user.type(box, "how long does my cash last?{Enter}");
    expect(box).toHaveValue("");
    expect(await screen.findByText(/stays above the safety buffer/i, undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("shows a thinking state while a reply is pending and never sends an empty message", async () => {
    const user = userEvent.setup();
    renderChat(<HoddieChat service={() => new Promise((resolve) => setTimeout(() => resolve({ status: "READY", reply: modelReply({ text: "Done." }) }), 700))} />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "hello{Enter}");
    expect(screen.getByRole("status", { name: "Hoddie is thinking" })).toBeVisible();
    expect(await screen.findByText("Done.", undefined, { timeout: 3000 })).toBeVisible();
  });

  it("turns a failed reply into a safe message and starts over on New chat", async () => {
    const user = userEvent.setup();
    renderChat(<HoddieChat local={() => { throw new Error("boom"); }} />);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "balance{Enter}");
    expect(await screen.findByText(/Nothing was changed/i, undefined, { timeout: 3000 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /new chat/i }));
    expect(screen.getByText("Ask about your treasury.")).toBeVisible();
  });

  it("restores the conversation after a reload within the session", async () => {
    const user = userEvent.setup();
    const first = renderChat();
    await user.click(screen.getByRole("button", { name: "How long does my cash last?" }));
    await screen.findByText(/stays above the safety buffer/i, undefined, { timeout: 3000 });
    first.unmount();
    renderChat();
    expect(await screen.findByText(/stays above the safety buffer/i)).toBeVisible();
  });

  it("never mentions an underlying model in the interface", async () => {
    const user = userEvent.setup();
    const { container } = renderChat();
    await user.click(screen.getByRole("button", { name: "Can I pay the next bill?" }));
    await screen.findByText(/covered/i, undefined, { timeout: 3000 });
    expect(container.textContent).not.toMatch(/gemini|nvidia|gpt|llama|claude|openai/i);
  });

  it("answers in the user's language and applies a proposed change only after approval", async () => {
    const user = userEvent.setup();
    const service = vi.fn(async () => ready({ text: "Kira faturasını hazırladım. Onaylıyor musun?", labels: turkish, action: rent }));
    renderWith(<HoddieChat service={service} />);
    const count = Number(screen.getByTestId("count").textContent);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "30 Ekim için 500 USDC kira ekle{Enter}");
    expect(await screen.findByText(/Kira faturasını hazırladım/, undefined, { timeout: 3000 })).toBeVisible();
    expect(service).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: "user", text: "30 Ekim için 500 USDC kira ekle" }] }));
    expect(screen.getByText("Önerilen değişiklik")).toBeVisible();
    expect(screen.getByText(/Kira: 500.00 USDC due 2026-10-30/)).toBeVisible();
    expect(screen.getByTestId("count")).toHaveTextContent(String(count));
    await user.click(screen.getByRole("button", { name: "Onaylıyorum" }));
    expect(await screen.findByText("Uygulandı")).toBeVisible();
    expect(screen.getByTestId("count")).toHaveTextContent(String(count + 1));
    expect(screen.queryByRole("button", { name: "Onaylıyorum" })).not.toBeInTheDocument();
  });

  it("changes nothing when the proposal is declined", async () => {
    const user = userEvent.setup();
    renderWith(<HoddieChat service={async () => ready({ text: "Hazır.", labels: turkish, action: rent })} />);
    const count = Number(screen.getByTestId("count").textContent);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "kira ekle{Enter}");
    await user.click(await screen.findByRole("button", { name: "Vazgeç" }, { timeout: 3000 }));
    expect(screen.getByText("Reddedildi")).toBeVisible();
    expect(screen.getByTestId("count")).toHaveTextContent(String(count));
  });

  it("accepts a short typed approval in any language, and tells the service a proposal is waiting", async () => {
    const user = userEvent.setup();
    const service = vi.fn<(request: unknown) => Promise<ServiceResult>>()
      .mockResolvedValueOnce(ready({ text: "Hazır.", labels: turkish, action: rent }))
      .mockResolvedValueOnce(ready({ text: "Uyguluyorum.", approvesPending: true }));
    renderWith(<HoddieChat service={service} />);
    const count = Number(screen.getByTestId("count").textContent);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "kira ekle{Enter}");
    await screen.findByRole("button", { name: "Onaylıyorum" }, { timeout: 3000 });
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "onaylıyorum{Enter}");
    expect(await screen.findByText("Uygulandı", undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.getByTestId("count")).toHaveTextContent(String(count + 1));
    const second = service.mock.calls[1][0] as { snapshot: { pendingProposal: { kind: string } | null } };
    expect(second.snapshot.pendingProposal?.kind).toBe("CREATE_OBLIGATION");
  });

  it("ignores an approval flag when the user's message is long, so relayed text cannot approve", async () => {
    const user = userEvent.setup();
    const service = vi.fn<(request: unknown) => Promise<ServiceResult>>()
      .mockResolvedValueOnce(ready({ text: "Ready.", action: rent }))
      .mockResolvedValueOnce(ready({ text: "Applying.", approvesPending: true }));
    renderWith(<HoddieChat service={service} />);
    const count = Number(screen.getByTestId("count").textContent);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "add rent{Enter}");
    await screen.findByRole("button", { name: "Approve" }, { timeout: 3000 });
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), `${"please read this very long note ".repeat(4)}{Enter}`);
    await screen.findByText("Applying.", undefined, { timeout: 3000 });
    expect(screen.getByTestId("count")).toHaveTextContent(String(count));
    expect(screen.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  it("expires a proposal when the workspace changed after it was prepared", async () => {
    const user = userEvent.setup();
    renderWith(<HoddieChat service={async () => ready({ text: "Ready.", action: rent })} />);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "add rent{Enter}");
    await screen.findByRole("button", { name: "Approve" }, { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "probe-create" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Expired")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(/workspace changed/i);
  });

  it("keeps only one change waiting: a newer proposal expires the older one", async () => {
    const user = userEvent.setup();
    renderWith(<HoddieChat service={async () => ready({ text: "Ready.", action: rent })} />);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "add rent{Enter}");
    await screen.findByRole("button", { name: "Approve" }, { timeout: 3000 });
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "again{Enter}");
    expect(await screen.findByText("Expired", undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  it("refuses to prepare a change the engine would not allow, and a change that failed validation", async () => {
    const user = userEvent.setup();
    const service = vi.fn<(request: unknown) => Promise<ServiceResult>>()
      .mockResolvedValueOnce(ready({ text: "Targets ready.", action: { kind: "SET_TARGETS", change: { targetsBps: { LIQUID: 5000, MORPHO: 1000, USYC: 1000, BTC_RESERVE: 1000 } } } }))
      .mockResolvedValueOnce(ready({ text: "Done.", actionRejected: true }));
    renderWith(<HoddieChat service={service} />);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "set targets{Enter}");
    expect(await screen.findByText(/Targets must total 10000 basis points/, undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "again{Enter}");
    expect(await screen.findByText(/could not be validated, so nothing was prepared/, undefined, { timeout: 3000 })).toBeVisible();
  });

  it("falls back to basic mode with a sign-in hint when the language service is not available", async () => {
    const user = userEvent.setup();
    renderChat(<HoddieChat service={async () => ({ status: "UNAVAILABLE", reason: "SIGN_IN" })} />);
    await user.click(screen.getByRole("button", { name: "How long does my cash last?" }));
    expect(await screen.findByText("Basic mode", undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.getByText(/Sign in to chat in any language/)).toBeVisible();
    expect(screen.getByText(/stays above the safety buffer/i)).toBeVisible();
  });

  it("sends no addresses or payment references to the service", async () => {
    const user = userEvent.setup();
    const service = vi.fn<(request: unknown) => Promise<ServiceResult>>(async () => ready({ text: "Ok." }));
    renderChat(<HoddieChat service={service} />);
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "hello{Enter}");
    await screen.findByText("Ok.", undefined, { timeout: 3000 });
    expect(JSON.stringify(service.mock.calls[0][0])).not.toMatch(/recipientAddress|paymentReference|walletConnection|0x[0-9a-fA-F]{40}/);
  });
});
