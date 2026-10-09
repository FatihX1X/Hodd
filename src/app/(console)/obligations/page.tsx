import { DemoNotice, PageHeader } from "@/components/primitives";
import { ObligationExplorer } from "@/components/obligation-explorer";

export const metadata = { title: "Obligations" };

export default function ObligationsPage() {
  return (
    <>
      <PageHeader eyebrow="03 · Obligations" title="Know what is due." description="Create and maintain your obligation ledger that drives protected and deployable capital." />
      <DemoNotice>Your bills are saved to your signed-in treasury workspace. Live wallet balances drive payment planning; your wallet approves every payment.</DemoNotice>
      <ObligationExplorer />
    </>
  );
}
