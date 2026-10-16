import { PageHeader } from "@/components/primitives";
import { ObligationExplorer } from "@/components/obligation-explorer";

export const metadata = { title: "Obligations" };

export default function ObligationsPage() {
  return (
    <>
      <PageHeader eyebrow="03 · Obligations" title="Know what is due." description="Your bills set aside protected capital and free up the rest." />
      <ObligationExplorer />
    </>
  );
}
