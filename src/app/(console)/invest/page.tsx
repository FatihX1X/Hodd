import { PageHeader } from "@/components/primitives";
import { InvestmentWorkspace } from "@/components/investment-workspace";
import { EarnRecoveryPanel } from "@/components/earn-recovery-panel";

export const metadata = { title: "Invest" };

export default function InvestPage() {
  return (
    <>
      <PageHeader eyebrow="Invest" title="Deploy idle capital deliberately." description="Put idle USDC to work. Every write needs a fresh quote and your confirmation." />
      <EarnRecoveryPanel />
      <InvestmentWorkspace />
    </>
  );
}
