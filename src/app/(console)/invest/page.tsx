import { TreasuryNotice, PageHeader } from "@/components/primitives";
import { InvestmentWorkspace } from "@/components/investment-workspace";
import { EarnRecoveryPanel } from "@/components/earn-recovery-panel";

export const metadata = { title: "Invest" };

export default function InvestPage() {
  return (
    <>
      <PageHeader eyebrow="02 · Strategies" title="Deploy idle capital deliberately." description="Discover verified Morpho vaults, inspect positions and keep every Arc Testnet write behind a fresh quote and explicit confirmation." />
      <TreasuryNotice>Arc Testnet vault data and positions come from your selected wallet. Your wallet approves every deposit and withdrawal.</TreasuryNotice>
      <EarnRecoveryPanel />
      <InvestmentWorkspace />
    </>
  );
}
