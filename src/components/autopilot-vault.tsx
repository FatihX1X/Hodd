"use client";

import { formatUnits } from "viem";
import { BellRing, CalendarClock, ExternalLink, KeyRound, LockKeyhole, ReceiptText, Vault } from "lucide-react";
import { SectionCard, SectionHeading, StatusPill } from "./primitives";
import { ConfirmButton } from "./confirm-button";
import { Tip } from "./tip";
import { moneyColor } from "./visuals";

export type VaultView = {
  address: string; deployed: boolean; factory: string; paused?: boolean;
  limits?: { maxDepositPerTxMinor: string; depositLimit24hMinor: string; maxPaymentPerTxMinor: string; paymentLimit24hMinor: string };
  strategies?: string[]; depositRoomMinor?: string; paymentRoomMinor?: string; agentGasMinor?: string;
};
export type VaultBillView = { id: string; title: string; amountMinor: string; dueAt: string; recipient: string | null; capMinor: string; plan: "PAYS" | "NEEDS_APPROVAL" | "CAP_TOO_LOW" | "NO_RECIPIENT" | "IN_FLIGHT" | "OVER_LIMIT"; payFrom: string | null };
export type NeedsYou = { code: string; message: string };

const display = (minor: string) => formatUnits(BigInt(minor), 6) + " USDC";
const short = (address: string) => address.slice(0, 6) + "…" + address.slice(-4);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const ARCSCAN = "https://testnet.arcscan.app/address/";

/** Things only the owner can do, said once at the top of the page. */
export function NeedsYouBanner({ items }: { items: NeedsYou[] }) {
  if (!items.length) return null;
  return <section aria-label="Needs you" className="mb-6 border border-[#e9b949]/40 bg-[#e9b949]/[0.07] px-4 py-3">
    <ul className="space-y-1.5 text-sm text-[#f3d98a]">{items.map((item) => <li key={item.code} className="flex items-start gap-2"><BellRing aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{item.message}</li>)}</ul>
  </section>;
}

/** The user's own HoddieVault: who controls it, the limits the contract enforces, and the way out that needs no one. */
export function VaultCard({ vault, disabled, onWithdrawAll }: { vault: VaultView | null; disabled: boolean; onWithdrawAll: () => void }) {
  if (!vault) return null;
  const limits = vault.limits;
  return <SectionCard className="mt-6"><SectionHeading icon={<Vault aria-hidden="true" className="size-4" />} title="Your vault" action={<Tip align="end" label="About your vault">A contract that holds your Autopilot money. Your wallet owns it; your agent can only invest in Morpho, bring money back to the vault or to you, and pay recipients you approved, within the limits below. You can take everything out yourself at any time, even if Hodd is offline.</Tip>} />
    <div className="grid gap-px bg-white/[0.08] sm:grid-cols-[1.2fr_1fr]">
      <div className="space-y-3 bg-[#101319] p-5 text-sm">
        {vault.deployed ? <p className="flex flex-wrap items-center gap-2"><StatusPill label={vault.paused ? "Paused" : "Live"} tone={vault.paused ? "warning" : "success"} /><a className="mono inline-flex min-h-11 items-center gap-1 text-[#9ec5f4] underline underline-offset-4" href={ARCSCAN + vault.address} target="_blank" rel="noreferrer">{short(vault.address)}<ExternalLink aria-hidden="true" className="size-3" /></a></p>
          : <p className="text-white/65">Created at <span className="mono text-white/85">{short(vault.address)}</span> with your first Invest.</p>}
        <ul className="space-y-2 text-[13px] text-white/70">
          <li className="flex items-center gap-2"><KeyRound aria-hidden="true" className="size-3.5 shrink-0" style={{ color: moneyColor.safe }} />Owner: your wallet</li>
          <li className="flex items-center gap-2"><LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" style={{ color: moneyColor.MORPHO }} />Operator: your agent, limited by the contract</li>
        </ul>
        {vault.deployed && <ConfirmButton variant="ghost" disabled={disabled} onClick={onWithdrawAll}>Take everything back yourself</ConfirmButton>}
      </div>
      <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 bg-[#101319] p-5 text-[12px]">
        {limits ? <>
          <div><dt className="text-white/55">Per deposit</dt><dd className="mono mt-0.5 tabular-nums text-white/85">{display(limits.maxDepositPerTxMinor)}</dd></div>
          <div><dt className="text-white/55">Deposits a day</dt><dd className="mono mt-0.5 tabular-nums text-white/85">{display(limits.depositLimit24hMinor)}</dd></div>
          <div><dt className="text-white/55">Per payment</dt><dd className="mono mt-0.5 tabular-nums text-white/85">{display(limits.maxPaymentPerTxMinor)}</dd></div>
          <div><dt className="text-white/55">Payments a day</dt><dd className="mono mt-0.5 tabular-nums text-white/85">{display(limits.paymentLimit24hMinor)}</dd></div>
          {vault.agentGasMinor && <div className="col-span-2"><dt className="text-white/55">Agent fee money</dt><dd className="mono mt-0.5 tabular-nums text-white/85">{display(vault.agentGasMinor)}</dd></div>}
        </> : <p className="col-span-2 text-white/55">Limits appear once the vault exists.</p>}
      </dl>
    </div>
  </SectionCard>;
}

const plans: Record<VaultBillView["plan"], { label: string; tone: "success" | "warning" | "neutral" | "info" }> = {
  PAYS: { label: "Autopilot pays", tone: "success" },
  IN_FLIGHT: { label: "Payment open", tone: "info" },
  NEEDS_APPROVAL: { label: "Needs your approval", tone: "warning" },
  CAP_TOO_LOW: { label: "Approve the new amount", tone: "warning" },
  NO_RECIPIENT: { label: "No Arc address", tone: "neutral" },
  OVER_LIMIT: { label: "Above the vault limit", tone: "neutral" },
};

/** Upcoming bills and who pays them. Approving a recipient is one owner transaction on the vault, capped at the bill. */
export function VaultBills({ bills, disabled, onApprove }: { bills: VaultBillView[]; disabled: boolean; onApprove: (id: string) => void }) {
  return <SectionCard className="mt-6"><SectionHeading icon={<ReceiptText aria-hidden="true" className="size-4" />} title="Bills Autopilot pays" action={<Tip align="end" label="About bill payments">Approve a bill once and Autopilot pays it from your vault a day before it is due, taking money out of Morpho first if it has to. Approval is for the recipient: their later bills up to the same amount are paid too. The contract only pays recipients you approved, up to the amount you approved, and at most 1,000 USDC per payment. A bill you do not approve stays yours to pay.</Tip>} />
    {bills.length === 0 ? <p className="p-5 text-sm text-white/60">No bills in the next 30 days. Add one on Obligations with the recipient&apos;s Arc address.</p>
      : <ul className="divide-y divide-white/10">{bills.map((bill) => {
        const plan = plans[bill.plan];
        return <li key={bill.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{bill.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/55"><span className="mono tabular-nums text-white/85">{display(bill.amountMinor)}</span><span className="inline-flex items-center gap-1"><CalendarClock aria-hidden="true" className="size-3.5" />Due {day(bill.dueAt)}</span>{bill.plan === "PAYS" && bill.payFrom && <span>Pays from {day(bill.payFrom)}</span>}{bill.plan === "NO_RECIPIENT" && <span>Add the recipient&apos;s address on Obligations</span>}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill label={plan.label} tone={plan.tone} />
            {(bill.plan === "NEEDS_APPROVAL" || bill.plan === "CAP_TOO_LOW") && <ConfirmButton variant="ghost" disabled={disabled} onClick={() => onApprove(bill.id)} aria-label={`Let Autopilot pay ${bill.title}`}>Let Autopilot pay</ConfirmButton>}
          </div>
        </li>;
      })}</ul>}
  </SectionCard>;
}
