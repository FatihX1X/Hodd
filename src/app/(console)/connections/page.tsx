"use client";

import { DemoNotice, PageHeader } from "@/components/primitives";
import { ConnectionsWorkspace } from "@/components/connections-workspace";

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader eyebrow="05 · Connections" title="Ask Hodd from Claude." description="Connect Claude to read your treasury and prepare changes. Every change needs your approval; money moves only with your wallet signature." />
      <DemoNotice>The connector uses your Hodd sign-in. Revoke it here anytime; Claude then loses access immediately.</DemoNotice>
      <ConnectionsWorkspace />
    </>
  );
}
