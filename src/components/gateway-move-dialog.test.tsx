import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UnifiedUsdcView } from "@/lib/gateway/models";
import { GATEWAY_WALLET } from "@/lib/gateway/chains";
import { GatewayMoveDialog, gatewayMoveProgress } from "./gateway-move-dialog";

const fake = vi.hoisted(() => ({ runtime: vi.fn(), signIntent: vi.fn(), signPermit: vi.fn(), sendOnChain: vi.fn(), refresh: vi.fn() }));
const wallet = "0xB7a07a8184412A160bACe9DA3EeC914c0021a19C";
const hash = (digit: string) => `0x${digit.repeat(64)}`;
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ workspace: { walletConnection: { address: wallet, accountType: "EOA", connectedAt: "session" }, policy: { strategyCapsBps: { MORPHO: 4000 } } }, workspaceScope: "TREASURY", operationalWorkspace: null, assessment: null, earnState: { status: "LOADING" }, refreshWallet: fake.refresh, refreshEarn: fake.refresh, readOnly: false }) }));
vi.mock("@/lib/wallet/runtime", async (original) => ({ ...(await original<typeof import("@/lib/wallet/runtime")>()), getActiveWalletRuntime: fake.runtime, isSignerFor: () => true }));
vi.mock("@/lib/wallet/use-active-signer", () => ({ useHasActiveSigner: () => true }));

const usdc = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const viewWith = (gateway: string): UnifiedUsdcView => ({
  address: wallet, observedAt: "2026-10-13T20:00:00.000Z", gatewayStatus: "READY", unavailableChains: [],
  chains: [{ key: "Base_Sepolia", label: "Base Sepolia", domain: 6, nativeSymbol: "ETH", depositWait: "about 20 minutes", wallet: usdc("9000000"), gateway: usdc(gateway) }],
  totals: { wallet: usdc("9000000"), gateway: usdc(gateway), all: usdc("9000000"), offArcWallet: usdc("9000000") },
});
const spec = { version: 1, sourceDomain: 6, destinationDomain: 26, sourceContract: `0x${"0".repeat(64)}`, destinationContract: `0x${"0".repeat(64)}`, sourceToken: `0x${"0".repeat(64)}`, destinationToken: `0x${"0".repeat(64)}`, sourceDepositor: `0x${"0".repeat(24)}${wallet.slice(2).toLowerCase()}`, destinationRecipient: `0x${"0".repeat(24)}${wallet.slice(2).toLowerCase()}`, sourceSigner: `0x${"0".repeat(24)}${wallet.slice(2).toLowerCase()}`, destinationCaller: `0x${"0".repeat(64)}`, value: "1000000", salt: `0x${"5".repeat(64)}` };
const move = (stage: string, extra: Record<string, unknown> = {}) => ({ status: "READY", stage, handle: `handle-${stage}`, sourceKey: "Base_Sepolia", amount: usdc("1000000"), fee: usdc("27233"), forwardingFee: usdc("17233"), recipient: wallet, intent: { maxBlockHeight: "48422385", maxFee: "27233", spec }, transferId: null, mintTxHash: null, message: "", ...extra });
const permit = { deadline: "1790000000", typedData: { primaryType: "Permit", domain: { chainId: 84532 } } };
function serve(responses: unknown[]) {
  const fetcher = vi.fn(async (...args: [string, RequestInit]) => { void args; const next = responses.shift(); if (!next) throw new Error("unexpected request"); return { ok: true, json: async () => next }; });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
const sent = (fetcher: ReturnType<typeof serve>) => fetcher.mock.calls.map(([, init]) => JSON.parse(init.body as string).action);

async function bring(onChanged: () => Promise<unknown>, gateway = "0") {
  render(<GatewayMoveDialog view={viewWith(gateway)} defaultSourceKey="Base_Sepolia" onChanged={onChanged} />);
  await userEvent.click(screen.getByRole("button", { name: /Bring USDC to Arc/ }));
  await userEvent.type(screen.getByLabelText("Amount to move"), "1");
  await userEvent.click(screen.getByRole("button", { name: "Bring 1 USDC to Arc" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.runtime.mockReturnValue({ connection: { address: wallet }, signGatewayIntent: fake.signIntent, signTypedDataOn: fake.signPermit, sendOnChain: fake.sendOnChain });
  fake.signIntent.mockResolvedValue(`0x${"a".repeat(130)}`);
  fake.signPermit.mockResolvedValue(`0x${"11".repeat(32)}${"22".repeat(32)}1b`);
  fake.sendOnChain.mockImplementation(async (_chain: unknown, _calls: unknown, onSent?: (hash: string, index: number) => void) => { onSent?.(hash("d"), 0); return [hash("d")]; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("GatewayMoveDialog", () => {
  it("brings USDC with one button: signs the transfer, deposits with one permit transaction, waits for Gateway, then mints", async () => {
    const fetcher = serve([move("SIGN", { typedData: { primaryType: "BurnIntent" }, deposit: { amountMinor: "1027233", permit } }), move("CONFIRMED", { mintTxHash: hash("e") })]);
    const onChanged = vi.fn(async () => viewWith("1027233"));
    await bring(onChanged);
    const rail = await screen.findByRole("region", { name: "Move progress" });
    await waitFor(() => expect(rail).toHaveTextContent("Done. 1.000000 USDC is in your Arc wallet."));
    expect(sent(fetcher)).toEqual(["MOVE_QUOTE", "MOVE_SUBMIT"]);
    expect(fake.signIntent.mock.invocationCallOrder[0]).toBeLessThan(fake.signPermit.mock.invocationCallOrder[0]);
    expect(fake.signPermit).toHaveBeenCalledWith(expect.objectContaining({ key: "Base_Sepolia" }), permit.typedData);
    const [, calls] = fake.sendOnChain.mock.calls[0] as [unknown, { to: string; data: string }[]];
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(GATEWAY_WALLET);
    expect(calls[0].data.slice(0, 10)).toBe("0x8ef59739");
    expect(fake.signPermit.mock.invocationCallOrder[0]).toBeLessThan(fake.sendOnChain.mock.invocationCallOrder[0]);
    expect(onChanged).toHaveBeenCalled();
    expect(within(rail).getByRole("link", { name: /Open Arc mint/ })).toHaveAttribute("href", "https://testnet.arcscan.app/tx/" + hash("e"));
  });

  it("only signs when Gateway already holds enough", async () => {
    const fetcher = serve([move("SIGN", { typedData: {}, deposit: null }), move("CONFIRMED", { mintTxHash: hash("e") })]);
    await bring(vi.fn(async () => null), "5000000");
    await waitFor(() => expect(screen.getByRole("region", { name: "Move progress" })).toHaveTextContent("Done."));
    expect(sent(fetcher)).toEqual(["MOVE_QUOTE", "MOVE_SUBMIT"]);
    expect(fake.signPermit).not.toHaveBeenCalled();
    expect(fake.sendOnChain).not.toHaveBeenCalled();
  });

  it("falls back to approve and deposit when there is no permit", async () => {
    serve([move("SIGN", { typedData: {}, deposit: { amountMinor: "1027233", permit: null } }), move("CONFIRMED", { mintTxHash: hash("e") })]);
    await bring(vi.fn(async () => viewWith("1027233")));
    await waitFor(() => expect(screen.getByRole("region", { name: "Move progress" })).toHaveTextContent("Done."));
    const [, calls] = fake.sendOnChain.mock.calls[0] as [unknown, unknown[]];
    expect(calls).toHaveLength(2);
    expect(fake.signPermit).not.toHaveBeenCalled();
  });

  it("stops and sends nothing when the permit is rejected in the wallet", async () => {
    const fetcher = serve([move("SIGN", { typedData: {}, deposit: { amountMinor: "1027233", permit } })]);
    fake.signPermit.mockRejectedValueOnce(Object.assign(new Error("User rejected"), { code: 4001 }));
    await bring(vi.fn(async () => null));
    await waitFor(() => expect(screen.getByRole("region", { name: "Move progress" })).toHaveTextContent("The permit was rejected in the wallet. Nothing was sent"));
    expect(sent(fetcher)).toEqual(["MOVE_QUOTE"]);
    expect(fake.sendOnChain).not.toHaveBeenCalled();
  });

  it("keeps the button off when the wallet and Gateway on that chain hold too little", async () => {
    render(<GatewayMoveDialog view={viewWith("0")} defaultSourceKey="Base_Sepolia" onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Bring USDC to Arc/ }));
    await userEvent.type(screen.getByLabelText("Amount to move"), "50");
    expect(screen.getByRole("button", { name: "Bring 50 USDC to Arc" })).toBeDisabled();
    expect(screen.getByText(/Enter less/)).toBeInTheDocument();
  });
});

describe("gatewayMoveProgress", () => {
  it("shows the Gateway credit wait as its own milestone", () => {
    const progress = gatewayMoveProgress({ stage: "credit", outcome: "running", source: "Base Sepolia", wait: "about 20 minutes", amountMinor: "1000000", deposit: true, permit: true, depositMinor: "1027233" });
    expect(progress.steps.map((step) => [step.label, step.state])).toEqual([["Sign", "done"], ["Deposit", "done"], ["Gateway credit", "active"], ["Mint on Arc", "waiting"], ["Done", "waiting"]]);
    expect(progress.caption).toMatch(/credits it after about 20 minutes/);
  });
});
