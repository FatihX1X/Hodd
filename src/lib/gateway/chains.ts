import { getAddress } from "viem";

// Circle Gateway testnet: one GatewayWallet/GatewayMinter pair on every EVM chain.
// Values cross-checked on 2026-10-10 against GET https://gateway-api-testnet.circle.com/v1/info
// and the chain definitions bundled with @circle-fin/app-kit 1.15.3.
export const GATEWAY_API_TESTNET = "https://gateway-api-testnet.circle.com";
export const GATEWAY_WALLET = getAddress("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
export const GATEWAY_MINTER = getAddress("0x0022222ABE238Cc2C7Bb1f21003F0a260052475B");
export const ARC_GATEWAY_DOMAIN = 26;

export type GatewayChain = Readonly<{
  /** Circle kit identifier. */
  key: string; label: string; domain: number; chainId: number;
  usdc: `0x${string}`; rpc: string; explorerTx: string; nativeSymbol: string;
  /** Rough time before Gateway credits a deposit on this chain. */
  depositWait: string;
}>;

const chain = (key: string, label: string, domain: number, chainId: number, usdc: string, rpc: string, explorerTx: string, nativeSymbol: string, depositWait: string): GatewayChain =>
  ({ key, label, domain, chainId, usdc: getAddress(usdc), rpc, explorerTx, nativeSymbol, depositWait });

export const GATEWAY_CHAINS: readonly GatewayChain[] = [
  chain("Arc_Testnet", "Arc Testnet", 26, 5_042_002, "0x3600000000000000000000000000000000000000", "https://rpc.testnet.arc.network", "https://testnet.arcscan.app/tx/", "USDC", "under a minute"),
  chain("Ethereum_Sepolia", "Ethereum Sepolia", 0, 11_155_111, "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.etherscan.io/tx/", "ETH", "about 20 minutes"),
  chain("Base_Sepolia", "Base Sepolia", 6, 84_532, "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "https://sepolia.base.org", "https://sepolia.basescan.org/tx/", "ETH", "about 20 minutes"),
  chain("Arbitrum_Sepolia", "Arbitrum Sepolia", 3, 421_614, "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", "https://sepolia-rollup.arbitrum.io/rpc", "https://sepolia.arbiscan.io/tx/", "ETH", "about 20 minutes"),
  chain("Optimism_Sepolia", "OP Sepolia", 2, 11_155_420, "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", "https://sepolia.optimism.io", "https://sepolia-optimistic.etherscan.io/tx/", "ETH", "about 20 minutes"),
  chain("Avalanche_Fuji", "Avalanche Fuji", 1, 43_113, "0x5425890298aed601595a70ab815c96711a31bc65", "https://api.avax-test.network/ext/bc/C/rpc", "https://subnets-test.avax.network/c-chain/tx/", "AVAX", "a few seconds"),
  chain("Polygon_Amoy_Testnet", "Polygon Amoy", 7, 80_002, "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582", "https://polygon-amoy-bor-rpc.publicnode.com", "https://amoy.polygonscan.com/tx/", "POL", "a few minutes"),
  chain("Unichain_Sepolia", "Unichain Sepolia", 10, 1_301, "0x31d0220469e10c4E71834a79b1f276d740d3768F", "https://sepolia.unichain.org", "https://unichain-sepolia.blockscout.com/tx/", "ETH", "about 20 minutes"),
  chain("World_Chain_Sepolia", "World Chain Sepolia", 14, 4_801, "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88", "https://worldchain-sepolia.drpc.org", "https://sepolia.worldscan.org/tx/", "ETH", "about 20 minutes"),
  chain("Sonic_Testnet", "Sonic Testnet", 13, 14_601, "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51", "https://rpc.testnet.soniclabs.com", "https://testnet.sonicscan.org/tx/", "S", "a few seconds"),
  chain("Sei_Testnet", "Sei Testnet", 16, 1_328, "0x4fCF1784B31630811181f670Aea7A7bEF803eaED", "https://evm-rpc-testnet.sei-apis.com", "https://testnet.seiscan.io/tx/", "SEI", "a few seconds"),
  chain("HyperEVM_Testnet", "HyperEVM Testnet", 19, 998, "0x2B3370eE501B4a559b57D449569354196457D8Ab", "https://rpc.hyperliquid-testnet.xyz/evm", "https://app.hyperliquid-testnet.xyz/explorer/tx/", "HYPE", "a few seconds"),
];

export const ARC_GATEWAY_CHAIN = GATEWAY_CHAINS[0];
export const gatewayChainByKey = (key: string) => GATEWAY_CHAINS.find((item) => item.key === key) ?? null;
export const gatewayChainByDomain = (domain: number) => GATEWAY_CHAINS.find((item) => item.domain === domain) ?? null;
