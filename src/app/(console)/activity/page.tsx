"use client";

import { TreasuryNotice, PageHeader } from "@/components/primitives";
import { ActivityLedger } from "@/components/activity-ledger";
import { useTreasuryWorkspace } from "@/components/treasury-workspace-provider";
import { PaymentHistory } from "@/components/payment-history";
import { InfoTip } from "@/components/visuals";

export default function ActivityPage() {
  const { workspace, mode } = useTreasuryWorkspace();
  return (
    <>
      <PageHeader eyebrow="05 · Activity" title="Every decision leaves a trace." description="Workspace changes, why they happened and what was approved." />
      <TreasuryNotice>Quotes and approvals are audit records, not proof of payment.<InfoTip label="About audit records" className="-my-1 ml-1">Submitted hashes remain unverified until the server checks the canonical USDC receipt.</InfoTip></TreasuryNotice>
      <ActivityLedger activities={workspace.activities} />
      {mode === "LIVE" && <div className="mx-auto max-w-[1440px] px-5 pb-8 md:px-8 lg:px-10"><PaymentHistory /></div>}
    </>
  );
}
