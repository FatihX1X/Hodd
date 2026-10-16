// Read-only: the production owner's wallet, agent wallet and HoddieVault balances on Arc Testnet.
// Writes demo/evidence/balances.json. Sends no transaction. Usage: node video/scripts/read-balances.mjs
import { createPublicClient, erc20Abi, getAddress, http, parseAbi } from "viem";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "evidence");
const client = createPublicClient({ transport: http(process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network") });
const USDC = "0x3600000000000000000000000000000000000000";
const MORPHO = getAddress("0xaabbef1d3971c710276ed41ec791bbe14cdb8e88");
const USYC_POOL = "0x97A7BAaA5416e0aC0674C395cec22FF606120b76";
export const ACCOUNTS = { owner: getAddress("0xdef09d06764ee3ca611ce186f47dbd3f546d2e7c"), agent: getAddress("0xae407aa884d859e10475e609ad03a7cb6c11750b"), vault: getAddress("0xa425dd0acc673405e648ebe64eed2fc4da0ad02d") };
const erc4626 = parseAbi(["function balanceOf(address) view returns (uint256)", "function convertToAssets(uint256) view returns (uint256)"]);

const usdc = (address) => client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] });
async function position(pool, holder) {
  const shares = await client.readContract({ address: pool, abi: erc4626, functionName: "balanceOf", args: [holder] });
  const assets = shares === 0n ? 0n : await client.readContract({ address: pool, abi: erc4626, functionName: "convertToAssets", args: [shares] }).catch(() => null);
  return { shares: shares.toString(), assetsMinor: assets === null ? null : assets.toString() };
}

const block = await client.getBlockNumber();
const result = {
  chainId: await client.getChainId(), block: block.toString(), observedAt: new Date().toISOString(),
  ownerWalletMinor: (await usdc(ACCOUNTS.owner)).toString(),
  agentWalletMinor: (await usdc(ACCOUNTS.agent)).toString(),
  vaultCashMinor: (await usdc(ACCOUNTS.vault)).toString(),
  vaultMorpho: await position(MORPHO, ACCOUNTS.vault),
  vaultUsyc: await position(USYC_POOL, ACCOUNTS.vault),
  accounts: ACCOUNTS,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "balances.json"), JSON.stringify(result, null, 2) + "\n");
console.log(result);
