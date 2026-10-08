import { DemoNotice, PageHeader } from "@/components/primitives";
import { InvestmentWorkspace } from "@/components/investment-workspace";

export const metadata = { title: "Invest" };

export default function InvestPage() {
  return (
    <>
      <PageHeader eyebrow="02 · Invest" title="Deploy idle capital deliberately." description="Discover verified Morpho vaults, inspect positions and keep every Arc Testnet write behind a fresh quote and explicit confirmation." />
      <DemoNotice>Vault data is live. Positions belong to your selected wallet. Earn writes are paused while user-owned signer flows are being verified.</DemoNotice>
      <InvestmentWorkspace />
    </>
  );
}
