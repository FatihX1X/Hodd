import { DemoNotice, PageHeader } from "@/components/primitives";
import { ObligationExplorer } from "@/components/obligation-explorer";

export const metadata = { title: "Obligations" };

export default function ObligationsPage() {
  return (
    <>
      <PageHeader eyebrow="03 · Obligations" title="Know what is due." description="Create and maintain the local obligation ledger that drives protected and deployable capital." />
      <DemoNotice>Changes persist in this browser and recalculate policy only when the authoritative treasury balance is available. Payment execution remains unavailable.</DemoNotice>
      <ObligationExplorer />
    </>
  );
}
