import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HoddieMessage } from "@/lib/hoddie/models";
const fake = vi.hoisted(() => ({ confirm: vi.fn(), dismiss: vi.fn(), send: vi.fn(), scrollTo: vi.fn(), ready: true, signedIn: true, messages: [] as HoddieMessage[] }));
vi.mock("./hoddie-provider", () => ({ useHoddie: () => ({ provider: "GEMINI", providers: [{ id: "GEMINI", model: "gemini-test", ready: fake.ready, note: "Configure the server key" }], allowed: true, signedIn: fake.signedIn, busy: false, status: "ready", issue: "", handled: [], workspaceScope: "TREASURY", messages: fake.messages, confirm: fake.confirm, dismiss: fake.dismiss, send: fake.send, clear: vi.fn(), chooseProvider: vi.fn() }) }));
vi.mock("./agent-requests", () => ({ AgentRequests: () => <div>Existing wallet review</div> }));
import { HoddieWorkspace } from "./hoddie-workspace";
const proposalMessage = (): HoddieMessage => ({ id: "review", role: "assistant", parts: [{ type: "data-hoddie", data: { language: "en", message: "Review only", cards: [{ title: "Treasury overview", fields: [{ label: "Liquid USDC", value: "10000 USDC" }] }], source: "NOT_CONNECTED", observedAt: "2026-10-08T12:00:00Z", proposal: { handle: "signed-review", kind: "UPDATE_POLICY", summary: "Buffer 1000 → 1500 USDC", lines: ["Nothing applied yet"], expiresAt: new Date(Date.now() + 600000).toISOString(), impact: [{ label: "Deployable capital", before: "4500 USDC", after: "4000 USDC" }] } } }] });
const textMessage = (id: string, role: "user" | "assistant", text: string): HoddieMessage => ({ id, role, parts: [{ type: "text", text }] });
// jsdom has no layout or Element.scrollTo, so scroll geometry is faked per element.
const layout = (log: HTMLElement, values: Partial<Record<"scrollHeight" | "clientHeight" | "scrollTop", number>>) => { for (const [key, value] of Object.entries(values)) Object.defineProperty(log, key, { configurable: true, writable: true, value }); };
const scrollLog = (log: HTMLElement, scrollTop: number) => { layout(log, { scrollTop }); fireEvent.scroll(log); };
const getLog = () => screen.getByRole("log", { name: "Conversation messages" });
const jumpButton = () => screen.queryByRole("button", { name: "Jump to latest" });
beforeEach(() => { vi.clearAllMocks(); fake.messages = []; fake.ready = true; fake.signedIn = true; Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value: fake.scrollTo }); });
afterEach(() => { cleanup(); Reflect.deleteProperty(Element.prototype, "scrollTo"); Reflect.deleteProperty(window, "matchMedia"); });
describe("Hoddie user-only approval UI", () => {
  it("has no model selector and keeps suggestions in one horizontal region above the composer", async () => {
    render(<HoddieWorkspace />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Start a conversation")).not.toBeInTheDocument();
    const suggestions = screen.getByRole("region", { name: "Suggested commands" });
    expect(suggestions).toHaveClass("overflow-x-auto");
    expect(suggestions.compareDocumentPosition(screen.getByLabelText("Your command")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const scroll = vi.fn(); suggestions.scrollBy = scroll;
    await userEvent.setup().click(screen.getByRole("button", { name: "Next suggestions" }));
    expect(scroll).toHaveBeenCalledWith({ left: 240, behavior: "auto" });
    expect(screen.queryByText("Existing wallet review")).not.toBeInTheDocument();
  });
  it("shows source/time and does not apply a result until a keyboard approval", async () => {
    fake.messages = [proposalMessage()]; render(<HoddieWorkspace />);
    expect(screen.getByText(/NOT CONNECTED ·/)).toBeVisible(); expect(fake.confirm).not.toHaveBeenCalled();
    const apply = screen.getByRole("button", { name: "Apply change" }); apply.focus(); expect(apply).toHaveFocus(); await userEvent.setup().keyboard("{Enter}");
    expect(fake.confirm).toHaveBeenCalledWith("signed-review");
  });
  it("reject does not apply and expired review is disabled", async () => {
    fake.messages = [proposalMessage()]; const view = render(<HoddieWorkspace />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Reject" })); expect(fake.dismiss).toHaveBeenCalledWith("signed-review"); expect(fake.confirm).not.toHaveBeenCalled();
    const message = proposalMessage(); const part = message.parts[0]; if (part.type === "data-hoddie") part.data.proposal!.expiresAt = "2020-01-01T00:00:00Z";
    fake.messages = [message]; view.rerender(<HoddieWorkspace />); expect(screen.getByRole("button", { name: "Apply change" })).toBeDisabled();
  });
  it("keeps read-only questions enabled without a provider, and examples only fill input", async () => {
    fake.ready = false; render(<HoddieWorkspace />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Summarize my treasury" }));
    expect(screen.getByLabelText("Your command")).toHaveValue("Summarize my treasury"); expect(screen.getByLabelText("Your command")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Send command" })).toBeEnabled(); expect(fake.send).not.toHaveBeenCalled();
  });
  it("renders untrusted result text without interpreting HTML", () => {
    fake.messages = [{ id: "safe", role: "assistant", parts: [{ type: "data-hoddie", data: { language: "en", message: '<img src=x onerror="alert(1)">', cards: [] } }] }];
    render(<HoddieWorkspace />); expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeVisible(); expect(document.querySelector("img")).toBeNull();
  });
});
describe("Hoddie conversation scrolling", () => {
  // A long conversation the reader has scrolled up in: 600px above the end, so the jump button is showing.
  const scrolledUp = () => {
    fake.messages = [textMessage("a", "assistant", "First answer")]; const view = render(<HoddieWorkspace />); const log = getLog();
    layout(log, { scrollHeight: 2000, clientHeight: 400 }); scrollLog(log, 1600); scrollLog(log, 1000);
    expect(jumpButton()).toBeInTheDocument(); fake.scrollTo.mockClear();
    return { view, log };
  };
  const append = (view: ReturnType<typeof render>, ...items: HoddieMessage[]) => { fake.messages = [...fake.messages, ...items]; view.rerender(<HoddieWorkspace />); };
  it("keeps the log a focusable, labelled live region that scrolls inside the panel", () => {
    render(<HoddieWorkspace />); const log = getLog();
    expect(log).toHaveAttribute("tabindex", "0"); expect(log).toHaveAttribute("aria-live", "polite"); expect(log).toHaveClass("overflow-y-auto", "overscroll-contain");
    log.focus(); expect(log).toHaveFocus(); expect(jumpButton()).not.toBeInTheDocument();
  });
  it("snaps to the latest message on mount, then follows new and growing messages while at the end", () => {
    fake.messages = [textMessage("a", "assistant", "First answer")]; const view = render(<HoddieWorkspace />); const log = getLog();
    expect(fake.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    layout(log, { scrollHeight: 1000, clientHeight: 400 }); scrollLog(log, 560); fake.scrollTo.mockClear();
    layout(log, { scrollHeight: 1200 }); append(view, textMessage("b", "assistant", "Second"));
    expect(fake.scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: "smooth" });
    layout(log, { scrollHeight: 1500 }); fake.messages = [fake.messages[0], textMessage("b", "assistant", "Second, streaming more")]; view.rerender(<HoddieWorkspace />);
    expect(fake.scrollTo).toHaveBeenLastCalledWith({ top: 1500, behavior: "smooth" }); expect(jumpButton()).not.toBeInTheDocument();
  });
  it("does not yank a reader who scrolled up, and offers Jump to latest instead", async () => {
    const { view, log } = scrolledUp();
    layout(log, { scrollHeight: 2300 }); append(view, textMessage("b", "assistant", "New answer"));
    expect(fake.scrollTo).not.toHaveBeenCalled(); expect(jumpButton()).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(fake.scrollTo).toHaveBeenCalledWith({ top: 2300, behavior: "smooth" }); expect(jumpButton()).not.toBeInTheDocument(); expect(log).toHaveFocus();
    // Reaching the end keeps it hidden and resumes following.
    scrollLog(log, 1900); expect(jumpButton()).not.toBeInTheDocument();
    layout(log, { scrollHeight: 2600 }); append(view, textMessage("c", "assistant", "Another")); expect(fake.scrollTo).toHaveBeenLastCalledWith({ top: 2600, behavior: "smooth" });
  });
  it("hides the button on its own once the reader scrolls back near the end", () => {
    const { log } = scrolledUp(); scrollLog(log, 1100); expect(jumpButton()).toBeInTheDocument(); scrollLog(log, 1530); expect(jumpButton()).not.toBeInTheDocument();
  });
  it("always scrolls to the end when the user sends a message", () => {
    const { view, log } = scrolledUp(); layout(log, { scrollHeight: 2100 });
    append(view, textMessage("u", "user", "Pay the rent")); expect(fake.scrollTo).toHaveBeenCalledWith({ top: 2100, behavior: "smooth" });
    scrollLog(log, 1700); expect(jumpButton()).not.toBeInTheDocument();
  });
  it("uses instant scrolling when reduced motion is preferred", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { view, log } = scrolledUp(); await userEvent.setup().click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)"); expect(fake.scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: "auto" });
    scrollLog(log, 1600); layout(log, { scrollHeight: 2200 }); append(view, textMessage("b", "assistant", "More")); expect(fake.scrollTo).toHaveBeenLastCalledWith({ top: 2200, behavior: "auto" });
  });
  it("resets scroll state when the chat is cleared", () => {
    const { view, log } = scrolledUp(); fake.messages = []; view.rerender(<HoddieWorkspace />);
    expect(jumpButton()).not.toBeInTheDocument(); expect(screen.getByText("What can I help you with?")).toBeInTheDocument();
    layout(log, { scrollHeight: 900 }); append(view, textMessage("n", "assistant", "Fresh start"));
    expect(fake.scrollTo).toHaveBeenLastCalledWith({ top: 900, behavior: "smooth" }); expect(jumpButton()).not.toBeInTheDocument();
  });
});
