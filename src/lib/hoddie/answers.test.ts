import { describe, expect, it } from "vitest";
import { assessTreasury } from "@/lib/treasury/engine";
import { initialWorkspace, usdc } from "@/test/fixtures";
import { answerQuestion, starterPrompts, type HoddieReply } from "./answers";

const at = new Date("2026-09-27T00:00:00.000Z");
const ask = (question: string, workspace = structuredClone(initialWorkspace)): HoddieReply => answerQuestion({ question, workspace, assessment: assessTreasury(workspace, at), evaluatedAt: at });
const text = (reply: HoddieReply) => [...reply.paragraphs, ...(reply.facts ?? []).map((fact) => `${fact.label} ${fact.value}`)].join(" ");

describe("Hoddie answers", () => {
  it("checks the next bill against reserves and says it is covered", () => {
    const reply = ask("Can I pay the next bill?");
    expect(reply.status).toEqual({ label: "SAFE", tone: "success" });
    expect(text(reply)).toMatch(/October payroll is covered/);
    expect(reply.facts?.find((fact) => fact.label === "Available after reserves")?.value).toBe("9,000.00 USDC");
    expect(reply.sources.map((source) => source.href)).toContain("/obligations");
  });

  it("finds a named obligation and reports a shortfall when it cannot be covered", () => {
    const workspace = structuredClone(initialWorkspace);
    workspace.liquidUsdc = usdc("3000000000"); workspace.totalTreasury = usdc("3000000000");
    workspace.strategies = workspace.strategies.map((strategy) => strategy.kind === "LIQUID" ? { ...strategy, balance: usdc("3000000000"), redeemable: usdc("3000000000") } : strategy);
    const reply = ask("Can I cover the October payroll?", workspace);
    expect(reply.status).toEqual({ label: "AT_RISK", tone: "danger" });
    expect(text(reply)).toMatch(/short by 2,000.00 USDC/);
  });

  it("explains that a draft is not protected instead of checking it", () => {
    const reply = ask("Can I pay Invoice #104?");
    expect(text(reply)).toMatch(/draft/);
    expect(reply.status?.label).toBe("DRAFT");
  });

  it("lists what is due with a total", () => {
    const reply = ask("What is due in the next 30 days?");
    expect(reply.paragraphs[0]).toMatch(/2 obligations are protected.*4,500.00 USDC in total/);
    expect(reply.facts?.map((fact) => fact.label.split(" · ")[1])).toEqual(["October payroll", "AWS infrastructure"]);
  });

  it("projects the runway and flags a shortfall", () => {
    expect(ask("How long does my cash last?").status?.tone).toBe("success");
    const workspace = structuredClone(initialWorkspace);
    workspace.obligations = [{ ...workspace.obligations[0], id: "big", dueAt: "2026-10-01T00:00:00.000Z", amount: usdc("12000000000") }];
    const reply = ask("when will I run out of cash?", workspace);
    expect(reply.status?.tone).toBe("danger");
    expect(text(reply)).toMatch(/falls below zero on Oct 1/);
  });

  it("answers deployable capital and refuses to deploy it", () => {
    const reply = ask("How much can I put to work?");
    expect(reply.paragraphs[0]).toMatch(/4,500.00 USDC is deployable/);
    expect(text(reply)).toMatch(/cannot deploy capital/);
    expect(reply.facts?.map((fact) => fact.label)).toEqual(expect.arrayContaining(["Morpho cap", "Morpho APY"]));
  });

  it("summarizes the policy and its checks", () => {
    const reply = ask("What does my policy say?");
    expect(reply.paragraphs[0]).toMatch(/1,000.00 USDC safety buffer/);
    expect(reply.status).toEqual({ label: "ALL CHECKS PASS", tone: "success" });
  });

  it("reports recent activity", () => {
    expect(ask("what happened recently?").facts?.[0].value).toBe("Treasury Engine baseline evaluated");
  });

  it("declines requests to change data or move money", () => {
    for (const prompt of ["Create an obligation for rent", "Send 500 USDC to the landlord", "update my safety buffer"]) {
      const reply = ask(prompt);
      expect(text(reply)).toMatch(/cannot change it or move funds/);
    }
  });

  it("does not answer from stale data when the engine is paused", () => {
    const reply = answerQuestion({ question: "balance", workspace: structuredClone(initialWorkspace), assessment: null, evaluatedAt: at });
    expect(reply.status?.label).toBe("PAUSED");
  });

  it("falls back to suggestions, and every starter prompt gets a real answer", () => {
    expect(ask("blorp").followUps).toEqual([...starterPrompts]);
    for (const prompt of starterPrompts) expect(ask(prompt).paragraphs[0]).not.toMatch(/did not catch that/);
  });

  it("never names the model behind a reply", () => {
    for (const prompt of ["who are you", "what model are you", ...starterPrompts]) expect(JSON.stringify(ask(prompt))).not.toMatch(/gemini|nvidia|gpt|claude/i);
  });
});
