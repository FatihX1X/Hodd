import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HoddieMessage } from "@/lib/hoddie/models";
const fake = vi.hoisted(() => ({ confirm: vi.fn(), dismiss: vi.fn(), send: vi.fn(), ready: true, signedIn: true, messages: [] as HoddieMessage[] }));
vi.mock("./hoddie-provider", () => ({ useHoddie: () => ({ provider: "GEMINI", providers: [{ id: "GEMINI", model: "gemini-test", ready: fake.ready, note: "Configure the server key" }], allowed: true, signedIn: fake.signedIn, busy: false, status: "ready", issue: "", handled: [], workspaceScope: "TREASURY", messages: fake.messages, confirm: fake.confirm, dismiss: fake.dismiss, send: fake.send, clear: vi.fn(), chooseProvider: vi.fn() }) }));
vi.mock("./agent-requests", () => ({ AgentRequests: () => <div>Existing wallet review</div> }));
import { HoddieWorkspace } from "./hoddie-workspace";
const proposalMessage = (): HoddieMessage => ({ id: "review", role: "assistant", parts: [{ type: "data-hoddie", data: { language: "en", message: "Review only", cards: [{ title: "Treasury overview", fields: [{ label: "Liquid USDC", value: "10000 USDC" }] }], source: "NOT_CONNECTED", observedAt: "2026-10-08T12:00:00Z", proposal: { handle: "signed-review", kind: "UPDATE_POLICY", summary: "Buffer 1000 → 1500 USDC", lines: ["Nothing applied yet"], expiresAt: new Date(Date.now() + 600000).toISOString(), impact: [{ label: "Deployable capital", before: "4500 USDC", after: "4000 USDC" }] } } }] });
beforeEach(() => { vi.clearAllMocks(); fake.messages = []; fake.ready = true; fake.signedIn = true; });
afterEach(cleanup);
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
