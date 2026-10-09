// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({ value: new Map<string, boolean>() as Map<string, boolean> | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/live-controls", () => ({ liveControls: vi.fn(async () => controls.value) }));

import { assertLiveAmount, assertLiveReady, reserveLiveUsage } from "./live-readiness";

const proofs = (found: boolean, error = false) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: found ? { wallet_address: "0xaa" } : null, error: error ? {} : null }) }) }) }) }) });
const context = (provider: string, found = true, rpcError: string | null = null) => ({ userId: "u", wallet: { provider, address: "0xAA" }, client: { ...proofs(found), rpc: vi.fn(async () => ({ error: rpcError ? { message: rpcError } : null })) } }) as never;

beforeEach(() => { controls.value = new Map([["PROVIDER:INJECTED_METAMASK", true], ["PROVIDER:CIRCLE_USER_CONTROLLED", false]]); });

describe("live readiness", () => {
  it("does nothing outside the live host", async () => {
    const ctx = context("TEST_SIGNER", false, "rate limit: QUOTE");
    await expect(assertLiveReady(ctx, "LOCAL_ENABLED", "QUOTE")).resolves.toBeUndefined();
    expect(() => assertLiveAmount("LOCAL_ENABLED", "99999999999999")).not.toThrow();
  });
  it("requires an enabled provider, an ownership proof and free usage on the live host", async () => {
    await expect(assertLiveReady(context("INJECTED_METAMASK"), "TESTNET_LIVE", "QUOTE")).resolves.toBeUndefined();
    await expect(assertLiveReady(context("CIRCLE_USER_CONTROLLED"), "TESTNET_LIVE", "QUOTE")).rejects.toMatchObject({ code: "PROVIDER_PAUSED" });
    await expect(assertLiveReady(context("TEST_SIGNER"), "TESTNET_LIVE", "QUOTE")).rejects.toMatchObject({ code: "PROVIDER_PAUSED" });
    await expect(assertLiveReady(context("INJECTED_METAMASK", false), "TESTNET_LIVE", "QUOTE")).rejects.toMatchObject({ code: "OWNERSHIP_REQUIRED", status: 403 });
    await expect(assertLiveReady(context("INJECTED_METAMASK", true, "rate limit: QUOTE"), "TESTNET_LIVE", "QUOTE")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    await expect(assertLiveReady(context("INJECTED_METAMASK", true, "active session required"), "TESTNET_LIVE", "QUOTE")).rejects.toMatchObject({ code: "USAGE_UNAVAILABLE" });
  });
  it("fails closed when the operator controls are unreadable", async () => {
    controls.value = null;
    await expect(assertLiveReady(context("INJECTED_METAMASK"), "TESTNET_LIVE", "QUOTE")).rejects.toMatchObject({ code: "PROVIDER_PAUSED" });
  });
  it("caps live deposits and payments at 1,000 USDC", () => {
    expect(() => assertLiveAmount("TESTNET_LIVE", "1000000000")).not.toThrow();
    expect(() => assertLiveAmount("TESTNET_LIVE", "1000000001")).toThrow(expect.objectContaining({ code: "LIVE_AMOUNT_LIMIT" }));
  });
  it("only reserves usage on the live host", async () => {
    const client = { rpc: vi.fn(async () => ({ error: null })) };
    await reserveLiveUsage(client as never, "PRODUCTION_DISABLED", "ADVANCE");
    expect(client.rpc).not.toHaveBeenCalled();
    await reserveLiveUsage(client as never, "TESTNET_LIVE", "ADVANCE");
    expect(client.rpc).toHaveBeenCalledWith("hodd_reserve_live_usage", { p_kind: "ADVANCE" });
  });
});
