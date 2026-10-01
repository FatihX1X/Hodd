import { describe, expect, it } from "vitest";
import { createSmokeWorkspace } from "./smoke-workspace";
import { initialWorkspace } from "./fixtures";
import { assessTreasury } from "./engine";
import { LocalTreasuryRepository } from "./repository";
describe("isolated Earn smoke workspace", () => {
  it("starts zero-funded with real engine constraints and an explicit label", () => {
    const main = structuredClone(initialWorkspace); const smoke = createSmokeWorkspace();
    expect(smoke.walletConnection).toBeNull(); expect(smoke.totalTreasury.minorUnits).toBe("0"); expect(assessTreasury(smoke).deployableCapital.minorUnits).toBe("0");
    expect(smoke.activities[0].action).toContain("smoke-test"); expect(smoke.policy.safetyBuffer.minorUnits).toBe("1000000"); expect(initialWorkspace).toEqual(main);
  });
  it("does not overwrite the original owner's policy or obligations", () => {
    localStorage.clear(); const main = new LocalTreasuryRepository(localStorage, "alice"); main.save(initialWorkspace);
    const smoke = new LocalTreasuryRepository(localStorage, "alice:smoke"); smoke.save(createSmokeWorkspace());
    expect(main.load().workspace).toEqual(initialWorkspace); expect(smoke.load().workspace.obligations).toHaveLength(0);
  });
});
