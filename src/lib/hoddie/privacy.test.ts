import { describe, expect, it } from "vitest";
import { initialWorkspace } from "@/test/fixtures";
import { dueDate, maskCommand, percentageBps, slotValue } from "./privacy";
import { intentSchema } from "./models";

describe("Hoddie private input boundary", () => {
  it("masks known account strings, email, address, amount, date and a new quoted title", () => {
    const address = `0x${"1".repeat(40)}`;
    const command = maskCommand(`October payroll 1250.123456 USDC due 2026-10-20 to ${address} me@example.com named "New rent" Payroll batch · 8 recipients`, initialWorkspace);
    for (const privateValue of ["October payroll", "1250.123456", "2026-10-20", address, "me@example.com", "New rent", "Payroll batch"]) expect(command.text).not.toContain(privateValue);
    expect(Object.values(command.slots).find((slot) => slot.type === "AMOUNT")?.value).toBe("1250.123456");
    expect(command.text).toContain("USDC");
    expect(initialWorkspace.obligations[0].title).toBe("October payroll");
  });
  it("preserves ambiguous titles for a user selection instead of guessing", () => {
    const workspace = structuredClone(initialWorkspace);
    workspace.obligations.push({ ...workspace.obligations[0], id: "other-payroll" });
    const command = maskCommand("October payroll tutarını 20,50 USDC yap", workspace);
    expect(Object.values(command.slots).find((slot) => slot.type === "OBLIGATION")?.obligationIds).toEqual(["obl-payroll-oct", "other-payroll"]);
    expect(Object.values(command.slots).find((slot) => slot.type === "AMOUNT")?.value).toBe("20.50");
  });
  it.each(["-5 USDC", "1,000 USDC", "500 BTC", "1 ETH", "100 EUR", "500 USD", "$50", "50 ₺", "TRY 500"])("rejects ambiguous/non-USDC input %s", (input) => {
    expect(() => maskCommand(input, initialWorkspace)).toThrow();
  });
  it.each(["[AMOUNT1]", `sk-${"x".repeat(30)}`, `0x${"a".repeat(64)}`, "my private key", "entity secret"])("rejects credential/internal input %s", (input) => {
    expect(() => maskCommand(input, initialWorkspace)).toThrow();
  });
  it("rejects invented tokens and incorrect token types", () => {
    const command = maskCommand("10 USDC", initialWorkspace);
    expect(slotValue(command, "[AMOUNT1]", "AMOUNT")).toBe("10");
    expect(() => slotValue(command, "[AMOUNT2]", "AMOUNT")).toThrow("missing");
    expect(() => slotValue(command, "[AMOUNT1]", "ADDRESS")).toThrow("incompatible");
  });
  it("uses integer percentage conversion and real calendar dates", () => {
    expect(percentageBps("12.34")).toBe(1234);
    expect(percentageBps("1000")).toBe(100000);
    for (const value of ["1.234", "-1", "Infinity", "1001"]) expect(() => percentageBps(value)).toThrow();
    expect(dueDate("TODAY", undefined, "Europe/Istanbul", new Date("2026-10-08T22:00:00Z"))).toBe("2026-10-09");
    expect(dueDate("TOMORROW", undefined, "UTC", new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
    for (const value of ["2026-02-30", "2026-13-01", "2026-00-01"]) expect(() => dueDate("EXPLICIT", value, "UTC")).toThrow("valid");
    expect(() => dueDate("TODAY", undefined, "invented/timezone")).toThrow("timezone");
  });
  it("the model cannot output an amount, arbitrary route or execution tool", () => {
    expect(intentSchema.safeParse({ action: "EXECUTE", amount: "1" }).success).toBe(false);
  });
});
