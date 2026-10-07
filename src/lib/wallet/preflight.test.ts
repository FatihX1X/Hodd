import { describe, expect, it } from "vitest";
import { WalletPreflightError, walletPreflight } from "./preflight";

describe("wallet preflight submission boundary", () => {
  it("sanitizes RPC failures before signing", async () => {
    const error = await walletPreflight(async () => { throw new Error("secret-RPC-request"); }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(WalletPreflightError);
    expect(error).toMatchObject({ code: "WALLET_PREFLIGHT_FAILED" });
    expect(String(error)).not.toContain("secret-RPC-request");
  });
  it("preserves safe known fee errors and successful checks", async () => {
    const error = new WalletPreflightError("FEE_RESERVE_EXCEEDED", "Gas exceeds the reserve.");
    await expect(walletPreflight(async () => { throw error; })).rejects.toBe(error);
    await expect(walletPreflight(async () => 21000n)).resolves.toBe(21000n);
  });
});
