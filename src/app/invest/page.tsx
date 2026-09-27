import { DemoNotice, PageHeader } from "@/components/primitives";
import { InvestmentWorkspace } from "@/components/investment-workspace";
import { getTreasuryRepository } from "@/lib/treasury/repository";

export const metadata = { title: "Invest" };

export default async function InvestPage() {
  const repository = getTreasuryRepository();
  const [portfolio, strategies] = await Promise.all([repository.getPortfolio(), repository.listStrategies()]);

  return (
    <>
      <PageHeader eyebrow="02 · Invest" title="Review idle capital." description="Explore a sample allocation without crossing the protected-liquidity boundary. This workspace cannot create or execute a transaction." />
      <DemoNotice>APYs and availability below are illustrative fixture values, not live market data. Previewing does not approve, sign or move funds.</DemoNotice>
      <InvestmentWorkspace portfolio={portfolio} strategies={strategies} />
    </>
  );
}
