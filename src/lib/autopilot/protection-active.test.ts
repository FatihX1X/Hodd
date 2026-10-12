// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ context: vi.fn(), mandate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/server-context", () => ({ earnServerContext: m.context }));
vi.mock("./store", () => ({ loadMandate: m.mandate }));
import { autopilotActiveResponse } from "./protection-context";
beforeEach(() => { vi.clearAllMocks(); m.context.mockResolvedValue({ userId: "user" }); });
describe("console Autopilot mode", () => {
  it("answers 200 with only the active flag, and false for signed-out, paused, returning or unreadable mandates", async () => {
    m.mandate.mockResolvedValue({ mandate: { enabled: true, paused: false }, return_requested: false });
    let response = await autopilotActiveResponse(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ active: true });
    for (const row of [{ mandate: { enabled: true, paused: true }, return_requested: false }, { mandate: { enabled: true, paused: false }, return_requested: true }, null]) {
      m.mandate.mockResolvedValue(row); response = await autopilotActiveResponse(); expect(await response.json()).toEqual({ active: false });
    }
    m.mandate.mockRejectedValue(new Error("db")); expect(await (await autopilotActiveResponse()).json()).toEqual({ active: false });
    m.context.mockRejectedValue(new Error("AUTH_REQUIRED")); response = await autopilotActiveResponse(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ active: false });
  });
});
