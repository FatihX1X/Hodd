import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <section className="metric-grid flex min-h-screen items-center px-5 py-16">
      <div className="mx-auto w-full max-w-2xl">
        <Image src="/brand/hodd-lockup-light.png" alt="Hodd Finance" width={1912} height={608} className="mb-10 h-auto w-[180px]" />
        <p className="mono text-[11px] uppercase tracking-[0.2em] text-black/55">404 · Outside the ledger</p>
        <h1 className="disp mt-4 text-[clamp(1.75rem,7vw,3.25rem)]">This view does not exist.</h1>
        <Link href="/" className="mono mt-8 inline-block border-b border-black pb-1 text-[11px] font-semibold uppercase tracking-[0.09em]">Return to Portfolio</Link>
      </div>
    </section>
  );
}
