import { describe, expect, it } from "vitest";
import { demoTreasury } from "./fixtures";
import { treasuryFixtureSchema } from "./models";

describe("demo treasury fixture", () => {
  it("conforms to the runtime schema", () => {
    expect(treasuryFixtureSchema.safeParse(demoTreasury).success).toBe(true);
  });

  it("uses six-decimal USDC strings and exposes one liquid balance", () => {
    expect(demoTreasury.portfolio.liquidUsdc).toEqual({ currency: "USDC", minorUnits: "10000000000", decimals: 6 });
    expect(demoTreasury.portfolio.allocations).toHaveLength(1);
    expect(demoTreasury.portfolio.allocations[0]?.label).toBe("Liquid USDC");
  });

  it("keeps draft invoice separate from active obligations", () => {
    const active = demoTreasury.obligations.filter((item) => item.status === "UPCOMING");
    const draft = demoTreasury.obligations.filter((item) => item.status === "DRAFT");
    expect(active).toHaveLength(2);
    expect(draft).toHaveLength(1);
  });
});
