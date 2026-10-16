// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./store", () => ({ agentDb: () => ({ rpc: m.rpc }) }));
import { autopilotSecret, resetAutopilotSecrets } from "./secrets";

beforeEach(() => { resetAutopilotSecrets(); m.rpc.mockReset(); vi.unstubAllEnvs(); });
afterEach(() => vi.unstubAllEnvs());

describe("autopilotSecret", () => {
  it("prefers the environment and never asks the database then", async () => {
    vi.stubEnv("GROQ_API_KEY", " env-key ");
    expect(await autopilotSecret("groq_api_key")).toBe("env-key");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("reads Vault through the service-role function and caches for five minutes", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    m.rpc.mockResolvedValue({ data: "vault-key", error: null });
    expect(await autopilotSecret("groq_api_key", 0)).toBe("vault-key");
    expect(await autopilotSecret("groq_api_key", 60_000)).toBe("vault-key");
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("hodd_autopilot_secret", { p_name: "groq_api_key" });
    expect(await autopilotSecret("groq_api_key", 6 * 60_000)).toBe("vault-key");
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });

  it("answers null for a missing secret or a failed read, and does not cache a failure", async () => {
    vi.stubEnv("AUTOPILOT_SCHEDULER_SECRET", "");
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } }).mockResolvedValueOnce({ data: "tick", error: null });
    expect(await autopilotSecret("autopilot_scheduler_secret", 0)).toBeNull();
    expect(await autopilotSecret("autopilot_scheduler_secret", 1)).toBe("tick");
    m.rpc.mockRejectedValue(new Error("down"));
    resetAutopilotSecrets();
    expect(await autopilotSecret("autopilot_scheduler_secret", 2)).toBeNull();
  });
});
