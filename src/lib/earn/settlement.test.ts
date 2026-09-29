import { describe, expect, it } from "vitest";
import { redeemAllSettlementStatus } from "./settlement";
import type { EarnPosition } from "./models";

const position = (shares: string): EarnPosition => ({ walletAddress: "0x0000000000000000000000000000000000000001", vaultAddress: "0x0000000000000000000000000000000000000002", vaultName: "Vault", currentBalance: { currency: "USDC", decimals: 6, minorUnits: "0" }, maxWithdrawable: { currency: "USDC", decimals: 6, minorUnits: "0" }, redeemable: { currency: "USDC", decimals: 6, minorUnits: "0" }, liquidityStatus: "READY", shares, apyBps: 0, pnl: { status: "PENDING" }, observedAt: "2026-09-28T12:00:00.000Z" });
describe("redeem-all settlement", () => { it("requires review when residual shares remain", () => { expect(redeemAllSettlementStatus(position("0.000001"))).toBe("PARTIAL"); expect(redeemAllSettlementStatus(position("0"))).toBe("COMPLETE"); }); it("reports unknown when the post-submit read fails", () => { expect(redeemAllSettlementStatus(null, false)).toBe("UNKNOWN"); }); });
