import type { Metadata } from "next";
import { Fragment } from "react";
import { headers } from "next/headers";
import Image from "next/image";
import clsx from "clsx";
import { SystemTabs } from "@/components/landing/system-tabs";
import { CountUp } from "@/components/landing/motion/count-up";
import { CtaStar } from "@/components/landing/motion/cta-star";
import { HeroMark } from "@/components/landing/motion/hero-mark";
import { HoddiePreview } from "@/components/landing/motion/hoddie-preview";
import { HowTimeline } from "@/components/landing/motion/how-timeline";
import { LiveTreasury } from "@/components/landing/motion/live-treasury";
import { MagneticLink } from "@/components/landing/motion/magnetic-link";
import { RevealLines } from "@/components/landing/motion/reveal-lines";
import { SystemMotion, SystemStar } from "@/components/landing/motion/system-motion";
import styles from "@/components/landing/landing.module.css";
import { APP_ORIGIN, siteForHost } from "@/lib/site/hosts";

export const metadata: Metadata = {
  title: { absolute: "Hodd Finance — Treasury that plans ahead" },
  description: "Hodd keeps liquidity ready for what is due, protects your bills before yield, and keeps every move inside the limits you set. Built on Arc.",
  alternates: { canonical: "/" },
  // Page-level openGraph replaces the root one, so the share image is repeated here.
  openGraph: { title: "Hodd Finance — Your capital, ahead of time.", description: "Treasury that plans ahead, on Arc.", url: "/", siteName: "Hodd Finance", type: "website", images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "Hodd Finance" }] },
  twitter: { card: "summary_large_image", title: "Hodd Finance — Your capital, ahead of time.", description: "Treasury that plans ahead, on Arc.", images: ["/opengraph-image.png"] },
};

const wrap = "mx-auto max-w-[1360px] px-[clamp(16px,4vw,56px)]";
const label = "mono text-[11px] uppercase leading-[1.6] tracking-[0.09em]";
const button = "mono inline-flex min-h-12 whitespace-nowrap items-center gap-3 rounded-[2px] border px-5 text-xs font-medium uppercase tracking-[0.09em] transition duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0 active:translate-y-0 active:shadow-none";
const buttonInk = clsx(button, "border-[#0b0b0d] bg-[#0b0b0d] text-[#f4f1e8] hover:shadow-[4px_4px_0_#0a52e8]");
const buttonLine = clsx(button, "border-[#0b0b0d] text-[#0b0b0d] hover:shadow-[4px_4px_0_#0b0b0d]");
const buttonPaper = clsx(button, "border-[#f4f1e8] bg-[#f4f1e8] text-[#0b0b0d] hover:shadow-[4px_4px_0_#0b0b0d]");
const buttonLight = clsx(button, "border-[#f4f1e8]/65 text-[#f4f1e8] hover:shadow-[4px_4px_0_#f4f1e8]");
const navLink = clsx(label, "inline-flex min-h-11 items-center hover:underline hover:underline-offset-[6px]");

const tickerItems = ["Hodd Finance®", "Treasury that plans ahead", "Capital", "Liquidity", "Obligations", "Approved by you", "On Arc", "Money should know what’s next"];

const facts = [
  { label: "Network", value: "Arc", note: "Testnet today" },
  { label: "Custody", value: "Yours", note: "Circle, passkey, MetaMask or Rabby" },
  { label: "Writes", value: "Approved", note: "Every move needs your wallet" },
  { label: "Horizon", value: "30 days", note: "Obligations protected before yield" },
] as const;

const steps = [
  { no: "01", title: "Connect", body: "Connect your own Arc Testnet wallet. Hodd reads its public USDC balance and Morpho vault positions." },
  { no: "02", title: "Set policy", body: "Define the limits: where capital may go, how much stays liquid, who signs off on what." },
  { no: "03", title: "Hodd plans", body: "The Treasury Engine protects your bills and safety buffer before calculating available capital." },
  { no: "04", title: "Settle", body: "Review a fresh quote and sign each payment in your own wallet. Hodd verifies the receipt and records the outcome." },
] as const;

const principles = [
  { no: "01", title: "Policy-bound", body: "Hodd acts only inside the limits you define: where capital can go, how much stays liquid, who signs off." },
  { no: "02", title: "Legible", body: "Every action is logged with the reason it was taken — in plain language, not just a transaction hash." },
  { no: "03", title: "On-chain", body: "Settled on Arc. Anyone with the link can verify what moved, when, and why." },
] as const;

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12L12 2M5 2H12V9" /></svg>
  );
}

function Spark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" width="9" height="9" aria-hidden="true" className={className}><path d="M100 0Q110 90 200 100Q110 110 100 200Q90 110 0 100Q90 90 100 0Z" fill="currentColor" /></svg>
  );
}

/** The X (formerly Twitter) mark, drawn from its published glyph. */
function XLogo() {
  return <svg viewBox="0 0 24 24" width="16" height="16" role="img" aria-label="X" className="shrink-0" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
}

/** The hero headline, line by line and word by word (each word rises from its own mask on a first visit). */
const headline = [["Your", "capital,"], ["ahead", "of", "time."]];

/**
 * Marks the first visit in this tab before the hero paints, so the intro plays once and a returning reader (or one who
 * prefers reduced motion, or has no storage) sees the finished hero at once. Runs while the HTML is parsed.
 */
const introScript = `(function(){try{var h=document.getElementById("top");if(!h||matchMedia("(prefers-reduced-motion: reduce)").matches||sessionStorage.getItem("hodd:hero-intro"))return;sessionStorage.setItem("hodd:hero-intro","1");h.setAttribute("data-intro","play")}catch(e){}})()`;

/** A parse-time script; on the client React only sees an inert text/plain copy (Next.js "preventing flash" guide). */
function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The hero's 120px ruled grid, drawn once on load (CSS only, see landing.module.css). */
function GridLines() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 16 }, (_, index) => <span key={`v${index}`} className={clsx(styles.gridLine, styles.gridV)} style={{ left: index * 120, animationDelay: `${index * 45}ms` }} />)}
      {Array.from({ length: 14 }, (_, index) => <span key={`h${index}`} className={clsx(styles.gridLine, styles.gridH)} style={{ top: index * 120, animationDelay: `${200 + index * 55}ms` }} />)}
    </div>
  );
}

export default async function LandingPage() {
  // On the marketing host the console lives on its own subdomain; everywhere else (previews, localhost) it is same-origin.
  const appBase = siteForHost((await headers()).get("host")) === "marketing" ? APP_ORIGIN : "";
  const launch = `${appBase}/`;
  const signIn = `${appBase}/login`;

  return (
    <div className="bg-[#ece8dd] text-[#0b0b0d]">
      {/* Ticker */}
      <div className="border-b border-[#f4f1e8]/20 bg-[#0b0b0d] text-[#f4f1e8]">
        <div className="flex h-9 items-center overflow-hidden whitespace-nowrap" aria-hidden="true">
          <div className={clsx(styles.ticker, label)}>
            {[...tickerItems, ...tickerItems].map((item, index) => (
              <span key={index} className="inline-flex items-center gap-[18px] pr-[18px]"><span>{item}</span><Spark className="text-[#7fa6ff]" /></span>
            ))}
          </div>
        </div>
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-[#0b0b0d] bg-[#ece8dd]/90 backdrop-blur">
        <div className={clsx(wrap, "flex h-[68px] items-center justify-between gap-6")}>
          <a href="#top" aria-label="Hodd Finance, home" className="flex min-h-11 items-center">
            <Image src="/brand/hodd-lockup-light.png" alt="" width={1912} height={608} sizes="140px" loading="eager" className="block h-auto w-[140px]" />
          </a>
          <nav aria-label="Primary" className="hidden gap-9 md:flex">
            <a className={navLink} href="#system">System</a>
            <a className={navLink} href="#how">How it works</a>
            <a className={navLink} href="#hoddie">Hoddie</a>
            <a className={navLink} href="#principles">Principles</a>
          </nav>
          <div className="flex items-center gap-5">
            <a className={clsx(label, "hidden min-h-11 items-center whitespace-nowrap hover:underline hover:underline-offset-[6px] sm:inline-flex")} href={signIn}>Sign in</a>
            <a className={clsx(buttonInk, "min-h-11")} href={launch}>Launch app <Arrow /></a>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section id="top" className={clsx(styles.hero, "relative overflow-hidden border-b border-[#0b0b0d]")} suppressHydrationWarning>
          <InlineScript html={introScript} />
          <GridLines />
          <div className={clsx(wrap, "relative")}>
            <div className="flex items-start justify-between gap-6 pt-8">
              <div className={clsx(label, "flex-1")}>Policy-bound<br />Treasury<br />Systems</div>
              <div aria-hidden="true" className={clsx(styles.crosshair, "mt-1.5 hidden sm:block")} />
              <div className={clsx(label, "flex-1 text-right")}>On Arc<br />For a brighter tomorrow</div>
            </div>

            <div className="pb-[clamp(20px,2.5vw,36px)] pt-[clamp(24px,4vw,56px)]">
              <HeroMark />
            </div>

            <div className="flex items-end justify-between gap-6 pb-11">
              <div className={clsx(label, "flex-1")}>Capital<br />Liquidity<br />Obligations<br />Ahead of time</div>
              <div aria-hidden="true" className={clsx(styles.crosshair, "mb-1.5 hidden sm:block")} />
              <div className={clsx(label, "flex-1 text-right")}>Money<br />should know<br />what’s next.</div>
            </div>

            <div className="flex flex-wrap items-end gap-x-[72px] gap-y-9 border-t border-[#0b0b0d] pb-[68px] pt-[52px]">
              <h1 className="disp m-0 flex-[1_1_520px] text-[clamp(2.1rem,5.2vw,4.75rem)]">
                {headline.map((line, row) => (
                  <Fragment key={row}>
                    {row > 0 && " "}
                    <span className="block">
                      {line.map((word, column) => {
                        const index = headline.slice(0, row).flat().length + column;
                        // 0.1 s start, 50 ms apart, 0.7 s each: the last word settles at 1 s.
                        return <Fragment key={word}>{column > 0 && " "}<span className={styles.wordMask}><span className={styles.wordIn} style={{ "--delay": `${100 + index * 50}ms` } as React.CSSProperties}>{word}</span></span></Fragment>;
                      })}
                    </span>
                  </Fragment>
                ))}
              </h1>
              <div className="max-w-[520px] flex-[1_1_360px]">
                <p className="mb-7 text-lg leading-[1.55] text-[#3b3a36]">Manage your own wallet on Arc Testnet. Read live USDC balances and Morpho vault positions, track your bills, and review every transaction before signing.</p>
                <div className="flex flex-wrap gap-3.5">
                  <MagneticLink className={buttonInk} href={launch}>Launch app <Arrow /></MagneticLink>
                  <a className={buttonLine} href="#system">See how it thinks</a>
                </div>
              </div>
            </div>

            <div className="pb-[clamp(56px,7vw,96px)]">
              <LiveTreasury />
            </div>
          </div>
        </section>

        {/* Facts */}
        <section aria-label="Hodd at a glance" className="border-b border-[#0b0b0d] bg-[#0b0b0d]">
          <div className={wrap}>
            <dl className="m-0 flex flex-wrap gap-px border-x border-[#0b0b0d] bg-[#0b0b0d]">
              {facts.map((fact) => (
                <div key={fact.label} className="flex-[1_1_240px] bg-[#f4f1e8] p-7">
                  <dt className={clsx(label, "text-[#5a5953]")}>{fact.label}</dt>
                  <dd className="m-0">
                    <span className={clsx("disp mb-2.5 mt-3.5 block whitespace-nowrap text-[clamp(1.75rem,3vw,2.75rem)]", fact.label === "Network" && "text-[#0a52e8]")}>{fact.label === "Horizon" ? <><CountUp to={30} />&nbsp;days</> : fact.value}</span>
                    <span className={clsx(label, "text-[#5a5953]")}>{fact.note}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* System */}
        <section id="system" className="relative overflow-hidden border-b border-[#0b0b0d] bg-[#0b0b0d] text-[#f4f1e8]" style={{ backgroundImage: "radial-gradient(ellipse 60% 50% at 88% 18%,rgba(40,90,255,.38),rgba(40,90,255,0) 70%)" }}>
          <SystemMotion>
            <SystemStar className="pointer-events-none absolute -right-[10%] -top-[12%] w-[min(50vw,720px)]" />
            <div className={clsx(wrap, "relative py-[clamp(64px,8vw,112px)]")}>
              <div className={clsx(label, "text-[#8fb0ff]")}>01 — The system</div>
              <RevealLines lines={["Three verbs.", "One treasury that plans ahead."]} className="disp mb-[clamp(36px,5vw,64px)] mt-5 max-w-[920px] text-[clamp(2.1rem,5vw,4.5rem)]" />
              <SystemTabs />
            </div>
          </SystemMotion>
        </section>

        {/* How it works */}
        <section id="how" className="border-b border-[#0b0b0d] bg-[#ece8dd]">
          <div className={clsx(wrap, "py-[clamp(64px,8vw,112px)]")}>
            <HowTimeline steps={steps} intro="Connect your wallet, add your bills, and set your liquidity policy. Hoddie explains the results; the Claude connector prepares changes for your review." outlineClass={styles.outline} />
          </div>
        </section>

        {/* Hoddie and Autopilot */}
        <section id="hoddie" className="relative overflow-hidden border-b border-[#0b0b0d] bg-[#0b0b0d] text-[#f4f1e8]" style={{ backgroundImage: "radial-gradient(ellipse 55% 45% at 12% 8%,rgba(40,90,255,.3),rgba(40,90,255,0) 70%)" }}>
          <div className={clsx(wrap, "relative py-[clamp(64px,8vw,112px)]")}>
            <div className="mb-[clamp(36px,5vw,64px)] flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
              <div>
                <div className={clsx(label, "text-[#8fb0ff]")}>03 — Hoddie</div>
                <RevealLines lines={["Ask first.", "Automate later."]} className="disp mt-5 text-[clamp(2.1rem,5vw,4.5rem)]" />
              </div>
              <p className="m-0 max-w-[440px] text-[17px] leading-[1.55] text-[#c9cbd3]">Hoddie answers questions about your treasury and drafts changes for you to review. Autopilot runs a separate agent wallet on a budget you set: it invests idle cash in Morpho and sends liquidity back when your bills need it.</p>
            </div>
            <HoddiePreview />
          </div>
        </section>

        {/* Principles */}
        <section id="principles" className="relative overflow-hidden border-b border-[#0b0b0d] bg-[#e3dfd2]">
          <div className={clsx(wrap, "py-[clamp(64px,8vw,112px)]")}>
            <div className="flex flex-wrap items-center gap-x-12 gap-y-14">
              <div className="min-w-0 flex-[2.2_1_560px]">
                <div className={clsx(label, "mb-6 text-[#0a52e8]")}>04 — Principles</div>
                <RevealLines lines={["Proactive.", "Never", "unaccountable."]} className="disp m-0 text-[clamp(1.7rem,4.6vw,4.25rem)]" />
              </div>
              <div className="flex flex-[1_1_300px] justify-center">
                <div aria-hidden="true" className="relative aspect-square w-[min(100%,340px)]">
                  <div className={clsx(styles.sphere, "absolute inset-0 rounded-full opacity-85")} />
                  <svg viewBox="0 0 400 400" fill="none" stroke="#0b0b0d" strokeWidth="1" className="absolute inset-0 h-full w-full">
                    <circle cx="200" cy="200" r="190" />
                    <ellipse cx="200" cy="200" rx="156" ry="190" />
                    <ellipse cx="200" cy="200" rx="95" ry="190" />
                    <path d="M200 10V390" />
                    <path d="M10 200H390M35.5 105H364.5M35.5 295H364.5M105 35.5H295M105 364.5H295" />
                  </svg>
                  <Image src="/brand/hodd-star-light.png" alt="" width={480} height={480} className="absolute -left-[10%] top-0 h-auto w-[38%] drop-shadow-[0_0_14px_rgba(40,100,255,0.35)]" />
                  <div className="absolute -bottom-[6%] -right-[4%] aspect-[4/3] w-[46%] border border-[#0b0b0d]" style={{ background: "radial-gradient(ellipse 60% 40% at 25% 88%,#fff 0,rgba(255,255,255,0) 70%),radial-gradient(ellipse 50% 35% at 72% 96%,#fff 0,rgba(255,255,255,0) 70%),radial-gradient(ellipse 40% 24% at 55% 66%,rgba(255,255,255,.9) 0,rgba(255,255,255,0) 70%),linear-gradient(180deg,#2C6BE0 0,#7FAEF5 55%,#DDEBFF 100%)" }} />
                </div>
              </div>
            </div>

            <ul className="m-0 mt-[clamp(56px,7vw,96px)] list-none border-t border-[#0b0b0d] p-0">
              {principles.map((item) => (
                <li key={item.no} className="flex flex-wrap items-baseline gap-x-10 gap-y-3 border-b border-[#0b0b0d] py-7">
                  <span className={clsx(label, "w-10")}>{item.no}</span>
                  <h3 className="disp m-0 flex-[1_1_220px] text-[clamp(1.5rem,2.6vw,2.1rem)]">{item.title}</h3>
                  <p className="m-0 flex-[2_1_320px] text-[17px] leading-[1.55] text-[#3b3a36]">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section id="cta" className="relative overflow-hidden border-b border-[#0b0b0d] bg-[#0a52e8] text-white" style={{ backgroundImage: "linear-gradient(to right,rgba(255,255,255,.14) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.14) 1px,transparent 1px)", backgroundSize: "120px 120px" }}>
          <div className={clsx(wrap, "relative py-[clamp(64px,8vw,112px)]")}>
            <div className="flex flex-wrap items-center gap-x-12 gap-y-14">
              <div className="min-w-0 flex-[1.4_1_480px]">
                <div className={clsx(label, "text-[#d6e4ff]")}>05 — Get started</div>
                <RevealLines lines={["Money should", "know what’s next."]} className="disp mb-7 mt-[22px] text-[clamp(2.25rem,5.4vw,4.75rem)]" />
                <p className="mb-9 max-w-[480px] text-lg leading-[1.55] text-[#eaf1ff]">Start with an empty treasury. Connect your own Arc Testnet wallet and get free testnet USDC from the Circle faucet.</p>
                <div className="flex flex-wrap gap-3.5">
                  <MagneticLink className={buttonPaper} href={launch}>Launch app <Arrow /></MagneticLink>
                  <a className={buttonLight} href={signIn}>Sign in</a>
                </div>
              </div>
              <div className="flex flex-[1_1_300px] justify-center">
                <CtaStar />
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative overflow-hidden bg-[#0b0b0d] text-[#f4f1e8]">
        <div className={clsx(wrap, "pt-[clamp(56px,7vw,88px)]")}>
          <div className="flex flex-wrap justify-between gap-12">
            <div className="max-w-[360px] flex-[1_1_280px]">
              <Image src="/brand/hodd-lockup-dark.png" alt="Hodd Finance" width={1000} height={318} className="block h-auto w-[200px]" />
              <p className="mt-5 text-base leading-[1.55] text-[#a5a8b3]">Treasury that plans ahead, on Arc.</p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-[72px] gap-y-10">
              <div>
                <div className={clsx(label, "mb-2.5 text-[#8fb0ff]")}>Product</div>
                <div className="flex flex-col"><a className={navLink} href="#system">System</a><a className={navLink} href="#how">How it works</a><a className={navLink} href="#hoddie">Hoddie</a><a className={navLink} href="#principles">Principles</a></div>
              </div>
              <div>
                <div className={clsx(label, "mb-2.5 text-[#8fb0ff]")}>Console</div>
                <div className="flex flex-col"><a className={navLink} href={launch}>Launch app</a><a className={navLink} href={signIn}>Sign in</a></div>
              </div>
              <div>
                <div className={clsx(label, "mb-2.5 text-[#8fb0ff]")}>Contact</div>
                <div className="flex flex-col">
                  <a className={navLink} href="mailto:info@hoddfinance.xyz?subject=Hodd%20feedback">Feedback</a>
                  <a className={clsx(navLink, "gap-3")} href="https://x.com/hoddfinance" target="_blank" rel="noopener noreferrer"><XLogo />@hoddfinance<span className="sr-only"> (opens in a new tab)</span></a>
                </div>
              </div>
            </nav>
          </div>
          <div className={clsx(label, "mt-16 flex flex-wrap justify-between gap-x-8 gap-y-3 border-t border-[#f4f1e8]/20 pt-5 text-[#a5a8b3]")}>
            <span>© 2026 Hodd Finance®</span>
            <span>hoddfinance.xyz</span>
            <span>Arc Testnet only · Not financial advice</span>
          </div>
          <div aria-hidden="true" className={clsx("disp mt-8 h-[0.66em] overflow-hidden whitespace-nowrap text-center text-[clamp(3.75rem,26vw,22.5rem)] font-black leading-[0.8]", styles.ghost)}>HODD</div>
        </div>
      </footer>
    </div>
  );
}
