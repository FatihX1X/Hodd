import type { TreasuryWorkspace, WalletReadState } from "./models";
import type { EarnPortfolioResponse } from "@/lib/earn/models";

export function onboardingStates(signedIn: boolean, workspace: TreasuryWorkspace, walletState: WalletReadState, portfolio?: EarnPortfolioResponse) {
  const connected = signedIn && Boolean(workspace.walletConnection);
  const verified = connected && walletState.status === "READY" && walletState.snapshot.address.toLowerCase() === workspace.walletConnection?.address.toLowerCase();
  const deposited = connected && portfolio?.integration.positionAccess === "READY" && portfolio.integration.configuredWalletAddress?.toLowerCase() === workspace.walletConnection?.address.toLowerCase() && portfolio.positions.some((position) => position.walletAddress.toLowerCase() === workspace.walletConnection?.address.toLowerCase() && BigInt(position.currentBalance.minorUnits) > 0n);
  const funded = verified && (BigInt(walletState.snapshot.balance.minorUnits) > 0n || Boolean(deposited));
  return { signedIn, connected, funded: Boolean(funded), billAdded: signedIn && workspace.obligations.some((item) => !["obl-payroll-oct", "obl-aws-oct", "obl-invoice-104"].includes(item.id)), deposited: Boolean(deposited) };
}
