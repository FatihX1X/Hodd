import { describe, expect, it } from "vitest";
import { assessTreasury } from "@/lib/treasury/engine";
import { initialWorkspace } from "@/test/fixtures";
import { answerContext, deterministicResult } from "./deterministic";
import { canAnswerInstantly } from "./answers";
const at = new Date("2026-09-27T00:00:00Z");
describe("unified deterministic answers", () => {
  it("disconnected live accounts discard all stored and sample balances", () => {
    const context = answerContext("Summarize my treasury", initialWorkspace, initialWorkspace, assessTreasury(initialWorkspace, at), at);
    expect(context.workspace.totalTreasury.minorUnits).toBe("0"); expect(context.workspace.liquidUsdc.minorUnits).toBe("0");
    expect(context.workspace.strategies.every((strategy) => strategy.balance.minorUnits === "0" && strategy.redeemable.minorUnits === "0")).toBe(true);
    const result = deterministicResult(context, "NOT_CONNECTED"); expect(result.message).toContain("0.00 USDC"); expect(result.message).not.toContain("10,000");
  });
  it("disconnected Turkish answers use zero balances without changing stored inputs", () => {
    const before = JSON.stringify(initialWorkspace);
    const result = deterministicResult(answerContext("Hesabımı özetle", initialWorkspace, null, null, at), "NOT_CONNECTED");
    expect(result.language).toBe("tr"); expect(result.message).toContain("Hazinenizde 0.00 USDC var");
    expect(result.cards[0].fields[0].label).toBe("Toplam hazine"); expect(result.sources?.[0].label).toBe("Genel bakış");
    expect(result.proposal).toBeUndefined(); expect(JSON.stringify(initialWorkspace)).toBe(before);
  });
  it.each(["Can I pay the next bill?", "How long does my cash last?", "What does my policy say?", "Hesabımı özetle", "Sonraki faturayı ödeyebilir miyim?", "Politikam ne diyor?", "Show my allocation preview"])("recognizes %s without interpretation", (question) => {
    expect(canAnswerInstantly(question)).toBe(true);
  });
  it.each(["Create a 500 USDC obligation", "Can you create a 500 USDC bill?", "Update my policy", "Deposit 500 USDC", "Withdraw 100 USDC", "Pay October payroll", "Yes, approve", "500 USDC yatır", "Kira ekle", "Politikamı değiştir", "Onaylıyorum"])("never treats %s as an instant read question", (question) => {
    expect(canAnswerInstantly(question)).toBe(false);
  });
  it.each(["Politikam ne diyor?", "Sonraki faturayı ödeyebilir miyim?", "Nakit ne kadar dayanır?", "Gecikmiş faturalar var mı?", "Yatırılabilir sermaye ne kadar?", "Son hareketler nedir?"])("localizes %s with engine values and structured sources", (question) => {
    const result = deterministicResult(answerContext(question, initialWorkspace, null, null, at), "NOT_CONNECTED");
    expect(result.language).toBe("tr"); expect(result.message).not.toMatch(/Your treasury|The balance|I can answer|All current checks/);
    expect(result.sources?.length).toBeGreaterThan(0); expect(result.followUps?.[0]).toContain("ödeyebilir"); expect(result.proposal).toBeUndefined();
  });
});
