import { describe, expect, it } from "vitest";
import { ARC_TESTNET_USDC, EARN_VAULT_ALLOWLIST, allowedVault, isAllowedVault } from "./allowlist";

describe("Earn vault allowlist", () => {
  it("contains only verified canonical Arc Testnet USDC Morpho entries", () => { expect(EARN_VAULT_ALLOWLIST.length).toBeGreaterThan(0); for (const vault of EARN_VAULT_ALLOWLIST) { expect(vault.chainId).toBe(5_042_002); expect(vault.assetAddress).toBe(ARC_TESTNET_USDC); expect(vault.protocol).toBe("MORPHO"); expect(BigInt(vault.verifiedBlock)).toBeGreaterThan(0n); } });
  it("accepts checksummed variants but rejects arbitrary vaults", () => { const vault = EARN_VAULT_ALLOWLIST[0]; expect(isAllowedVault(vault.address.toLowerCase())).toBe(true); expect(allowedVault(vault.address)).toEqual(vault); expect(isAllowedVault("0x0000000000000000000000000000000000000001")).toBe(false); });
});
