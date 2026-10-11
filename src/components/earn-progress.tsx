"use client";

import type { EarnOperation } from "@/lib/earn/models";
import { ProgressRail, type Step } from "./progress-rail";

export type EarnEvent = Readonly<{ stage: string; hash?: string }>;
export type EarnOutcome = "running" | "done" | "partial" | "failed" | "unknown";
type Sub = "waiting" | "wallet" | "submitted" | "confirmed" | "skipped";

const verbs: Record<EarnOperation, string> = { DEPOSIT: "Deposit", WITHDRAW: "Withdraw", REDEEM_ALL: "Redeem" };
const SUBMITTED = /^(TRANSACTION_SUBMITTED|USER_OPERATION_SUBMITTED|TRANSACTION_REPORTED|(APPROVAL|EARN)_PIN_APPROVED)$/;

/** Reads the server's execution events into milestones. Only events move the rail; nothing is inferred from time. */
export function earnProgress(operation: EarnOperation, events: readonly EarnEvent[], outcome: EarnOutcome) {
  const verb = verbs[operation];
  const sub: Record<"approval" | "earn", Sub> = { approval: "waiting", earn: "waiting" };
  let phase: "approval" | "earn" | null = null;
  for (const { stage } of events) {
    if (/^APPROVAL_(SIGNATURE|PIN)_REQUESTED$/.test(stage)) { phase = "approval"; sub.approval = "wallet"; }
    else if (/^EARN_(SIGNATURE|PIN)_REQUESTED$/.test(stage)) { phase = "earn"; sub.earn = "wallet"; if (sub.approval === "waiting") sub.approval = "skipped"; }
    else if (stage === "APPROVAL_CONFIRMED") sub.approval = "confirmed";
    else if (SUBMITTED.test(stage) && phase) sub[phase] = "submitted";
  }
  const finished = outcome === "done" || outcome === "partial";
  const withApproval = operation === "DEPOSIT" || events.some((event) => event.stage.startsWith("APPROVAL_"));
  const steps: Step[] = [
    events.length || finished ? { key: "confirm", label: "Confirmed", state: "done", note: "By you" } : { key: "confirm", label: "Confirm", state: "active", note: "Preparing" },
    ...(withApproval ? [
      sub.approval === "confirmed" ? { key: "approval", label: "Approve USDC", state: "done", note: "Confirmed" }
        : sub.approval === "skipped" || (finished && sub.approval === "waiting") ? { key: "approval", label: "Approve USDC", state: "skipped", note: "Not needed" }
        : sub.approval === "wallet" ? { key: "approval", label: "Approve USDC", state: "active", note: "In your wallet" }
        : sub.approval === "submitted" ? { key: "approval", label: "Approve USDC", state: "active", note: "Confirming" }
        : { key: "approval", label: "Approve USDC", state: "waiting", note: "Next" },
    ] as Step[] : []),
    finished || sub.earn === "submitted" ? { key: "earn", label: verb, state: "done", note: "Sent" }
      : sub.earn === "wallet" ? { key: "earn", label: verb, state: "active", note: "In your wallet" }
      : { key: "earn", label: verb, state: "waiting", note: "Next" },
    finished ? { key: "verify", label: "Verified", state: "done", note: outcome === "partial" ? "Partial" : "Receipt checked" }
      : sub.earn === "submitted" ? { key: "verify", label: "Verify", state: "active", note: "Checking receipt" }
      : { key: "verify", label: "Verify", state: "waiting", note: "Last" },
  ];
  let active = steps.findIndex((step) => step.state === "active");
  // Between wallet requests the server is preparing the next one: the next open step is the active one.
  if (active < 0) active = finished ? steps.length - 1 : steps.findIndex((step) => step.state === "waiting");
  if (!finished && (outcome === "failed" || outcome === "unknown") && active >= 0) steps[active] = { ...steps[active], state: outcome, note: outcome === "failed" ? "Stopped" : "Unknown" };
  else if (!finished && steps[active]?.state === "waiting") steps[active] = { ...steps[active], state: "active", note: "Preparing" };

  const current = steps[active];
  const caption = outcome === "done" ? `${verb} verified on Arc Testnet.`
    : outcome === "partial" ? "Partly redeemed. Some shares are still in the vault."
    : outcome === "failed" ? "Stopped here. Nothing else is sent from this request."
    : outcome === "unknown" ? "The outcome is unknown. Check your wallet before trying again."
    : current.key === "confirm" ? "Preparing your transaction."
    : current.key === "approval" ? (sub.approval === "submitted" ? "Approval sent. Waiting for Arc Testnet to confirm it." : sub.approval === "wallet" ? "Approve USDC spending in your wallet." : "Preparing the approval request.")
    : current.key === "earn" ? (sub.earn === "wallet" ? `Sign the ${verb.toLowerCase()} in your wallet.` : `Preparing the ${verb.toLowerCase()} request.`)
    : `${verb} sent. Verifying the receipt on Arc Testnet.`;
  return { steps, active, caption, verb };
}

/** The deposit, withdrawal or redemption as a rail: the spark moves to each milestone as the server confirms it. */
export function EarnProgress({ operation, events, outcome, explorerUrl }: { operation: EarnOperation; events: readonly EarnEvent[]; outcome: EarnOutcome; explorerUrl?: string }) {
  const { steps, active, caption, verb } = earnProgress(operation, events, outcome);
  const finished = outcome === "done" || outcome === "partial";
  return <ProgressRail label={`${verb} progress`} steps={steps} active={active} outcome={outcome === "partial" ? "done" : outcome} caption={caption} link={finished && explorerUrl ? { href: explorerUrl, text: "Open transaction" } : null} />;
}

const readable = (stage: string) => stage.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

/** Every server event with its hash, for anyone who wants to check the chain themselves. */
export function EarnEventDetails({ events }: { events: readonly EarnEvent[] }) {
  if (!events.length) return null;
  return (
    <details className="group mx-5 mb-5 border border-white/[0.14]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs text-white/65 hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">Transaction details<span className="mono text-[10px] text-white/55">{events.length} {events.length === 1 ? "event" : "events"}</span></summary>
      <ol aria-label="Execution timeline" className="m-0 list-none divide-y divide-white/10 border-t border-white/10 p-0">
        {events.map((event, index) => (
          <li key={`${index}-${event.stage}`} className="px-4 py-3 text-xs">
            <span className="block">{readable(event.stage)}</span>
            {event.hash && <a href={`https://testnet.arcscan.app/tx/${event.hash}`} target="_blank" rel="noreferrer" className="mono mt-1 block break-all text-[10px] text-[#9ec5f4] underline underline-offset-2">{event.hash}</a>}
          </li>
        ))}
      </ol>
    </details>
  );
}
