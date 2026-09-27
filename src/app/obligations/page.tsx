import { DemoNotice, PageHeader } from "@/components/primitives";
import { ObligationExplorer } from "@/components/obligation-explorer";

export const metadata = { title: "Obligations" };

export default function ObligationsPage() {
  return (
    <>
      <PageHeader eyebrow="03 · Obligations" title="Know what is due." description="Create and maintain the local obligation ledger that drives protected and deployable capital." />
      <DemoNotice>Changes persist in this browser and immediately recalculate Stage 2 policy. Payment creation and execution remain unavailable.</DemoNotice>
      <ObligationExplorer />
    </>
  );
}
