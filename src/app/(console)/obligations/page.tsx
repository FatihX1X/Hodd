import { TreasuryNotice, PageHeader } from "@/components/primitives";
import { ObligationExplorer } from "@/components/obligation-explorer";

export const metadata = { title: "Obligations" };

export default function ObligationsPage() {
  return (
    <>
      <PageHeader eyebrow="03 · Obligations" title="Know what is due." description="Your bills set aside protected capital and free up the rest." />
      <TreasuryNotice>Bills are saved to your signed-in workspace. Live balances drive planning; your wallet approves every payment.</TreasuryNotice>
      <ObligationExplorer />
    </>
  );
}
