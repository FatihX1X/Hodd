import type { Metadata } from "next";
import { DocPage, type DocSection } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: { absolute: "Privacy — Hodd Finance" },
  description: "What Hodd Finance stores, who processes it and the limits of Hodd Finance’s responsibility.",
  alternates: { canonical: "/privacy" },
};

const sections: readonly DocSection[] = [
  { heading: "What Hodd Finance collects", body: "Your sign-in email, the wallet addresses you connect, your treasury workspace (bills, policy and activity), records of payments, Autopilot runs and changes made from Hoddie or Claude, and the technical data needed to run the Service, such as request logs." },
  { heading: "What Hodd Finance never collects", body: "Seed phrases, private keys and PINs. Your wallet signs on your own device. Never share them with anyone, including anyone claiming to be Hodd Finance." },
  { heading: "How it is used", body: "To run, secure and improve the Service, to answer your requests and to meet legal obligations. Hodd Finance does not sell your personal data." },
  { heading: "Who else processes it", body: "Supabase (sign-in and database), Vercel (hosting), Circle (wallets, Gateway and the Autopilot agent wallet), Groq (Autopilot’s advisor receives the treasury figures it needs, not your email), Google Gemini or OpenRouter (the messages you send Hoddie) and, if you connect it, Anthropic’s Claude (the results of the Hodd Finance tools it calls). Each handles data under its own terms and policies, and Hodd Finance is not responsible for how they do so." },
  { heading: "Public by design", body: "Transactions on Arc are public and permanent. Anyone can link a wallet address to its transfers on ArcScan, and Hodd Finance cannot hide or delete onchain data." },
  { heading: "Security", body: "No method of storing or sending data is completely secure. Hodd Finance cannot guarantee the security of your data and, to the fullest extent permitted by law, is not liable for any unauthorised access, loss, disclosure or alteration of it." },
  { heading: "Retention", body: "Data is kept for as long as the Service needs it or the law requires. Testnet data can be deleted at any time without notice." },
  { heading: "Cookies", body: "The Service uses only the cookies it needs to keep you signed in and to remember your consent. There are no advertising trackers." },
  { heading: "Your choices", body: "You can disconnect Claude on the Connections page at any time. To ask for a copy or the deletion of your data, email info@hoddfinance.xyz. Some records may be kept where the law requires it." },
  { heading: "Changes", body: "Hodd Finance may update this page at any time. Continued use of the Service after a change means you accept it." },
];

export default function PrivacyPage() {
  return <DocPage eyebrow="Legal" title="Privacy" updated="Oct 16, 2026" intro="What Hodd Finance stores, why it stores it, who else processes it, and the limits of Hodd Finance’s responsibility for it." sections={sections} />;
}
