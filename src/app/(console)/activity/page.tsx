"use client";

import { DemoNotice, PageHeader } from "@/components/primitives";
import { ActivityLedger } from "@/components/activity-ledger";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";
import { PaymentHistory } from "@/components/payment-history";

export default function ActivityPage() {
  const { workspace } = useTreasuryWorkspace();
  return (
    <>
      <PageHeader eyebrow="05 · Activity" title="Every decision leaves a trace." description="A local audit view showing workspace changes, rationale, policy state and execution boundaries." />
      <DemoNotice>Quotes and approvals are audit records, not proof of payment. Submitted hashes remain unverified until the server checks the canonical USDC receipt.</DemoNotice>
      <ActivityLedger activities={workspace.activities} />
      <div className="mx-auto max-w-[1440px] px-5 pb-8 md:px-8 lg:px-10"><PaymentHistory index="05.2" /></div>
    </>
  );
}
