import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { ownershipIssuedAtValid, ownershipMessage } from "./ownership";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);

describe("wallet ownership proofs", () => {
  it("binds the account, wallet and chain into a signable message", async () => {
    const issuedAt = "2026-10-09T10:00:00.000Z";
    const message = ownershipMessage("user-a", account.address.toLowerCase(), issuedAt);
    expect(message).toContain("Account: user-a"); expect(message).toContain(`Wallet: ${account.address}`); expect(message).toContain("5042002");
    const signature = await account.signMessage({ message });
    expect(await verifyMessage({ address: account.address, message, signature })).toBe(true);
    // A proof for one Hodd account is useless to another.
    expect(await verifyMessage({ address: account.address, message: ownershipMessage("user-b", account.address, issuedAt), signature })).toBe(false);
  });
  it("accepts only a fresh, canonical timestamp", () => {
    const now = Date.parse("2026-10-09T10:00:00.000Z");
    expect(ownershipIssuedAtValid("2026-10-09T09:55:00.000Z", now)).toBe(true);
    expect(ownershipIssuedAtValid("2026-10-09T09:49:00.000Z", now)).toBe(false);
    expect(ownershipIssuedAtValid("2026-10-09T10:11:00.000Z", now)).toBe(false);
    expect(ownershipIssuedAtValid("2026-10-09T09:55:00Z", now)).toBe(false);
    expect(ownershipIssuedAtValid("yesterday", now)).toBe(false);
  });
});
