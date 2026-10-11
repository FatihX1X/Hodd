"use client";

import { ProgressRail, type RailOutcome, type Step } from "./progress-rail";

export type AutopilotLocalPhase = "preparing" | "wallet" | "funding" | "starting" | "cooldown";
export interface AutopilotProgressInput {
  flow: "invest" | "return";
  /** Client phase before/while the agent run starts (invest: preparing -> wallet -> funding -> starting; both flows may hit cooldown = automatic retry after a 5-minute rate limit). null once a run exists. */
  local: AutopilotLocalPhase | null;
  run: { state: "RUNNING" | "NO_ACTION" | "COMPLETED" | "PARTIAL" | "FAILED" | "UNKNOWN"; decision: { kind: string; depositMinor: string; withdrawMinor: string; transferMinor: string; explanation: string }; failure: string | null } | null;
  /** This run's steps, oldest first. Server step states: PREPARED, SUBMITTING, SUBMITTED, VERIFIED, FAILED, UNKNOWN. */
  steps: readonly { stage: string; state: string; tx_hash: string | null }[];
  /** A client-side failure before any run (wallet cancelled, funding reverted, server refusal). */
  error: string | null;
  /** Seconds until the automatic retry while local === "cooldown". */
  countdown: number | null;
  /** The view's final plain sentence, e.g. "Done. 19.97 USDC sent to your wallet." or a plain failure explanation. Use it as the caption when the run has ended. */
  result: string | null;
  /** The owner's funding transfer hash (invest), for a link while waiting. */
  fundingHash: string | null;
}

type Part = Pick<Step, "state" | "note">;
type ServerStep = AutopilotProgressInput["steps"][number];

const TX = "https://testnet.arcscan.app/tx/";
const milestones = {
  invest: [["prepare", "Prepare"], ["fund", "Fund agent"], ["approve", "Approve"], ["deposit", "Deposit"], ["done", "Done"]],
  return: [["start", "Start"], ["withdraw", "Withdraw"], ["send", "Send"], ["done", "Done"]],
} as const;
const investLocal: Record<AutopilotLocalPhase, { at: number; note: string }> = {
  preparing: { at: 0, note: "Preparing" }, wallet: { at: 1, note: "In your wallet" }, funding: { at: 1, note: "Arriving" }, starting: { at: 2, note: "Starting" }, cooldown: { at: 2, note: "" },
};
const part = (state: Step["state"], note: string): Part => ({ state, note });
const fromServer = (step: ServerStep | undefined, done: string): Part | undefined => !step ? undefined
  : step.state === "VERIFIED" ? part("done", done)
  : step.state === "FAILED" ? part("failed", "Stopped")
  : step.state === "UNKNOWN" ? part("unknown", "Unknown")
  : part("active", step.state === "SUBMITTED" ? "Confirming" : "Sending");

/** Reads the agent's run and the client phase into milestones. Only the server's steps move the rail once a run exists; nothing is inferred from time. */
export function autopilotProgress({ flow, local, run, steps: serverSteps, error, countdown, result, fundingHash }: AutopilotProgressInput) {
  const invest = flow === "invest";
  const labels: readonly (readonly [string, string])[] = milestones[flow];
  const last = labels.length - 1;
  const latest = (...stages: string[]) => serverSteps.filter((step) => stages.includes(step.stage)).at(-1);
  const approval = latest("APPROVAL"), earn = latest("EARN"), transfer = latest("TRANSFER");
  const clientError = run ? null : error || null;
  const ended = run?.state === "COMPLETED" || run?.state === "NO_ACTION";
  let slots: (Part | undefined)[];
  if (run) {
    const approvalPart = fromServer(approval, "Approved");
    slots = invest
      ? [part("done", "Ready"), part("done", "Arrived"), approvalPart ?? (earn || ended ? part("skipped", "Not needed") : undefined), fromServer(earn, "Deposited"), run.state === "COMPLETED" ? part("done", "Finished") : undefined]
      : [part("done", "Started"),
        earn ? fromServer(earn, "Withdrawn") : approvalPart && approvalPart.state !== "done" ? approvalPart : !approval && run.decision.withdrawMinor === "0" ? part("skipped", "Nothing in Morpho") : undefined,
        fromServer(transfer, "Sent"), run.state === "COMPLETED" ? part("done", "Finished") : undefined];
  } else {
    const phase = local ?? "preparing";
    const at = invest ? investLocal[phase].at : 0;
    const note = phase === "cooldown" ? (countdown === null ? "Starts soon" : `Starts in ${countdown}s`) : invest ? investLocal[phase].note : phase === "preparing" ? "Preparing" : "Starting";
    slots = labels.map((_, index) => index < at ? part("done", index === 0 ? "Ready" : "Arrived") : index === at ? (clientError ? part("failed", "Stopped") : part("active", note)) : undefined);
  }
  const outcome: RailOutcome = clientError ? "failed"
    : !run ? "running"
    : run.state === "COMPLETED" ? "done"
    : run.state === "NO_ACTION" ? "idle"
    : run.state === "FAILED" || run.state === "PARTIAL" ? "failed"
    : run.state === "UNKNOWN" || slots.some((slot) => slot?.state === "unknown") ? "unknown"
    : slots.some((slot) => slot?.state === "failed") ? "failed"
    : "running";

  const halt = outcome === "failed" ? part("failed", "Stopped") : outcome === "unknown" ? part("unknown", "Unknown") : null;
  const steps: Step[] = labels.map(([key, label], index) => {
    const slot = slots[index];
    if (outcome === "done") return { key, label, ...(!slot || slot.state === "waiting" ? index === last ? part("done", "Finished") : part("skipped", "Not needed") : slot.state === "skipped" || slot.state === "done" ? slot : part("done", "Done")) };
    if (outcome === "idle") return { key, label, ...(slot ?? part("skipped", "Skipped")) };
    return { key, label, ...(slot ?? part("waiting", "")) };
  });
  let active = last;
  if (outcome === "idle") active = Math.max(0, steps.map((step) => step.state).lastIndexOf("done"));
  else if (outcome !== "done") {
    // Between the agent's steps the next open milestone is the one being prepared.
    const open = steps.findIndex((step) => step.state === "active" || step.state === "failed" || step.state === "unknown");
    active = open >= 0 ? open : steps.findIndex((step) => step.state === "waiting");
    if (active < 0) active = last;
    const current = steps[active];
    if (current.state === "waiting") steps[active] = { ...current, ...(halt ?? part("active", current.key === "done" ? "Finishing" : "Preparing")) };
    else if (halt && current.state === "active") steps[active] = { ...current, ...halt };
    const next = steps.findIndex((step, index) => index > active && step.state === "waiting");
    steps.forEach((step, index) => {
      if (index > active && step.state === "waiting") steps[index] = { ...step, note: halt ? "Not run" : index === last ? "Last" : index === next ? "Next" : "Later" };
    });
  }

  const key = steps[active].key;
  const caption = outcome === "done" ? result ?? (invest ? "Your USDC is invested." : "Your USDC is back in your wallet.")
    : outcome === "idle" ? result ?? run?.decision.explanation ?? "Nothing to do."
    : clientError ? clientError
    : outcome === "failed" ? result ?? "Stopped here. Nothing else is sent from this run."
    : outcome === "unknown" ? result ?? "The transaction is uncertain. Hodd is checking it; use recovery below if needed."
    : !run && local === "cooldown" ? "Hodd allows one run every few minutes. Trying again automatically."
    : key === "prepare" ? "Setting up your agent."
    : key === "start" ? (local === "preparing" || !local ? "Preparing your return." : "Starting your return.")
    : key === "fund" ? (local === "funding" ? "Your USDC is on its way to the agent." : "Confirm the transfer in your wallet.")
    : key === "approve" ? (!run ? "Your agent is starting." : approval ? "The agent is approving USDC for Morpho." : "The agent is preparing the deposit.")
    : key === "deposit" ? "The agent is depositing into Morpho."
    : key === "withdraw" ? "Withdrawing your Morpho position."
    : key === "send" ? "Sending USDC to your wallet."
    : invest ? "Deposit confirmed. Finishing up." : "USDC sent. Finishing up.";
  const lastHash = serverSteps.filter((step) => step.tx_hash).at(-1)?.tx_hash;
  const link = outcome === "done" && lastHash ? { href: TX + lastHash, text: "Open transaction" }
    : !run && local === "funding" && fundingHash ? { href: TX + fundingHash, text: "View transfer" }
    : null;
  return { label: invest ? "Invest progress" : "Return progress", steps, active, outcome, caption, link };
}

/** The Autopilot invest or return as a rail: the spark moves to each milestone as the agent's steps are confirmed. */
export function AutopilotProgress({ input, className }: { input: AutopilotProgressInput; className?: string }) {
  return <ProgressRail {...autopilotProgress(input)} className={className} />;
}
