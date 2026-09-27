import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-2xl items-center px-5 py-16">
      <div>
        <p className="mono text-[11px] uppercase tracking-[0.2em] text-black/50">404 · Outside the ledger</p>
        <h1 className="mt-3 text-4xl font-medium tracking-[-0.05em]">This view does not exist.</h1>
        <Link href="/" className="mt-7 inline-block border-b border-black pb-1 text-sm font-semibold">Return to Portfolio</Link>
      </div>
    </section>
  );
}
