import { TreasuryNotice, PageHeader } from "@/components/primitives";
import { InvestmentWorkspace } from "@/components/investment-workspace";
import { EarnRecoveryPanel } from "@/components/earn-recovery-panel";

export const metadata = { title: "Invest" };

export default function InvestPage() {
  return (
    <>
      <PageHeader eyebrow="Strategies" title="Deploy idle capital deliberately." description="Put idle USDC to work. Every write needs a fresh quote and your confirmation." />
      <TreasuryNotice>Arc Testnet vault data and positions come from your selected wallet. Your wallet approves every deposit and withdrawal.</TreasuryNotice>
      <EarnRecoveryPanel />
      <InvestmentWorkspace />
    </>
  );
}
