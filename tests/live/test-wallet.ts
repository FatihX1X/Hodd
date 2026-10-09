import type { Page } from "@playwright/test";
import { createPublicClient, createWalletClient, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

// Only the contracts Hodd's live flows may call on Arc Testnet.
const ALLOWED_TARGETS = new Set([
  "0x3600000000000000000000000000000000000000", // USDC
  "0xbbd70b01a1cabc96d5b7b129ae1aaabdf50dd40b", // Earn Kit router
  "0xaabbef1d3971c710276ed41ec791bbe14cdb8e88", // allowlisted Morpho vault
]);

/**
 * Installs a MetaMask-like `window.ethereum` whose signing happens in the Node
 * test process. The private key never reaches the page; only chain 5042002,
 * zero-value calls to the allowlisted contracts and plain messages are signed.
 */
export async function installTestWallet(page: Page, privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const transport = http("https://rpc.testnet.arc.io", { timeout: 20_000 });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport });
  const reader = createPublicClient({ chain: arcTestnet, transport });
  await page.exposeFunction("__hoddTestWallet", async (method: string, params: unknown[] = []) => {
    switch (method) {
      case "eth_chainId": return "0x4cef52";
      case "eth_accounts":
      case "eth_requestAccounts": return [account.address];
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": return null;
      case "personal_sign": {
        const [message, address] = params as [Hex, string];
        if (getAddress(address) !== account.address) throw new Error("wrong signer");
        return account.signMessage({ message: { raw: message } });
      }
      case "eth_sendTransaction": {
        const [tx] = params as [{ from: string; to: string; data?: Hex; value?: Hex; gas?: Hex; gasPrice?: Hex }];
        if (getAddress(tx.from) !== account.address || !ALLOWED_TARGETS.has(tx.to.toLowerCase()) || (tx.value && BigInt(tx.value) !== 0n)) throw new Error("test wallet refused this transaction");
        if (await reader.getChainId() !== 5_042_002) throw new Error("wrong chain");
        return wallet.sendTransaction({ to: getAddress(tx.to), data: tx.data, value: 0n, ...(tx.gas ? { gas: BigInt(tx.gas) } : {}), ...(tx.gasPrice ? { gasPrice: BigInt(tx.gasPrice) } : {}) });
      }
      default: return reader.request({ method, params } as never);
    }
  });
  await page.addInitScript(() => {
    const bridge = (window as unknown as { __hoddTestWallet: (method: string, params?: unknown) => Promise<unknown> }).__hoddTestWallet;
    (window as unknown as { ethereum: object }).ethereum = {
      isMetaMask: true,
      request: ({ method, params }: { method: string; params?: unknown }) => bridge(method, params ?? []),
      on: () => undefined,
      removeListener: () => undefined,
    };
  });
  return account.address;
}
