import type { Metadata } from "next";
import { DocPage, type DocSection } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: { absolute: "Terms — Hodd Finance" },
  description: "The terms of use for Hodd Finance, a testnet-only treasury on Arc.",
  alternates: { canonical: "/terms" },
};

const sections: readonly DocSection[] = [
  { heading: "Acceptance", body: "These terms apply to hoddfinance.xyz, app.hoddfinance.xyz, the Hodd Finance smart contracts, the Claude connector, Hoddie, Autopilot and every related tool (together, the Service). By accessing or using the Service, you agree to these terms and to the Risk and Privacy pages. If you do not agree, do not use the Service." },
  { heading: "Testnet only", body: "The Service runs only on Arc Testnet. Testnet USDC, USYC and every other testnet token have no monetary value and cannot be exchanged for money. Never send real funds to any address shown in the Service. Testnet balances and records can disappear at any time." },
  { heading: "No financial services or advice", body: "Hodd Finance is not a bank, broker, dealer, exchange, custodian, trustee, investment adviser, fiduciary or money transmitter, and does not act for you in any of those roles. Nothing in the Service is financial, investment, tax, legal or accounting advice, a recommendation, an offer or a solicitation. Yields, forecasts, previews and AI outputs are estimates and may be wrong." },
  { heading: "Your wallet, your responsibility", body: "You alone control your wallet, keys, passkeys, PINs and devices. You are solely responsible for every transaction you sign or approve, including bills and recipients you approve for Autopilot, and for keeping enough funds for what you owe. Blockchain transactions are final: Hodd Finance cannot reverse, cancel, recover or refund any of them." },
  { heading: "Automation and AI", body: "Autopilot, its AI advisor, Hoddie and the Claude connector act on your settings and approvals and can make mistakes, act late, act at a bad time or not act at all. You use them at your own risk and must review every change before you approve it. Hodd Finance does not guarantee any outcome from them." },
  { heading: "Third-party services", body: "The Service depends on services Hodd Finance does not control, including Arc, Circle, Morpho, USYC, Supabase, Vercel, Groq, Google, OpenRouter, Anthropic and wallet providers. Their terms apply to your use of them. Hodd Finance is not responsible for their acts, failures, outages, fees, changes or decisions, including freezing, blocking or removing access to any asset." },
  { heading: "No warranty", body: "The Service is provided “as is” and “as available”, with all faults and without warranties of any kind, express, implied or statutory, including merchantability, fitness for a particular purpose, title, non-infringement, accuracy, reliability, availability and security. The smart contracts are not audited. Hodd Finance does not warrant that the Service will work, be secure, be free of errors or keep your assets safe." },
  { heading: "Limitation of liability", body: "To the fullest extent permitted by law, Hodd Finance and its owners, contributors, affiliates and licensors are not liable for any loss or damage of any kind, whether direct, indirect, incidental, special, consequential, exemplary or punitive, including loss of funds, tokens, profits, revenue, data, goodwill or opportunity, arising from or related to the Service or these terms, under any theory of liability, even if told such loss was possible. Where the law does not allow liability to be excluded, it is limited to the smallest amount the law allows." },
  { heading: "Assumption of risk and indemnity", body: "You use the Service entirely at your own risk and accept every risk described on the Risk page and every risk not described there. You agree to indemnify, defend and hold harmless Hodd Finance and its owners, contributors and affiliates from any claim, loss, liability, cost or expense, including legal fees, arising from your use of the Service, your transactions or your breach of these terms or of any law." },
  { heading: "Acceptable use", body: "Do not use the Service to break any law or sanction, to harm others, to attack, overload or reverse engineer it beyond what its open-source licence allows, or to get around its limits. Hodd Finance may restrict, suspend or end anyone’s access at any time, for any reason, without notice." },
  { heading: "Changes", body: "Hodd Finance may change, pause or discontinue the Service, any feature or these terms at any time without notice. Continued use after a change means you accept it." },
  { heading: "Severability", body: "If any part of these terms is found unenforceable, it applies to the fullest extent allowed and the rest of the terms stay in force. No failure to enforce a term is a waiver of it." },
  { heading: "Contact", body: "Questions about these terms go to info@hoddfinance.xyz." },
];

export default function TermsPage() {
  return <DocPage eyebrow="Legal" title="Terms" updated="Oct 16, 2026" intro="Read these terms before using Hodd Finance. They limit what Hodd Finance is responsible for and place the risks of using the Service on you." sections={sections} />;
}
