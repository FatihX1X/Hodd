// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({})); vi.mock("./store", () => ({ loadMandate: load }));
import { loadProtectionContext } from "./protection-context";
import { autopilotIsActive } from "./protection";
beforeEach(() => { load.mockReset(); });
describe("Autopilot protection context", () => {
  it.each([null, {}, { mandate: { enabled: true } }, { mandate: { enabled: true, paused: true }, returnRequested: false }, { mandate: { enabled: true, paused: false }, returnRequested: true }])("retains manual mode for %j", (status) => expect(autopilotIsActive(status)).toBe(false));
  it("reads the existing mandate and retains manual mode for missing data", async () => {
    load.mockResolvedValue({ mandate: { enabled: true, paused: false }, return_requested: false }); expect(await loadProtectionContext("alice")).toEqual({ autopilotActive: true });
    expect(await loadProtectionContext("alice", "SMOKE_TEST")).toEqual({ autopilotActive: false }); expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValue(null); expect(await loadProtectionContext("alice")).toEqual({ autopilotActive: false });
  });
  it("retains manual mode when a mandate read fails", async () => {
    load.mockRejectedValue(new Error("Unavailable")); expect(await loadProtectionContext("alice")).toEqual({ autopilotActive: false });
  });
});
