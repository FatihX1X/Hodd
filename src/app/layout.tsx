import type { Metadata, Viewport } from "next";
import "./globals.css";
import { archivo, plexMono } from "./fonts";
import { MARKETING_ORIGIN } from "@/lib/site/hosts";

export const metadata: Metadata = {
  metadataBase: new URL(MARKETING_ORIGIN),
  title: { default: "Hodd — Treasury Operations", template: "%s · Hodd" },
  description: "A deterministic, liquidity-first treasury operations console for Arc.",
};

export const viewport: Viewport = { themeColor: "#0b0b0d" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
