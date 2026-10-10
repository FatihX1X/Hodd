// @vitest-environment node
import { decodeFunctionData, encodeAbiParameters, erc20Abi, keccak256, pad, toHex, verifyTypedData, zeroAddress, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: {} }));

import { ARC_GATEWAY_CHAIN, GATEWAY_CHAINS, GATEWAY_MINTER, GATEWAY_WALLET, gatewayChainByKey } from "./chains";
import { gatewayDepositCalls, parseUsdcInput } from "./deposit-calls";
import { assertSameSpec, buildArcTransferSpec, burnIntentTypedData, burnIntentTypedDataJson, fromBytes32, toBytes32 } from "./intent";
import { decimalToMinor } from "./api";
import { verifyGatewayMintReceipt } from "./receipts";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const recipient = "0x62dCe01b1a7B9a6f592f148d305E0D5751478386";
const base = gatewayChainByKey("Base_Sepolia")!;

describe("Gateway chains", () => {
  it("lists unique EVM testnets with Arc first", () => {
    expect(ARC_GATEWAY_CHAIN).toMatchObject({ key: "Arc_Testnet", domain: 26, chainId: 5_042_002, usdc: "0x3600000000000000000000000000000000000000" });
    expect(new Set(GATEWAY_CHAINS.map((item) => item.domain)).size).toBe(GATEWAY_CHAINS.length);
    expect(new Set(GATEWAY_CHAINS.map((item) => item.chainId)).size).toBe(GATEWAY_CHAINS.length);
  });
});

describe("burn intent", () => {
  const spec = buildArcTransferSpec({ source: base, depositor: account.address, recipient, valueMinor: 1_500_000n, salt: `0x${"ab".repeat(32)}` });
  it("targets Arc with 32-byte words and the third-party recipient", () => {
    expect(spec).toMatchObject({ version: 1, sourceDomain: 6, destinationDomain: 26, value: "1500000", destinationCaller: pad(zeroAddress, { size: 32 }) });
    expect(fromBytes32(spec.destinationRecipient)).toBe(recipient);
    expect(fromBytes32(spec.sourceContract)).toBe(GATEWAY_WALLET);
    expect(fromBytes32(spec.destinationContract)).toBe(GATEWAY_MINTER);
    expect(fromBytes32(spec.sourceToken)).toBe(base.usdc);
    expect(spec.sourceDepositor).toBe(spec.sourceSigner);
    expect(() => buildArcTransferSpec({ source: base, depositor: account.address, recipient: zeroAddress, valueMinor: 1n })).toThrow();
    expect(() => buildArcTransferSpec({ source: base, depositor: account.address, recipient, valueMinor: 0n })).toThrow();
  });
  it("accepts the API's 20-byte echo but rejects any changed field", () => {
    const echo = { ...spec, sourceContract: GATEWAY_WALLET.toLowerCase(), destinationRecipient: recipient.toLowerCase(), hookData: "0x" };
    expect(() => assertSameSpec(echo, spec)).not.toThrow();
    expect(() => assertSameSpec({ ...echo, destinationRecipient: account.address }, spec)).toThrow("destinationRecipient");
    expect(() => assertSameSpec({ ...echo, value: "1500001" }, spec)).toThrow("value");
    expect(() => assertSameSpec({ ...echo, destinationDomain: 6 }, spec)).toThrow("destinationDomain");
    expect(() => assertSameSpec({ ...echo, hookData: "0x01" }, spec)).toThrow("hookData");
  });
  it("produces an EIP-712 signature only the depositor can make", async () => {
    const intent = { maxBlockHeight: "67851365", maxFee: "21387", spec };
    const typed = burnIntentTypedData(intent);
    const signature = await account.signTypedData(typed);
    expect(await verifyTypedData({ address: account.address, ...typed, signature })).toBe(true);
    expect(await verifyTypedData({ address: recipient, ...typed, signature })).toBe(false);
    expect(await verifyTypedData({ address: account.address, ...burnIntentTypedData({ ...intent, maxFee: "21388" }), signature })).toBe(false);
    expect(burnIntentTypedDataJson(intent)).toMatchObject({ primaryType: "BurnIntent", domain: { name: "GatewayWallet", version: "1" }, message: { maxFee: "21387" } });
  });
});

describe("amounts and deposit calls", () => {
  it("parses USDC strictly", () => {
    expect(parseUsdcInput("12.5")).toBe(12_500_000n); expect(parseUsdcInput("0.000001")).toBe(1n);
    for (const bad of ["", "-1", "1e3", "0.0000001", "1,5", "abc"]) expect(parseUsdcInput(bad)).toBeNull();
    expect(decimalToMinor("0.056379")).toBe(56_379n); expect(decimalToMinor("45")).toBe(45_000_000n);
  });
  it("approves the exact amount to GatewayWallet, then calls deposit — never a raw transfer", () => {
    const [approve, deposit] = gatewayDepositCalls(base, 2_000_000n);
    expect(approve.to).toBe(base.usdc);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data })).toMatchObject({ functionName: "approve", args: [GATEWAY_WALLET, 2_000_000n] });
    expect(deposit.to).toBe(GATEWAY_WALLET);
    expect(deposit.data.slice(0, 10)).toBe(keccak256(toHex("deposit(address,uint256)")).slice(0, 10));
    expect(() => gatewayDepositCalls(base, 0n)).toThrow();
  });
});

describe("Arc mint evidence", () => {
  const usdc = "0x3600000000000000000000000000000000000000";
  const transferTopic = keccak256(toHex("Transfer(address,address,uint256)"));
  const receipt = (to: string, value: bigint, status: "success" | "reverted" = "success", block = 200n) => ({
    status, blockNumber: block, logs: [{ address: usdc, topics: [transferTopic, pad(zeroAddress, { size: 32 }), toBytes32(to)], data: encodeAbiParameters([{ type: "uint256" }], [value]), logIndex: 3 }],
  }) as unknown as TransactionReceipt;
  const expected = { recipient, valueMinor: 50_000n, afterBlock: 100n };
  it("accepts only a GatewayMinter mint of the exact value to the recipient", () => {
    expect(verifyGatewayMintReceipt(receipt(recipient, 50_000n), GATEWAY_MINTER, expected)).toEqual({ blockNumber: "200", logIndex: 3, networkFee: { currency: "USDC", decimals: 6, minorUnits: "0" } });
    expect(() => verifyGatewayMintReceipt(receipt(recipient, 50_000n), GATEWAY_WALLET, expected)).toThrow("WRONG_CONTRACT");
    expect(() => verifyGatewayMintReceipt(receipt(account.address, 50_000n), GATEWAY_MINTER, expected)).toThrow();
    expect(() => verifyGatewayMintReceipt(receipt(recipient, 49_999n), GATEWAY_MINTER, expected)).toThrow();
    expect(() => verifyGatewayMintReceipt(receipt(recipient, 50_000n, "reverted"), GATEWAY_MINTER, expected)).toThrow();
    expect(() => verifyGatewayMintReceipt(receipt(recipient, 50_000n, "success", 100n), GATEWAY_MINTER, expected)).toThrow();
  });
});
