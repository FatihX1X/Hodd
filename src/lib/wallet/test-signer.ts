import "server-only";
import { createPublicClient, createWalletClient, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];
const RPC = "https://rpc.testnet.arc.io";

/**
 * Local-development test signer. The key lives only in the git-ignored
 * .env.development.local (loaded by `next dev`, never by production builds) and
 * never leaves the server. Every gate must pass or the signer does not exist.
 */
export function testSignerAccount(hostname: string) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) return null;
  if (process.env.HODD_TEST_SIGNER_ENABLED !== "true" || !LOOPBACK.includes(hostname)) return null;
  const key = process.env.HODD_TEST_SIGNER_PRIVATE_KEY?.trim();
  if (!key || !/^0x[\da-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as Hex);
}

/** Signs locally, then broadcasts. The hash is known before broadcast so an ambiguous send stays reviewable. */
export async function sendTestSignerTransaction(account: NonNullable<ReturnType<typeof testSignerAccount>>, call: { to: Hex; data?: Hex; value?: string }, ceiling: { gasLimit: string; gasPriceWei: string }) {
  const transport = http(RPC, { timeout: 15_000, retryCount: 0 });
  const publicClient = createPublicClient({ chain: arcTestnet, transport });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport });
  if (await publicClient.getChainId() !== arcTestnet.id) throw new Error("WRONG_CHAIN");
  const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const serialized = await wallet.signTransaction({ type: "legacy", to: call.to, data: call.data, value: BigInt(call.value ?? "0"), gas: BigInt(ceiling.gasLimit), gasPrice: BigInt(ceiling.gasPriceWei), nonce, chain: arcTestnet });
  const hash = keccak256(serialized);
  // After signing, any broadcast error is ambiguous: return the hash and let receipt verification decide.
  await publicClient.sendRawTransaction({ serializedTransaction: serialized }).catch(() => undefined);
  return hash;
}
