"use client";

import { PageHeader } from "@/components/primitives";
import { ActivityLedger } from "@/components/activity-ledger";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";
import { PaymentHistory } from "@/components/payment-history";

export default function ActivityPage() {
  const { workspace, mode } = useTreasuryWorkspace();
  return (
    <>
      <PageHeader eyebrow="05 · Activity" title="Every decision leaves a trace." description="Workspace changes, why they happened and what was approved." />
      <ActivityLedger activities={workspace.activities} />
      {mode === "LIVE" && <div className="mx-auto max-w-[1440px] px-5 pb-8 md:px-8 lg:px-10"><PaymentHistory /></div>}
    </>
  );
}
