import type { Metadata } from "next";
import { DocPage, type DocSection } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: { absolute: "Risk — Hodd Finance" },
  description: "The risks of using Hodd Finance, which you accept in full.",
  alternates: { canonical: "/risk" },
};

const sections: readonly DocSection[] = [
  { heading: "Total loss", body: "You can lose everything you use with the Service. Hodd Finance does not guarantee the value, safety, availability or return of any asset, and accepts no responsibility for any loss." },
  { heading: "Testnet", body: "Arc Testnet can reset, halt, fork, slow down or be shut down at any time. Testnet tokens have no value, and balances, positions and history can be lost without warning." },
  { heading: "Smart contracts", body: "Your vault, the HoddUSYCVault pool, the vault factory and the Morpho vaults are smart contracts. They are not audited and can contain bugs, be exploited, behave unexpectedly or become unusable. Funds held in or sent through them can be lost or locked permanently." },
  { heading: "Yield and liquidity", body: "Yields change, can fall to zero and are never guaranteed. USYC’s price can move. Withdrawals and redemptions depend on the liquidity of Morpho vaults, the USYC pool and Circle, and can be delayed, reduced or impossible." },
  { heading: "Stablecoins and issuers", body: "USDC and USYC depend on Circle and other issuers. They can lose their peg, be frozen, blocklisted or redeemed only on the issuer’s terms, and the allowlist that lets the USYC pool hold USYC can be revoked." },
  { heading: "Automation and AI", body: "Autopilot can act at the wrong time, move the wrong amount, fail to act or pay a bill you approved even when you no longer want it paid. Its AI advisor, Hoddie and the Claude connector can be wrong, misread your request or give inaccurate information. Contract limits restrict where money can go, not whether a decision is wise." },
  { heading: "Software and data", body: "Hodd Finance software, RPC endpoints and price or balance data can fail, be stale, be wrong or be attacked. Transactions can fail, get stuck, cost more fees than expected or be included in an unexpected order." },
  { heading: "Third parties", body: "Circle, Arc, Morpho, Supabase, Vercel, wallet providers and AI providers can fail, change, charge fees, restrict access or stop their services, and Hodd Finance cannot prevent or undo any of it." },
  { heading: "Security", body: "Lost keys, phishing, malware, compromised devices or accounts, and signing a malicious request can all lead to permanent loss. Blockchain transactions cannot be reversed." },
  { heading: "Legal, regulatory and tax", body: "Laws and regulations can change and can make the Service, or parts of it, unavailable to you. You are solely responsible for complying with the laws that apply to you and for any taxes." },
  { heading: "No guarantee", body: "Nothing on hoddfinance.xyz or in the Service is a promise of returns, protection, availability or any outcome. Examples, totals and amounts are illustrative or historical." },
];

export default function RiskPage() {
  return <DocPage eyebrow="Legal" title="Risk" updated="Oct 16, 2026" intro="Using Hodd Finance is entirely at your own risk. By using the Service you accept every risk below, and every risk not listed, and Hodd Finance accepts no responsibility for any of them." sections={sections} />;
}
