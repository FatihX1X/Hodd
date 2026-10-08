import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { TreasuryWorkspaceProvider, WorkspaceRecoveryBanner } from "@/components/treasury-workspace-provider";

// The console is a tool, not a page for search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <TreasuryWorkspaceProvider>
      <AppShell><WorkspaceRecoveryBanner />{children}</AppShell>
    </TreasuryWorkspaceProvider>
  );
}
