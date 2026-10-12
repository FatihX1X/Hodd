// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EarnAccessError } from "@/lib/earn/security";
import { WALLET } from "@/test/usyc-chain";

const m = vi.hoisted(() => ({
  controls: new Map<string, boolean>() as ReadonlyMap<string, boolean> | null, provider: "INJECTED_METAMASK", authError: null as unknown,
  ready: vi.fn(), quoteSubscribe: vi.fn(), quoteRedeem: vi.fn(), status: vi.fn(), verify: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/live-controls", () => ({ liveControls: async () => m.controls }));
vi.mock("@/lib/earn/server-context", () => ({ earnServerContext: async () => { if (m.authError) throw m.authError; return { client: {}, userId: "user", wallet: { address: WALLET, provider: m.provider } }; } }));
vi.mock("@/lib/execution/live-readiness", async (original) => ({ ...await original<typeof import("@/lib/execution/live-readiness")>(), assertLiveReady: m.ready }));
vi.mock("./status", () => ({ readUsycStatus: m.status }));
vi.mock("./quotes", () => ({ quoteSubscribe: m.quoteSubscribe, quoteRedeem: m.quoteRedeem }));
vi.mock("./verify", () => ({ verifyUsycTransaction: m.verify }));
import { usycHttp } from "./http";
import { UsycError } from "./errors";

const origin = "https://app.hoddfinance.xyz";
const post = (body: unknown, headers: Record<string, string> = { origin, "content-type": "application/json" }) => usycHttp(new Request(`${origin}/api/usyc`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
const get = () => usycHttp(new Request(`${origin}/api/usyc`));
const position = { wallet: WALLET, authority: "OK" };
const hash = `0x${"c".repeat(64)}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL", "1"); vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("HODD_TESTNET_LIVE", "true"); vi.stubEnv("NODE_ENV", "production");
  m.controls = new Map([["EXECUTION", true], ["USYC", true]]); m.provider = "INJECTED_METAMASK"; m.authError = null;
  m.ready.mockResolvedValue(undefined); m.status.mockResolvedValue(position); m.verify.mockResolvedValue({ status: "PENDING", step: "REDEEM", txHash: hash });
  m.quoteSubscribe.mockResolvedValue({ kind: "SUBSCRIBE" }); m.quoteRedeem.mockResolvedValue({ kind: "REDEEM" });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/usyc", () => {
  it("returns the session wallet's position and whether quotes are open", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "READY", position, executionEnabled: true, executionNote: null, walletCanSign: true });
    expect(m.status).toHaveBeenCalledWith(WALLET);
    expect(m.ready).not.toHaveBeenCalled();
  });

  it("keeps reading while quotes are off (a missing USYC row), and says why", async () => {
    m.controls = new Map([["EXECUTION", true]]);
    const body = await (await get()).json();
    expect(body).toMatchObject({ status: "READY", executionEnabled: false, executionNote: expect.stringContaining("switched off by the operator") });
    m.controls = null;
    expect((await (await get()).json()).executionEnabled).toBe(false);
  });

  it("tells the page when the wallet type cannot sign USYC transactions", async () => {
    m.provider = "CIRCLE_USER_CONTROLLED";
    expect((await (await get()).json()).walletCanSign).toBe(false);
    m.provider = "CIRCLE_MODULAR";
    expect((await (await get()).json()).walletCanSign).toBe(true);
  });

  it("answers a signed-out request with a JSON error and reads nothing", async () => {
    m.authError = new EarnAccessError("AUTH_REQUIRED", "Sign in before reviewing Earn operations.", 401);
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: "ERROR", code: "AUTH_REQUIRED", message: "Sign in before reviewing Earn operations." });
    expect(m.status).not.toHaveBeenCalled();
  });

  it("never passes raw read errors to the browser", async () => {
    m.status.mockRejectedValue(new Error("HTTP request failed: https://rpc.testnet.arc.network 429 secret-detail"));
    const response = await get();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ERROR", code: "USYC_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toMatch(/secret|429|rpc\.testnet/);
  });
});

describe("POST /api/usyc quotes", () => {
  it("quotes a subscription for the session wallet after the provider, ownership and usage checks", async () => {
    const response = await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "5000000" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "READY", quote: { kind: "SUBSCRIBE" } });
    expect(m.ready).toHaveBeenCalledWith(expect.objectContaining({ userId: "user" }), "TESTNET_LIVE", "QUOTE");
    expect(m.quoteSubscribe).toHaveBeenCalledWith(WALLET, 5_000_000n);
  });

  it("quotes a redemption by amount or for everything", async () => {
    await post({ action: "QUOTE_REDEEM", sharesMinor: "2000000" });
    expect(m.quoteRedeem).toHaveBeenLastCalledWith(WALLET, { sharesMinor: 2_000_000n });
    await post({ action: "QUOTE_REDEEM", all: true });
    expect(m.quoteRedeem).toHaveBeenLastCalledWith(WALLET, { all: true });
  });

  it("takes the wallet from the session, never from the request", async () => {
    const response = await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "1000000", wallet: "0x00000000000000000000000000000000000000aa" });
    expect(response.status).toBe(400);
    expect(m.quoteSubscribe).not.toHaveBeenCalled();
  });

  it("refuses malformed amounts and both-or-neither redeem fields before any check", async () => {
    for (const body of [{ action: "QUOTE_SUBSCRIBE", amountMinor: "0" }, { action: "QUOTE_SUBSCRIBE", amountMinor: "1.5" }, { action: "QUOTE_SUBSCRIBE" }, { action: "QUOTE_REDEEM" }, { action: "QUOTE_REDEEM", all: true, sharesMinor: "1" }, { action: "NOPE" }, "not json"]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("INVALID_REQUEST");
    }
    expect(m.ready).not.toHaveBeenCalled();
  });

  it("is closed, with a plain message, while the operator's USYC switch is missing or off", async () => {
    for (const controls of [new Map([["EXECUTION", true]]), new Map([["EXECUTION", true], ["USYC", false]]), null]) {
      m.controls = controls;
      const response = await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "1000000" });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ status: "ERROR", code: "USYC_PAUSED" });
    }
    expect(m.ready).not.toHaveBeenCalled();
    expect(m.quoteSubscribe).not.toHaveBeenCalled();
  });

  it("fails closed on a production host that is not the live app host, whatever the body", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const body of [{}, { action: "QUOTE_SUBSCRIBE", amountMinor: "1000000" }]) {
      const response = await post(body);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("PRODUCTION_DISABLED");
    }
    expect(m.quoteSubscribe).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin or non-JSON request", async () => {
    expect((await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "1000000" }, { origin: "https://evil.example", "content-type": "application/json" })).status).toBe(403);
    expect((await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "1000000" }, { origin, "content-type": "text/plain" })).status).toBe(415);
    expect(m.quoteSubscribe).not.toHaveBeenCalled();
  });

  it("refuses wallets that cannot sign these transactions before using up a quote", async () => {
    m.provider = "CIRCLE_USER_CONTROLLED";
    const response = await post({ action: "QUOTE_REDEEM", all: true });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("USYC_WALLET_UNSUPPORTED");
    expect(m.ready).not.toHaveBeenCalled();
    expect(m.quoteRedeem).not.toHaveBeenCalled();
  });

  it("applies the live demo's 1,000 USDC cap to subscriptions only", async () => {
    const response = await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "1000000001" });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("LIVE_AMOUNT_LIMIT");
    expect(m.ready).not.toHaveBeenCalled();
    expect((await post({ action: "QUOTE_REDEEM", sharesMinor: "5000000000" })).status).toBe(200);
  });

  it("stops at the usage limit or an unproven wallet owner without quoting", async () => {
    m.ready.mockRejectedValue(new EarnAccessError("OWNERSHIP_REQUIRED", "Verify that you control this wallet before live testnet operations.", 403));
    const response = await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "1000000" });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("OWNERSHIP_REQUIRED");
    expect(m.quoteSubscribe).not.toHaveBeenCalled();
  });

  it("returns a refusal from the quote builder as it is, and hides anything unexpected", async () => {
    m.quoteSubscribe.mockRejectedValueOnce(new UsycError("USYC_NOT_ALLOWLISTED", "This wallet is not allowlisted for USYC yet.", 403));
    const refused = await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "1000000" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ status: "ERROR", code: "USYC_NOT_ALLOWLISTED", message: "This wallet is not allowlisted for USYC yet." });
    m.quoteSubscribe.mockRejectedValueOnce(new Error("viem: HTTP request failed secret-detail"));
    const broken = await post({ action: "QUOTE_SUBSCRIBE", amountMinor: "1000000" });
    expect(broken.status).toBe(503);
    expect(JSON.stringify(await broken.json())).not.toContain("secret-detail");
  });
});

describe("POST /api/usyc verify", () => {
  it("checks a transaction for the session wallet without needing the quote switches or a usage reservation", async () => {
    m.controls = null;
    const response = await post({ action: "VERIFY", step: "REDEEM", txHash: hash, amountMinor: "770000" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "PENDING", step: "REDEEM", txHash: hash });
    expect(m.verify).toHaveBeenCalledWith({ wallet: WALLET, step: "REDEEM", txHash: hash, amount: 770_000n });
    expect(m.ready).not.toHaveBeenCalled();
  });

  it("needs the approved amount to check an approval, and a real hash", async () => {
    expect((await post({ action: "VERIFY", step: "APPROVE", txHash: hash })).status).toBe(400);
    expect((await post({ action: "VERIFY", step: "SUBSCRIBE", txHash: "0x123" })).status).toBe(400);
    expect((await post({ action: "VERIFY", step: "APPROVE", txHash: hash, amountMinor: "5000000" })).status).toBe(200);
    expect(m.verify).toHaveBeenCalledTimes(1);
  });
});
