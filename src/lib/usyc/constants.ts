import { getAddress, parseAbi } from "viem";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";

// Circle USYC (tokenized money-market fund) on Arc Testnet. Verified sources on explorer.testnet.arc.io;
// docs: developers.circle.com/tokenized/usyc and docs.arc.io/arc/references/contract-addresses.
/** Teller for USDC: `deposit` subscribes, `redeem` is an instant redemption paid from the fund treasury. */
export const USYC_TELLER = getAddress("0x9fdF14c5B14173D74C08Af27AebFf39240dC105A");
/** The USYC share token (ERC-20, 6 decimals). `transfer`/`transferFrom` need BOTH parties allowlisted. */
export const USYC_TOKEN = getAddress("0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C");
/** Entitlements `RolesAuthority`: `canCall` is the allowlist. When paused every check reverts with `NoAccess`. */
export const USYC_AUTHORITY = getAddress("0xcc205224862c7641930c87679e98999d23c26113");
export const USYC_USDC = ARC_TESTNET_USDC;

/** `bytes4` selectors the authority is asked about (checked against `toFunctionSelector` in the tests). */
export const SELECTOR_DEPOSIT = "0x6e553f65" as const; // deposit(uint256,address)
export const SELECTOR_REDEEM = "0xba087652" as const; // redeem(uint256,address,address)
export const SELECTOR_TRANSFER = "0xa9059cbb" as const; // transfer(address,uint256)

export const tellerAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address account) returns (uint256 assets)",
  "function previewDepositData(address account, uint256 assets) view returns (uint256 shares, uint256 fee, int256 price)",
  "function previewRedeemData(address account, uint256 shares) view returns (uint256 assets, uint256 fee, int256 price)",
  "function convertToAssets(uint256 shares) view returns (uint256 assets)",
  "function maxRedeem(address account) view returns (uint256 maxShares)",
  "function todayTimestamp() view returns (uint256)",
  "function subscriptionLimitRemaining(address account, uint256 date) view returns (uint256 assets)",
  "function redemptionLimitRemaining(address account, uint256 date) view returns (uint256 assets)",
  "function subscriptionFeeRate(address account) view returns (uint256 rate)",
  "function redemptionFeeRate(address account) view returns (uint256 rate)",
  // The after-hours cutoff as HHMM New York time (1400), not a flag. Pricing is detected by comparing
  // the subscribe price with the latest price instead (see `afterHoursPricing`).
  "function afterHourTrading() view returns (uint256)",
  "event Subscribe(address indexed from, address indexed receiver, uint256 assets, uint256 shares, uint256 price, uint256 fee)",
  "event Redeem(address indexed from, address indexed receiver, uint256 assets, uint256 shares, uint256 price, uint256 fee)",
  "error NotPermissioned()",
  "error LimitExceeded()",
  "error ZeroShares()",
  "error ZeroAssets()",
]);

export const authorityAbi = parseAbi([
  "function canCall(address user, address target, bytes4 functionSig) view returns (bool)",
  "function paused() view returns (bool)",
  "error NoAccess()",
]);

export const usycTokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 amount)",
]);

/** USDC reads and writes the flow needs (balance, exact approval). */
export const usdcAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

/**
 * Storage slot of `allowance[owner][spender]` in Arc Testnet's USDC contract (mapping at slot 10).
 * Used only to simulate the deposit as if the exact approval had already been mined; read-only.
 */
export const USDC_ALLOWANCE_MAPPING_SLOT = 10n;

/**
 * Gas used when the deposit cannot be simulated (the node rejects the state override). Measured on Arc Testnet:
 * a first subscription used 243,799 gas (tx 0x6d5c173e…bfeb15); a repeat subscription simulated at about
 * 215,262. 300,000 keeps ~23% over the worst case seen; the usual 20% buffer is added on top.
 */
export const USYC_DEPOSIT_GAS_FALLBACK = 300_000n;

/** The oracle price has 18 decimals; USYC and USDC have 6. */
export const PRICE_SCALE = 10n ** 18n;
export const ARCSCAN_TX = "https://testnet.arcscan.app/tx/";
export const USYC_DOCS_URL = "https://developers.circle.com/tokenized/usyc/subscribe-and-redeem";
