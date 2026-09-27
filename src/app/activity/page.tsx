"use client";

import { DemoNotice, PageHeader } from "@/components/primitives";
import { ActivityLedger } from "@/components/activity-ledger";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";

export default function ActivityPage() {
  const { workspace } = useTreasuryWorkspace();
  return (
    <>
      <PageHeader eyebrow="04 · Activity" title="Every decision leaves a trace." description="A local audit view showing workspace changes, rationale, policy state and execution boundaries." />
      <DemoNotice>Entries are stored in this browser. Wallet events are local audit records; no onchain transaction has been submitted.</DemoNotice>
      <ActivityLedger activities={workspace.activities} />
    </>
  );
}
