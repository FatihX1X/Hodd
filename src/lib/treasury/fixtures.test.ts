import { describe, expect, it } from "vitest";
import { initialWorkspace } from "@/test/fixtures";
import { treasuryWorkspaceSchema } from "./models";
import { assessTreasury } from "./engine";

describe("Stage 2 fixture", () => {
  it("passes runtime validation", () => { expect(treasuryWorkspaceSchema.safeParse(initialWorkspace).success).toBe(true); });
  it("produces the canonical 4,500 USDC deployable result", () => { const result = assessTreasury(initialWorkspace, new Date("2026-09-27T10:00:00.000Z")); expect(result.upcomingObligations.minorUnits).toBe("4500000000"); expect(result.protectedCapital.minorUnits).toBe("5500000000"); expect(result.deployableCapital.minorUnits).toBe("4500000000"); });
});
