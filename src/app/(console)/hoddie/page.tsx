import { HoddieWorkspace } from "@/components/hoddie-workspace";
import { TreasuryNotice, PageBody, PageHeader } from "@/components/primitives";
export const metadata = { title: "Hoddie" };
export default function HoddiePage() {
  return <><PageHeader compact eyebrow="Hoddie · Treasury assistant" title="Hoddie" description="Ask about balances, obligations and runway in plain language. Hoddie explains your treasury and drafts changes for you to review; your own wallet signs every transaction." /><TreasuryNotice>Read answers come from the Treasury Engine. Changes need a separate review; money requests need a fresh quote and wallet signature.</TreasuryNotice><PageBody className="lg:py-8"><HoddieWorkspace /></PageBody></>;
}
