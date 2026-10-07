import "server-only";
import { createPublicClient, type Transport } from "viem";
import { arcTestnet } from "viem/chains";
import { createBundlerClient, toWebAuthnAccount, type UserOperation } from "viem/account-abstraction";
import { toCircleSmartAccount } from "@circle-fin/modular-wallets-core";
import { modularReadTransport } from "./modular-read-transport";
import type { WalletConnection } from "@/lib/treasury/models";
import type { WalletCall } from "./runtime";
import { sponsoredUserOperationSchema, walletFeeQuoteSchema } from "./fee-quote";
import { digest } from "@/lib/earn/durable-quotes";

export async function modularReadClient(wallet: WalletConnection) {
  const clientKey = process.env.NEXT_PUBLIC_CLIENT_KEY?.trim();
  const baseUrl = process.env.NEXT_PUBLIC_CLIENT_URL?.trim() || "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";
  if (!clientKey || !wallet.passkey || wallet.provider !== "CIRCLE_MODULAR" || wallet.accountType !== "MSCA") throw new Error("MODULAR_PUBLIC_METADATA_REQUIRED");
  // Restrict server transports to Circle. Public client configuration is not an
  // SSRF mechanism or permission to send the client key to arbitrary endpoints.
  if (baseUrl !== "https://modular-sdk.circle.com/v1/rpc/w3s/buidl") throw new Error("MODULAR_ENDPOINT_NOT_ALLOWED");
  const transport = modularReadTransport(clientKey) as Transport;
  const client = createPublicClient({ chain: arcTestnet, transport });
  if (await client.getChainId() !== 5042002) throw new Error("WRONG_MODULAR_CHAIN");
  const owner = toWebAuthnAccount({ credential: { id: wallet.passkey.id, publicKey: wallet.passkey.publicKey as `0x${string}` }, getFn: async () => { throw new Error("SERVER_SIGNING_FORBIDDEN"); } });
  const account = await toCircleSmartAccount({ client: client as unknown as Parameters<typeof toCircleSmartAccount>[0]["client"], owner, name: "Hodd Treasury" });
  if (account.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("MODULAR_WALLET_MISMATCH");
  return { account, bundler: createBundlerClient({ account: account as unknown as NonNullable<Parameters<typeof createBundlerClient>[0]["account"]>, chain: arcTestnet, transport }) };
}

export async function quoteModularPayment(wallet: WalletConnection, call: WalletCall) {
  if (!wallet.passkey || !process.env.NEXT_PUBLIC_CLIENT_KEY?.trim()) return null;
  const { account, bundler } = await modularReadClient(wallet);
  // Read-only estimation with SDK stub signature, including account deployment,
  // validation and paymaster overhead. No signing or sendUserOperation here.
  if (account.entryPoint.version !== "0.7") throw new Error("UNSUPPORTED_ENTRY_POINT");
  const prepared = await bundler.prepareUserOperation({ calls: [{ ...call, value: BigInt(call.value ?? "0") }], paymaster: true }) as unknown as UserOperation<"0.7">;
  const op = sponsoredUserOperationSchema.parse({ sender: prepared.sender, nonce: prepared.nonce.toString(), callData: prepared.callData,
    ...(prepared.factory ? { factory: prepared.factory, factoryData: prepared.factoryData } : {}),
    callGasLimit: prepared.callGasLimit?.toString(), verificationGasLimit: prepared.verificationGasLimit?.toString(), preVerificationGas: prepared.preVerificationGas?.toString(), maxFeePerGas: prepared.maxFeePerGas?.toString(), maxPriorityFeePerGas: prepared.maxPriorityFeePerGas?.toString(), paymaster: prepared.paymaster, paymasterData: prepared.paymasterData, paymasterVerificationGasLimit: prepared.paymasterVerificationGasLimit?.toString(), paymasterPostOpGasLimit: prepared.paymasterPostOpGasLimit?.toString() });
  if (op.callData.toLowerCase() !== (await account.encodeCalls([{ ...call, value: BigInt(call.value ?? "0") }])).toLowerCase()) throw new Error("MODULAR_CALL_MISMATCH");
  const gas = [op.callGasLimit, op.verificationGasLimit, op.preVerificationGas, op.paymasterVerificationGasLimit, op.paymasterPostOpGasLimit].reduce((sum, value) => sum + BigInt(value), 0n);
  const now = Date.now();
  return walletFeeQuoteSchema.parse({ provider: wallet.provider, walletAddress: wallet.address, chainId: 5042002, operationDigest: digest(call), observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString(), sponsorship: "VERIFIED", source: "CIRCLE_MSCA", userOperation: op, gasLimit: gas.toString(), maxFeePerGasWei: op.maxFeePerGas, priorityFeePerGasWei: op.maxPriorityFeePerGas, maxNativeFeeWei: (gas * BigInt(op.maxFeePerGas)).toString(), maxWalletDebit: { currency: "USDC", decimals: 6, minorUnits: "0" } });
}
