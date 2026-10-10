import "server-only";
import { ViemArcTreasuryReader } from "@/lib/arc/reader";
import { arcClient, discoverAllowedVaults, getEarnPosition } from "@/lib/earn/gateway";
import { treasuryWorkspaceSchema } from "@/lib/treasury/models";
import { boundedArcGasPrice } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { agentDb, loadMandate, loadWallet } from "./store";
import { assertAgentDestination } from "./destination";
export async function agentInputs(userId: string) {
  const [wallet, stored, result] = await Promise.all([loadWallet(userId), loadMandate(userId), agentDb().from("treasury_workspaces").select("workspace,revision").eq("user_id",userId).single()]);
  if (!wallet || !stored || result.error) throw new Error("AGENT_SETUP_REQUIRED");
  const workspace = treasuryWorkspaceSchema.parse(result.data.workspace);
  const owner = workspace.walletConnection;
  if (!owner || owner.address.toLowerCase() !== wallet.owner_address.toLowerCase()) throw new Error("AGENT_OWNER_WALLET_CHANGED");
  const proof = await agentDb().from("wallet_ownership_proofs").select("wallet_address,provider").eq("user_id",userId).eq("wallet_address",wallet.owner_address.toLowerCase()).maybeSingle();
  if (proof.error || !proof.data || (process.env.NODE_ENV !== "development" && proof.data.provider === "TEST_SIGNER")) throw new Error("AGENT_OWNER_PROOF_REQUIRED");
  assertAgentDestination({ token:"0x3600000000000000000000000000000000000000", destination:wallet.owner_address,verifiedOwner:proof.data.wallet_address,boundOwner:wallet.owner_address,chainId:5042002 });
  const vaults=await discoverAllowedVaults(); if(vaults.length!==1)throw new Error("AGENT_VAULT_CONFIGURATION_CHANGED");
  const vault=vaults[0];
  // Warning-bearing vaults need a new user review; autonomous execution fails closed.
  if(vault.warnings.length || vault.earnKitWarnings.length)throw new Error("AGENT_VAULT_WARNING");
  const [cash, ownerCash, agentPosition, ownerPositions, gasPrice]=await Promise.all([new ViemArcTreasuryReader().readSnapshot(wallet.address),new ViemArcTreasuryReader().readSnapshot(wallet.owner_address),getEarnPosition(wallet.address,vault),Promise.all(vaults.map(v=>getEarnPosition(wallet.owner_address,v))),arcClient.getGasPrice()]);
  const ownerValue=ownerPositions.reduce((s,p)=>s+BigInt(p.currentBalance.minorUnits),0n);
  const liveWorkspace={...workspace,liquidUsdc:ownerCash.balance,totalTreasury:{...ownerCash.balance,minorUnits:(BigInt(ownerCash.balance.minorUnits)+ownerValue).toString()},strategies:ownerPositions.map(p=>({id:p.vaultAddress,name:"Morpho",kind:"MORPHO" as const,balance:p.currentBalance,redeemable:p.redeemable,apyBps:null,risk:"MODERATE" as const,liquidity:"VARIABLE" as const,integration:"LIVE" as const}))};
  const feeReserveMinor=nativeWeiToUsdcCeil((1_500_000n * boundedArcGasPrice(gasPrice)).toString()).minorUnits;
  return { wallet, stored, workspace:liveWorkspace, workspaceRevision:result.data.revision, vault, ownerPositions, agentPosition, cash, ownerCash, feeReserveMinor, gasPriceWei:boundedArcGasPrice(gasPrice).toString() };
}
