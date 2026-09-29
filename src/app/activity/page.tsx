"use client";

import { DemoNotice, PageHeader } from "@/components/primitives";
import { ActivityLedger } from "@/components/activity-ledger";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";

export default function ActivityPage() {
  const { workspace } = useTreasuryWorkspace();
  return (
    <>
      <PageHeader eyebrow="04 · Activity" title="Every decision leaves a trace." description="A local audit view showing workspace changes, rationale, policy state and execution boundaries." />
      <DemoNotice>Quotes and approvals are local audit records. A transaction hash appears only when Circle App Kit returns a confirmed Arc Testnet receipt.</DemoNotice>
      <ActivityLedger activities={workspace.activities} />
    </>
  );
}
