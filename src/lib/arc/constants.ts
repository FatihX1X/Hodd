export const ARC_TESTNET_CHAIN_ID = 5_042_002 as const;
export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.io";
export const ARC_TESTNET_EXPLORER_URL = "https://explorer.testnet.arc.io";
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const ARC_USDC_DECIMALS = 6 as const;
export const WALLET_CAPABILITIES = {
  READ_BALANCE: true,
  SIGN: false,
  SUBMIT_TRANSACTION: false,
} as const;
