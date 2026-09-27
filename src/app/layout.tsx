import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { TreasuryWorkspaceProvider, WorkspaceRecoveryBanner } from "@/components/treasury-workspace-provider";

export const metadata: Metadata = {
  title: { default: "Hodd — Treasury Operations", template: "%s · Hodd" },
  description: "A deterministic, liquidity-first treasury operations console for Arc.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <TreasuryWorkspaceProvider>
          <AppShell><WorkspaceRecoveryBanner />{children}</AppShell>
        </TreasuryWorkspaceProvider>
      </body>
    </html>
  );
}
