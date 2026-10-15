import { headers } from "next/headers";
import Image from "next/image";
import clsx from "clsx";
import { APP_ORIGIN, landingPathForHost, siteForHost } from "@/lib/site/hosts";

const wrap = "mx-auto max-w-[1360px] px-[clamp(16px,4vw,56px)]";
const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";
const navLink = clsx(label, "inline-flex min-h-11 items-center hover:underline hover:underline-offset-[6px]");
const docButton = "mono inline-flex min-h-12 whitespace-nowrap items-center gap-3 rounded-[2px] border px-5 text-xs font-medium uppercase tracking-[0.09em] transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0 active:translate-y-0 active:shadow-none";

export type DocSection = Readonly<{ heading: string; body: string }>;

/** Links between the landing page and the console, which differ on the marketing host. */
async function siteLinks() {
  const host = (await headers()).get("host");
  const appBase = siteForHost(host) === "marketing" ? APP_ORIGIN : "";
  return { home: landingPathForHost(host), launch: `${appBase}/` };
}

/** A plain reading page in the landing's paper and ink, for the terms, risk and privacy pages. */
export async function DocPage({ eyebrow, title, updated, intro, sections }: { eyebrow: string; title: string; updated: string; intro: string; sections: readonly DocSection[] }) {
  const { home, launch } = await siteLinks();
  return (
    <div className="min-h-screen bg-[#ece8dd] text-[#0b0b0d]">
      <header className="border-b border-[#0b0b0d]">
        <div className={clsx(wrap, "flex h-[68px] items-center justify-between gap-6")}>
          <a href={home} aria-label="Hodd Finance, home" className="flex min-h-11 items-center">
            <Image src="/brand/hodd-lockup-light.png" alt="" width={1912} height={608} sizes="140px" loading="eager" className="block h-auto w-[140px]" />
          </a>
          <a className={clsx(docButton, "min-h-11 border-[#0b0b0d] bg-[#0b0b0d] text-[#f4f1e8] hover:shadow-[4px_4px_0_#0a52e8]")} href={launch}>Launch app</a>
        </div>
      </header>

      <main className={clsx(wrap, "py-[clamp(48px,7vw,96px)]")}>
        <div className="max-w-[760px]">
          <div className={clsx(label, "text-[#0a52e8]")}>{eyebrow}</div>
          <h1 className="disp m-0 mt-5 text-[clamp(2.1rem,5vw,4rem)]">{title}</h1>
          <p className={clsx(label, "mb-0 mt-5 text-[#5a5953]")}>Last updated {updated}</p>
          <p className="mb-0 mt-8 text-lg leading-[1.6] text-[#3b3a36]">{intro}</p>
          <div className="mt-12 border-t border-[#0b0b0d]">
            {sections.map((section) => (
              <section key={section.heading} className="border-b border-[#0b0b0d]/20 py-7">
                <h2 className="m-0 text-xl font-semibold leading-tight">{section.heading}</h2>
                <p className="mb-0 mt-3 max-w-[66ch] text-[17px] leading-[1.65] text-[#3b3a36]">{section.body}</p>
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className="bg-[#0b0b0d] text-[#f4f1e8]">
        <nav aria-label="Footer" className={clsx(wrap, "flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-8")}>
          <div className="flex flex-wrap gap-x-7">
            <a className={navLink} href={home}>Home</a>
            <a className={navLink} href="/terms">Terms</a>
            <a className={navLink} href="/risk">Risk</a>
            <a className={navLink} href="/privacy">Privacy</a>
          </div>
          <a className="mono inline-flex min-h-11 items-center text-xs tracking-[0.02em] text-[#a5a8b3] hover:underline hover:underline-offset-[6px]" href="mailto:info@hoddfinance.xyz">info@hoddfinance.xyz</a>
        </nav>
      </footer>
    </div>
  );
}
