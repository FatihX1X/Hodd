import clsx from "clsx";
import type { Money, PolicyResult } from "@/lib/treasury/models";
import { formatMoney } from "@/lib/treasury/format";

export function PageHeader({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: React.ReactNode }) {
  return (
    <header className="ink-grid border-b border-black/15 px-5 py-10 text-white md:px-8 md:py-14 lg:px-10">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-7 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.22em] text-[#7fa6ff]">{eyebrow}</p>
          <h1 className="disp mt-4 text-[clamp(1.75rem,5.4vw,3.25rem)]">{title}</h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-white/60 md:text-base">{description}</p>
        </div>
        {aside}
      </div>
    </header>
  );
}

export function DemoNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="border-b border-black/15 bg-[#e3dfd2] px-5 py-3 md:px-8 lg:px-10" role="note">
      <div className="mx-auto flex max-w-[1440px] items-start gap-3 text-xs leading-5 text-[#2b2a27]">
        <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 bg-[#0a52e8]" />
        {children ?? "Choose your own wallet. Planning previews do not move funds; wallet transaction execution is currently paused."}
      </div>
    </div>
  );
}

export function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx("border border-black/15 bg-[#f4f1e8]", className)}>{children}</section>;
}

export function SectionHeading({ index, title, description, action }: { index: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-black/15 px-5 py-4">
      <div className="flex min-w-0 gap-4">
        <span className="mono mt-0.5 text-[10px] text-black/40">{index}</span>
        <div><h2 className="text-sm font-semibold tracking-[-0.02em]">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-black/50">{description}</p>}</div>
      </div>
      {action}
    </div>
  );
}

export function MoneyValue({ money, compact = false, className = "" }: { money: Money; compact?: boolean; className?: string }) {
  return <span className={clsx("mono tabular-nums", className)}>{formatMoney(money, { compact })}</span>;
}

export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "success" | "warning" | "danger" | "neutral" | "info" }) {
  const tones = {
    success: "border-[#2c7a50]/25 bg-[#dff5e8] text-[#164b32]",
    warning: "border-[#906a2f]/25 bg-[#f3e8ce] text-[#694813]",
    danger: "border-[#9a433c]/25 bg-[#f5dedb] text-[#7b332d]",
    info: "border-[#456c9c]/25 bg-[#dfe9f5] text-[#294e7c]",
    neutral: "border-black/15 bg-black/[0.04] text-black/55",
  };
  return <span className={clsx("mono inline-flex border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em]", tones[tone])}>{label}</span>;
}

export function PolicyPill({ policy }: { policy: PolicyResult }) {
  const tone = policy.status === "PASS" ? "success" : policy.status === "BLOCKED" ? "danger" : policy.status === "REVIEW" ? "warning" : "neutral";
  return <StatusPill label={policy.status.replace("_", " ")} tone={tone} />;
}
