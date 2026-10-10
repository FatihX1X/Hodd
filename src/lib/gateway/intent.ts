import { getAddress, isAddress, pad, zeroAddress } from "viem";
import { z } from "zod";
import { ARC_GATEWAY_CHAIN, GATEWAY_MINTER, GATEWAY_WALLET, type GatewayChain } from "./chains";

// Burn intent format from Circle's evm-gateway-contracts (BurnIntents.sol), as
// used by @circle-fin/provider-gateway-v1: EIP-712 domain {name, version} only.
const bytes32 = z.string().regex(/^0x[\da-fA-F]{64}$/);
const integer = z.string().regex(/^\d+$/);
export const transferSpecSchema = z.object({
  version: z.literal(1), sourceDomain: z.number().int().nonnegative(), destinationDomain: z.number().int().nonnegative(),
  sourceContract: bytes32, destinationContract: bytes32, sourceToken: bytes32, destinationToken: bytes32,
  sourceDepositor: bytes32, destinationRecipient: bytes32, sourceSigner: bytes32, destinationCaller: bytes32,
  value: integer, salt: bytes32, hookData: z.string().regex(/^0x([\da-fA-F]{2})*$/).optional(),
});
export const burnIntentSchema = z.object({ maxBlockHeight: integer, maxFee: integer, spec: transferSpecSchema });
export type TransferSpec = z.infer<typeof transferSpecSchema>;
export type BurnIntent = z.infer<typeof burnIntentSchema>;

export const toBytes32 = (address: string) => pad(getAddress(address), { size: 32 }).toLowerCase() as `0x${string}`;
export function fromBytes32(value: string) {
  if (!/^0x0{24}[\da-fA-F]{40}$/.test(value)) throw new Error("NOT_AN_ADDRESS");
  return getAddress(`0x${value.slice(26)}`);
}

export function randomSalt() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

/** Gateway → Arc spec. The depositor signs for itself; any caller may submit the mint. */
export function buildArcTransferSpec(input: { source: GatewayChain; depositor: string; recipient: string; valueMinor: bigint; salt?: `0x${string}` }): TransferSpec {
  if (!isAddress(input.depositor) || !isAddress(input.recipient) || getAddress(input.recipient) === zeroAddress) throw new Error("INVALID_ADDRESS");
  if (input.valueMinor <= 0n) throw new Error("INVALID_AMOUNT");
  const depositor = toBytes32(input.depositor);
  return {
    version: 1, sourceDomain: input.source.domain, destinationDomain: ARC_GATEWAY_CHAIN.domain,
    sourceContract: toBytes32(GATEWAY_WALLET), destinationContract: toBytes32(GATEWAY_MINTER),
    sourceToken: toBytes32(input.source.usdc), destinationToken: toBytes32(ARC_GATEWAY_CHAIN.usdc),
    sourceDepositor: depositor, destinationRecipient: toBytes32(input.recipient), sourceSigner: depositor,
    destinationCaller: toBytes32(zeroAddress), value: input.valueMinor.toString(), salt: input.salt ?? randomSalt(),
  };
}

const WORD_KEYS = ["sourceContract", "destinationContract", "sourceToken", "destinationToken", "sourceDepositor", "destinationRecipient", "sourceSigner", "destinationCaller", "salt"] as const;
/** The API answers with 20-byte addresses; the signed spec keeps 32-byte words. */
const word = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[\da-fA-F]{1,64}$/.test(value)) throw new Error("SPEC_INVALID");
  return `0x${value.slice(2).padStart(64, "0")}`.toLowerCase();
};

/** The estimate endpoint fills maxBlockHeight/maxFee; it must never change what we built. */
export function assertSameSpec(actual: Record<string, unknown>, expected: TransferSpec) {
  for (const key of ["version", "sourceDomain", "destinationDomain"] as const) if (actual[key] !== expected[key]) throw new Error(`SPEC_CHANGED:${key}`);
  if (String(actual.value) !== expected.value) throw new Error("SPEC_CHANGED:value");
  for (const key of WORD_KEYS) if (word(actual[key]) !== word(expected[key])) throw new Error(`SPEC_CHANGED:${key}`);
  if ((actual.hookData ?? "0x") !== "0x" || (expected.hookData ?? "0x") !== "0x") throw new Error("SPEC_CHANGED:hookData");
}

export const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" }, { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" }, { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" }, { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
} as const;
export const GATEWAY_EIP712_DOMAIN = { name: "GatewayWallet", version: "1" } as const;

/** viem-ready EIP-712 payload (bigints for uint fields). */
export function burnIntentTypedData(intent: BurnIntent) {
  const spec = intent.spec;
  return {
    domain: GATEWAY_EIP712_DOMAIN, types: BURN_INTENT_TYPES, primaryType: "BurnIntent" as const,
    message: {
      maxBlockHeight: BigInt(intent.maxBlockHeight), maxFee: BigInt(intent.maxFee),
      spec: { ...spec, sourceContract: spec.sourceContract as `0x${string}`, destinationContract: spec.destinationContract as `0x${string}`, sourceToken: spec.sourceToken as `0x${string}`, destinationToken: spec.destinationToken as `0x${string}`, sourceDepositor: spec.sourceDepositor as `0x${string}`, destinationRecipient: spec.destinationRecipient as `0x${string}`, sourceSigner: spec.sourceSigner as `0x${string}`, destinationCaller: spec.destinationCaller as `0x${string}`, salt: spec.salt as `0x${string}`, value: BigInt(spec.value), hookData: (spec.hookData ?? "0x") as `0x${string}` },
    },
  };
}

/** JSON form for eth_signTypedData_v4 (wallets expect decimal strings, not bigints). */
export function burnIntentTypedDataJson(intent: BurnIntent) {
  return {
    domain: GATEWAY_EIP712_DOMAIN, primaryType: "BurnIntent",
    types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }], ...BURN_INTENT_TYPES },
    message: { maxBlockHeight: intent.maxBlockHeight, maxFee: intent.maxFee, spec: { ...intent.spec, hookData: intent.spec.hookData ?? "0x" } },
  };
}
