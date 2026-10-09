import { HoddieChat } from "@/components/hoddie-chat";
import { DemoNotice, PageBody, PageHeader } from "@/components/primitives";

export const metadata = { title: "Hoddie" };

export default function HoddiePage() {
  return (
    <>
      <PageHeader compact eyebrow="Hoddie · Treasury assistant" title="Ask Hoddie." description="Plain questions about your bills, runway and policy, answered from your own workspace." />
      <DemoNotice>Hoddie reads your local treasury workspace. It cannot change data or move funds; payments always need your wallet signature.</DemoNotice>
      <PageBody className="lg:py-8"><HoddieChat /></PageBody>
    </>
  );
}
