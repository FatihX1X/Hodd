// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { usycExecutionState, usycGate } from "./access";

const live = { nodeEnv: "production", vercel: "1", vercelEnv: "production", liveFlag: "true" };
const local = { nodeEnv: "development", localFlag: "true" };
const on = new Map([["EXECUTION", true], ["USYC", true]]);
const post = (origin: string | null, host = "app.hoddfinance.xyz", contentType = "application/json") => new Request(`${host.startsWith("localhost") ? "http" : "https"}://${host}/api/usyc`, { method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": contentType } });

describe("USYC access", () => {
  it("opens quotes on the live host only while both operator switches are on", async () => {
    expect(await usycGate(post("https://app.hoddfinance.xyz"), live, async () => on, true)).toEqual({ allowed: true, mode: "TESTNET_LIVE" });
    for (const controls of [null, new Map<string, boolean>(), new Map([["EXECUTION", true]]), new Map([["EXECUTION", true], ["USYC", false]]), new Map([["EXECUTION", false], ["USYC", true]])]) {
      expect(await usycGate(post("https://app.hoddfinance.xyz"), live, async () => controls, true)).toMatchObject({ allowed: false, code: "USYC_PAUSED", status: 503 });
    }
  });

  it("treats a missing USYC row as off for quotes but never needs the switches for a read-only check", async () => {
    const loader = vi.fn(async () => new Map([["EXECUTION", true]]));
    expect(await usycGate(post("https://app.hoddfinance.xyz"), live, loader, false)).toEqual({ allowed: true, mode: "TESTNET_LIVE" });
    expect(loader).not.toHaveBeenCalled();
    expect(usycExecutionState(post(null), live, new Map([["EXECUTION", true]]))).toMatchObject({ open: false, note: expect.stringContaining("switched off by the operator") });
    expect(usycExecutionState(post(null), live, on)).toEqual({ open: true, mode: "TESTNET_LIVE", note: null });
  });

  it("fails closed on other hosts, wrong origins and non-JSON bodies, before loading any switch", async () => {
    const loader = vi.fn(async () => on);
    expect(await usycGate(post("https://app.hoddfinance.xyz", "preview.vercel.app"), live, loader, true)).toMatchObject({ allowed: false, code: "PRODUCTION_DISABLED", status: 403 });
    expect(await usycGate(post("https://evil.example"), live, loader, true)).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH", status: 403 });
    expect(await usycGate(post(null), live, loader, true)).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
    expect(await usycGate(post("https://app.hoddfinance.xyz", "app.hoddfinance.xyz", "text/plain"), live, loader, true)).toMatchObject({ allowed: false, code: "JSON_REQUIRED", status: 415 });
    expect(loader).not.toHaveBeenCalled();
  });

  it("opens a local build only with the local execution flag", async () => {
    const request = post("http://localhost:3000", "localhost:3000");
    expect(await usycGate(request, local, async () => on, true)).toEqual({ allowed: true, mode: "LOCAL_ENABLED" });
    expect(await usycGate(request, { nodeEnv: "development" }, async () => on, true)).toMatchObject({ allowed: false, code: "EXECUTION_DISABLED" });
    expect(usycExecutionState(request, { nodeEnv: "development" }, on)).toMatchObject({ open: false, note: expect.stringContaining("local build") });
  });
});
