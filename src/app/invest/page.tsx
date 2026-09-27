import { DemoNotice, PageHeader } from "@/components/primitives";
import { InvestmentWorkspace } from "@/components/investment-workspace";

export const metadata = { title: "Invest" };

export default function InvestPage() {
  return (
    <>
      <PageHeader eyebrow="02 · Invest" title="Review idle capital." description="Build a deterministic allocation preview without crossing the protected-liquidity boundary." />
      <DemoNotice>APYs remain illustrative. The Treasury Engine calculates amounts locally; previewing never approves, signs or moves funds.</DemoNotice>
      <InvestmentWorkspace />
    </>
  );
}
