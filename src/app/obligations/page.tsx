import { DemoNotice, PageHeader } from "@/components/primitives";
import { ObligationExplorer } from "@/components/obligation-explorer";
import { getTreasuryRepository } from "@/lib/treasury/repository";

export const metadata = { title: "Obligations" };

export default async function ObligationsPage() {
  const obligations = await getTreasuryRepository().listObligations();
  return (
    <>
      <PageHeader eyebrow="03 · Obligations" title="Know what is due." description="A sample obligation ledger that keeps payment priority, recipient readiness and due dates visible before capital is allocated." />
      <DemoNotice>Read-only in Stage 1. Creating, editing and validating obligations begins in Stage 2.</DemoNotice>
      <ObligationExplorer obligations={obligations} />
    </>
  );
}
