import { DemoNotice, PageHeader } from "@/components/primitives";
import { InvestmentWorkspace } from "@/components/investment-workspace";

export const metadata = { title: "Invest" };

export default function InvestPage() {
  return (
    <>
      <PageHeader eyebrow="02 · Invest" title="Deploy idle capital deliberately." description="Discover verified Morpho vaults, inspect positions and keep every Arc Testnet write behind a fresh quote and explicit confirmation." />
      <DemoNotice>Vault data is live. Real Earn writes are available only for the configured Developer-Controlled Wallet under local development; hosted builds remain read-only.</DemoNotice>
      <InvestmentWorkspace />
    </>
  );
}
