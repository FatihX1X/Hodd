import { HoddieChat } from "@/components/hoddie-chat";
import { DemoNotice, PageBody, PageHeader } from "@/components/primitives";

export const metadata = { title: "Hoddie" };

export default function HoddiePage() {
  return (
    <>
      <PageHeader compact eyebrow="Hoddie · Treasury assistant" title="Ask Hoddie." description="Ask in any language. Hoddie answers from your own workspace and can prepare changes that apply only after you approve." />
      <DemoNotice>Hoddie reads your local treasury workspace. Changes it prepares apply only after you approve them, and it can never move funds; payments always need your wallet signature.</DemoNotice>
      <PageBody className="lg:py-8"><HoddieChat /></PageBody>
    </>
  );
}
