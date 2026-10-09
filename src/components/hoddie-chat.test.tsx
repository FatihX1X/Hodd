import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoddieChat } from "./hoddie-chat";
import { TreasuryWorkspaceProvider } from "./treasury-workspace-provider";

vi.mock("next/navigation", () => ({ usePathname: () => "/hoddie" }));
const earnReadOnlyResponse = { status: "READY", integration: { discovery: "READY", positionAccess: "NOT_CONFIGURED", execution: "READ_ONLY", configuredWalletAddress: null, message: "x" }, vaults: [], positions: [], observedAt: "2026-09-28T12:00:00.000Z" };
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
    renderChat(<HoddieChat respond={() => new Promise((resolve) => setTimeout(() => resolve({ paragraphs: ["Done."], sources: [], followUps: [] }), 700))} />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), "hello{Enter}");
    expect(screen.getByRole("status", { name: "Hoddie is thinking" })).toBeVisible();
    expect(await screen.findByText("Done.", undefined, { timeout: 3000 })).toBeVisible();
  });

  it("turns a failed reply into a safe message and starts over on New chat", async () => {
    const user = userEvent.setup();
    renderChat(<HoddieChat respond={() => { throw new Error("boom"); }} />);
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
});
