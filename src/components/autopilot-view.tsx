"use client";
import { useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader, SectionCard, SectionHeading, KpiGrid, Kpi, StatusPill, buttonClass, inputClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import type { Mandate, Decision } from "@/lib/autopilot/models";
import { decimalStringToMoney } from "@/lib/earn/money";
import { formatUnits } from "viem";
interface Status { executionEnabled:boolean; mode:string; wallet:{address:string;owner_address:string;account_type:string}|null; mandate:Mandate|null;spentMinor:string;returnRequested:boolean;balances:{cashMinor:string;positionMinor:string;redeemableMinor:string;observedAt:string}|null;balanceError:string|null;runs:{id:string;state:string;decision:Decision;failure:string|null;created_at:string}[];steps:{id:string;run_id:string;stage:string;state:string;tx_hash:string|null;circle_transaction_id:string|null}[]; }
interface Review { reviewId:string;mandate:Mandate;destination:string;agentAddress:string;network:string;token:string;explanation:string; }
const display=(minor:string)=>formatUnits(BigInt(minor),6)+" USDC";
export function AutopilotView() {
  const {signedIn,workspace}=useTreasuryWorkspace();
  const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const [budget,setBudget]=useState("50"),[reserve,setReserve]=useState("5"),[perRun,setPerRun]=useState("10"),[cap,setCap]=useState("40");
  const [review,setReview]=useState<{kind:"mandate"|"return-all";data:Review}|null>(null);
  const [candidate,setCandidate]=useState("");
  const load=useCallback(async()=>{
    if(!signedIn)return;
    try{const response=await fetch("/api/autopilot/status",{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.message);setStatus(data);}catch(error){setMessage(error instanceof Error?error.message:"Autopilot status is unavailable.");}
  },[signedIn]);
  useEffect(()=>{let active=true; const refresh=()=>{if(active)void load();};refresh();return()=>{active=false;setStatus(null);setReview(null);};},[load,workspace.walletConnection?.address]);
  async function post(action:string,body:unknown={}) {
    const response=await fetch("/api/autopilot/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const result=await response.json();
    if(!response.ok)throw new Error(result.message+" ("+result.code+")");return result;
  }
  async function act(action:()=>Promise<void>) {
    setBusy(true);setMessage("");try{await action();await load();}catch(error){setMessage(error instanceof Error?error.message:"The request is unresolved. Check history before trying again.");}finally{setBusy(false);}
  }
  async function prepare(kind:"mandate"|"return-all") {
    const mandate:Mandate={budgetMinor:decimalStringToMoney(budget).minorUnits,reserveMinor:decimalStringToMoney(reserve).minorUnits,maxPerRunMinor:decimalStringToMoney(perRun).minorUnits,maxMorphoBps:Number(cap)*100,enabled:true,paused:false};
    const data=await post(kind,{phase:"review",...(kind==="mandate"?{mandate}:{})});setReview({kind,data});
  }
  const open=status?.runs.find(r=>r.state==="RUNNING"||r.state==="UNKNOWN");
  // Polling advances the same run only; it never starts a new one or retries a submission.
  useEffect(()=>{
    if(!open || busy)return;
    const timer=setTimeout(()=>{void act(async()=>{await post("status");});},4000);return()=>clearTimeout(timer);
  });
  const disabled=busy || !status?.executionEnabled || !signedIn;
  const unknownStep=status?.steps.find(s=>s.state==="UNKNOWN"||s.state==="SUBMITTING");
  return <>
    <PageHeader eyebrow="Agent treasury · Arc Testnet" title="Autopilot" description="Give a separate Circle wallet a budget. Hodd's deterministic engine invests it and returns protected liquidity to your verified wallet within your mandate." />
    <PageBody>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-white/15 p-4">
        <StatusPill label={status?.executionEnabled?"Testnet execution enabled":"Autopilot disabled"} tone={status?.executionEnabled?"info":"warning"}/>
        <button className={buttonClass.ghost} disabled={busy||!signedIn} onClick={()=>void act(load)}>Refresh balances</button>
        <p className="w-full text-sm text-white/60">{!signedIn?"Sign in and connect a verified wallet to use Autopilot.":!status?.executionEnabled?"The AGENT switch starts off. The operator must provision and verify this feature before funds can move.":"The agent signs server-side. You sign only the transfer that funds it. Network fees use the agent's USDC."}</p>
      </div>
      {message && <p role="alert" className="mb-6 border border-[#fab219]/40 p-4 text-sm text-[#ffd27f]">{message}</p>}
      {status?.balanceError && <p className="mb-5 text-sm text-[#ffd27f]">{status.balanceError}</p>}
      <KpiGrid columns={3} label="Agent balances"><Kpi label="Agent cash" value={status?.balances?display(status.balances.cashMinor):"Unavailable"}/><Kpi label="Morpho position" value={status?.balances?display(status.balances.positionMinor):"Unavailable"}/><Kpi label="Remaining budget" value={status?.mandate?display((BigInt(status.mandate.budgetMinor)>BigInt(status.spentMinor)?BigInt(status.mandate.budgetMinor)-BigInt(status.spentMinor):0n).toString()):"No mandate"} detail="Counts verified returns and paid fees against the budget."/></KpiGrid>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SectionCard><SectionHeading index="01" title="Agent wallet" description="Developer-controlled Circle EOA · canonical Arc Testnet USDC"/>
          <div className="space-y-4 p-5 text-sm">
            {status?.wallet?<><p className="break-all font-mono">{status.wallet.address}</p><a className="text-[#9ec5f4] underline" href={"https://testnet.arcscan.app/address/"+status.wallet.address} target="_blank" rel="noreferrer">View agent on ArcScan</a><p className="break-all text-white/60">Verified return destination: {status.wallet.owner_address}</p><p className="text-white/60">Fund this address on Arc Testnet with {status.mandate?display(status.mandate.budgetMinor):"the budget you review below"} using a normal USDC transfer that you sign in your wallet. Budget is limited to funds that actually arrive. Refresh balances after funding. Keep enough agent cash for gas; additional funding does not increase the approved budget.</p></>:<><p className="text-white/60">No agent wallet has been created for this account.</p><button className={buttonClass.primary} disabled={disabled} onClick={()=>void act(async()=>{await post("wallet");})}>Create agent wallet</button></>}
          </div>
        </SectionCard>
        <SectionCard><SectionHeading index="02" title="Mandate" description="Review exact limits before authorizing autonomous agent signing."/>
          <form className="grid grid-cols-2 gap-4 p-5" onSubmit={e=>{e.preventDefault();void act(()=>prepare("mandate"));}}>
            {[{label:"Budget (USDC)",value:budget,set:setBudget},{label:"Cash reserve (USDC)",value:reserve,set:setReserve},{label:"Maximum per run (USDC)",value:perRun,set:setPerRun},{label:"Maximum Morpho (%)",value:cap,set:setCap}].map(f=><label key={f.label} className="text-xs text-white/60">{f.label}<input className={inputClass} inputMode="decimal" value={f.value} onChange={e=>{f.set(e.target.value);setReview(null);}} required/></label>)}
            {status?.mandate && <p className="col-span-2 text-xs text-white/60">Current: {display(status.mandate.budgetMinor)} budget · {display(status.mandate.reserveMinor)} reserve · {display(status.mandate.maxPerRunMinor)} / run · {status.mandate.maxMorphoBps/100}% Morpho · {status.mandate.paused?"Paused":status.mandate.enabled?"Enabled":"Disabled"}</p>}
            <button className={buttonClass.primary+" col-span-2"} disabled={busy||!status?.wallet||!!open}>Review mandate / resume</button>
          </form>
        </SectionCard>
      </div>
      {review && <SectionCard className="mt-6"><SectionHeading index="03" title={review.kind==="return-all"?"Review return all":"Review mandate"}/><div className="space-y-3 p-5 text-sm"><p>{review.data.explanation}</p><p>{review.data.network} · canonical USDC</p><p>Budget {display(review.data.mandate.budgetMinor)} · reserve {display(review.data.mandate.reserveMinor)} · {display(review.data.mandate.maxPerRunMinor)} per run · {review.data.mandate.maxMorphoBps/100}% Morpho</p><p className="break-all">Agent: {review.data.agentAddress}</p><p className="break-all">Return destination: {review.data.destination}</p><div className="flex flex-wrap gap-3"><button className={buttonClass.primary} disabled={busy} onClick={()=>void act(async()=>{await post(review.kind,{phase:"confirm",reviewId:review.data.reviewId,confirmed:true});setReview(null);setMessage(review.kind==="return-all"?"Return authorized. Select Run now to process the next capped leg.":"Mandate confirmed. Fund the agent, then select Run now.");})}>Confirm {review.kind==="return-all"?"return all":"mandate"}</button><button className={buttonClass.ghost} disabled={busy} onClick={()=>setReview(null)}>Cancel</button></div></div></SectionCard>}
      <div className="my-6 flex flex-wrap gap-3"><button className={buttonClass.ghost} disabled={busy||!status?.mandate} onClick={()=>void act(async()=>{await post("pause");setReview(null);setMessage("Paused. Already submitted transactions can still settle.");})}>Pause</button><button className={buttonClass.primary} disabled={disabled||!status?.mandate||(!open&&!status.returnRequested&&(status.mandate.paused||!status.mandate.enabled))} onClick={()=>void act(async()=>{await post("run");})}>{open?"Check current run":"Run now"}</button><button className={buttonClass.ghost} disabled={busy||!status?.mandate||!!open} onClick={()=>void act(()=>prepare("return-all"))}>Review return all</button></div>
      <SectionCard><SectionHeading index="04" title="Last decision & run history" description="UNKNOWN holds the lease. Receipt verification is separate from Circle submission."/><div className="divide-y divide-white/10">{status?.runs.length?status.runs.map(run=><article className="space-y-3 p-5" key={run.id}><div className="flex flex-wrap justify-between gap-3"><StatusPill label={run.state} tone={run.state==="UNKNOWN"?"warning":run.state==="COMPLETED"?"success":"neutral"}/><span className="text-xs text-white/50">{new Date(run.created_at).toLocaleString()}</span></div><p className="text-sm">{run.decision.explanation}</p><p className="text-xs text-white/60">Deposit {display(run.decision.depositMinor)} · withdraw {display(run.decision.withdrawMinor)} · return {display(run.decision.transferMinor)}</p>{run.failure&&<p className="text-xs text-[#ffd27f]">{run.failure.replaceAll("_"," ")}</p>}{status.steps.filter(step=>step.run_id===run.id).map(step=><p className="break-all text-xs text-white/60" key={step.id}>{step.stage} · {step.state}{step.tx_hash&&<> · <a className="text-[#9ec5f4] underline" href={"https://testnet.arcscan.app/tx/"+step.tx_hash} target="_blank" rel="noreferrer">ArcScan receipt</a></>}{step.circle_transaction_id&&<> · Circle {step.circle_transaction_id}</>}</p>)}</article>):<p className="p-5 text-sm text-white/60">No runs yet. Fund your agent and confirm a mandate to start.</p>}</div></SectionCard>
      {unknownStep && <SectionCard className="mt-6"><SectionHeading index="05" title="Recover an uncertain submission" description="Paste the hash for the displayed step. Exact sender, calldata and receipt must match; no funds are resent."/><form className="space-y-3 p-5" onSubmit={e=>{e.preventDefault();void act(async()=>{await post("recover",{stepId:unknownStep.id,txHash:candidate});});}}><p className="break-all text-xs text-white/60">Step {unknownStep.id}</p><label className="text-xs">Transaction hash<input className={inputClass} value={candidate} onChange={e=>setCandidate(e.target.value)} pattern="0x[0-9a-fA-F]{64}" required/></label><button className={buttonClass.ghost} disabled={disabled}>Verify transaction</button></form></SectionCard>}
    </PageBody>
  </>;
}
