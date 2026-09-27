import { DemoNotice, PageHeader } from "@/components/primitives";
import { ActivityLedger } from "@/components/activity-ledger";
import { getTreasuryRepository } from "@/lib/treasury/repository";

export const metadata = { title: "Activity" };

export default async function ActivityPage() {
  const activities = await getTreasuryRepository().listActivities();
  return (
    <>
      <PageHeader eyebrow="04 · Activity" title="Every decision leaves a trace." description="A human-readable sample audit view showing who acted, why the record exists, which policy state was present and whether anything executed." />
      <DemoNotice>All entries are demo records. There are no transaction hashes because no onchain transaction has been submitted.</DemoNotice>
      <ActivityLedger activities={activities} />
    </>
  );
}
