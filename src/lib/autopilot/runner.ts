import "server-only";
import { randomUUID } from "node:crypto";
import { decodeEventLog, encodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { captureNextEarnCall } from "@/lib/earn/capture";
import { type EarnCall } from "@/lib/earn/router";
import { isAllowedVault, ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { verifyApprovalReceipt, verifyEarnReceipt } from "@/lib/earn/receipts";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { liveControls } from "@/lib/earn/live-controls";
import { agentAdapter } from "./circle";
import { assertAgentDestination } from "./destination";
import { decideAutopilot } from "./decision";
import { agentInputs } from "./inputs";
import { agentEarnQuote } from "./quotes";
import { agentDb, openRun, patchRun, patchStep, type AgentRun, type AgentStep } from "./store";
import { stepAction } from "./state";
import { agentFeeConfig, validateAgentEarnCall } from "./calls";
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const decisionOf=(i: Awaited<ReturnType<typeof agentInputs>>, feeReserveMinor = i.feeReserveMinor) => decideAutopilot({workspace:i.workspace,ownerPositions:i.ownerPositions,agentPosition:i.agentPosition,mandate:i.stored.mandate,cashMinor:i.cash.balance.minorUnits,spentMinor:String(i.stored.spent_minor),feeReserveMinor,returnAll:i.stored.return_requested});
export async function startAgentRun(userId: string) {
  const existing=await openRun(userId); if(existing)return advanceAgentRun(existing);
  const i=await agentInputs(userId); const decision=decisionOf(i); const quote=await agentEarnQuote(i,decision);
  const id=randomUUID();
  const snapshot={workspace:i.workspace,workspaceRevision:i.workspaceRevision,mandate:i.stored.mandate,mandateRevision:i.stored.revision,spentMinor:String(i.stored.spent_minor),cash:i.cash,ownerCash:i.ownerCash,ownerPositions:i.ownerPositions,agentPosition:i.agentPosition,feeReserveMinor:i.feeReserveMinor};
  const {error}=await agentDb().rpc("hodd_start_agent_run",{p_id:id,p_user:userId,p_snapshot:snapshot,p_decision:decision,p_quote:quote,p_return_all:i.stored.return_requested,p_revision:i.stored.revision});
  if(error)throw new Error(/rate limit/i.test(error.message)?"AGENT_RATE_LIMIT":"AGENT_RUN_CHANGED");
  const {data,error:readError}=await agentDb().from("agent_runs").select("*").eq("id",id).single();
  if(readError || !data)throw new Error("AGENT_STATUS_UNAVAILABLE");
  return decision.kind === "NO_ACTION" ? data as AgentRun : advanceAgentRun(data as AgentRun);
}
/** A bounded request advances one step. DB lease and SUBMITTING fence prevent duplicate signing. */
export async function advanceAgentRun(initial: AgentRun, allowSubmission = true): Promise<AgentRun> {
  if(initial.state!=="RUNNING" && initial.state!=="UNKNOWN")return initial;
  const token=randomUUID();const {data:claimed,error}=await agentDb().rpc("hodd_claim_agent_run",{p_id:initial.id,p_token:token});
  if(error)throw new Error("AGENT_LEASE_UNAVAILABLE");if(!claimed)return initial;
  let run=initial;
  try {
    const {data:row,error:rowError}=await agentDb().from("agent_runs").select("*").eq("id",initial.id).single();
    if(rowError || !row)throw new Error("AGENT_STATUS_UNAVAILABLE");run=row as AgentRun;
    const {data:rows,error:stepError}=await agentDb().from("agent_run_steps").select("*").eq("run_id",run.id).order("created_at",{ascending:true});
    if(stepError)throw new Error("AGENT_STATUS_UNAVAILABLE");
    const steps=(rows ?? []) as AgentStep[];
    const pending=steps.find(s=>s.state!=="VERIFIED" && s.state!=="FAILED");
    if(pending && stepAction(pending.state)==="RECHECK")return await settleStep(run,pending);
    if(run.state==="UNKNOWN")return run;
    if(steps.some(s=>s.state==="FAILED"))return await patchRun(run,"FAILED","AGENT_STEP_FAILED");
    if(steps.some(s=>s.state==="VERIFIED" && s.stage!=="APPROVAL"))return await finish(run);
    if(!allowSubmission)return run;
    const controls=await liveControls();
    if(!controls?.get("AGENT") || !controls.get("EXECUTION"))return await patchRun(run,steps.length ? "PARTIAL" : "FAILED","AGENT_PAUSED");
    const i=await agentInputs(run.user_id);
    if(i.stored.revision!==run.snapshot.mandateRevision || (!run.return_all && (!i.stored.mandate.enabled || i.stored.mandate.paused)))return await patchRun(run,steps.length ? "PARTIAL":"FAILED","AGENT_MANDATE_CHANGED");
    const feesSpent=BigInt(i.stored.spent_minor)-BigInt(String(run.snapshot.spentMinor));
    const reserveLeft=BigInt(String(run.snapshot.feeReserveMinor))-feesSpent;
    if(reserveLeft<=0n)throw new Error("AGENT_FEE_RESERVE_EXHAUSTED");
    const fresh=decisionOf(i,reserveLeft.toString());
    if(fresh.kind!==run.decision.kind || ["depositMinor","withdrawMinor","transferMinor"].some(key=>BigInt(fresh[key as "depositMinor"])<BigInt(run.decision[key as "depositMinor"])))return await patchRun(run,steps.length ? "PARTIAL":"FAILED","AGENT_FRESH_POLICY_BLOCKED");
    const step=pending ?? await prepareStep(run,i,steps);
    if(step.stage!=="TRANSFER") {
      if(!run.quote?.expiresAt || Date.parse(run.quote.expiresAt)<=Date.now())return await patchRun(run,steps.length ? "PARTIAL":"FAILED","AGENT_QUOTE_EXPIRED");
      validateAgentEarnCall(step.call,run.quote,i.wallet.address,await shares(i.wallet.address,run.quote.vaultAddress),await shareDecimals(run.quote.vaultAddress));
    } else assertAgentDestination({token:step.call.to,destination:i.wallet.owner_address,verifiedOwner:i.wallet.owner_address,boundOwner:i.wallet.owner_address,chainId:5042002});
    const fee=BigInt(step.gas_limit)*BigInt(step.gas_price_wei);
    const [gas,price]=await Promise.all([arcClient.estimateGas({account:getAddress(i.wallet.address),to:step.call.to,data:step.call.data,value:0n}),arcClient.getGasPrice()]);
    const debit=BigInt(step.stage==="TRANSFER"?run.decision.transferMinor:step.stage==="EARN" && run.quote?.operation==="DEPOSIT"?run.decision.depositMinor:"0") + BigInt(nativeWeiToUsdcCeil(fee.toString()).minorUnits);
    const remaining=BigInt(i.stored.mandate.budgetMinor)-BigInt(i.stored.spent_minor);
    if(BigInt(nativeWeiToUsdcCeil(fee.toString()).minorUnits)>reserveLeft || gas>BigInt(step.gas_limit) || price>BigInt(step.gas_price_wei) || debit>BigInt(i.cash.balance.minorUnits) || debit>remaining)throw new Error("AGENT_SIGNING_LIMIT_EXCEEDED");
    const current=await liveControls();if(!current?.get("AGENT") || !current.get("EXECUTION"))throw new Error("AGENT_PAUSED");
    const fence=await patchStep(step,{state:"SUBMITTING"});
    try {
      const {devc}=await agentAdapter().getSdk();
      const priority=await Promise.resolve().then(()=>arcClient.estimateMaxPriorityFeePerGas()).catch(()=>2_000_000_000n);
      const result=await devc.createContractExecutionTransaction({walletId:i.wallet.circle_wallet_id,contractAddress:fence.call.to,callData:fence.call.data,amount:"0",idempotencyKey:fence.id,refId:fence.id,fee:agentFeeConfig(fence.gas_limit,BigInt(fence.gas_price_wei),priority)});
      if(!result.data?.id)throw new Error("AGENT_SUBMISSION_UNRESOLVED");
      await patchStep(fence,{state:"SUBMITTED",circle_transaction_id:result.data.id});
      return run;
    } catch {
      await patchStep(fence,{state:"UNKNOWN"}).catch(()=>undefined);
      return await patchRun(run,"UNKNOWN","AGENT_SUBMISSION_UNRESOLVED");
    }
  } catch {
    const {data:uncertain,error:readError}=await agentDb().from("agent_run_steps").select("id,state").eq("run_id",run.id).in("state",["SUBMITTING","SUBMITTED","UNKNOWN"]);
    return await patchRun(run,readError || uncertain?.length ? "UNKNOWN":"FAILED","AGENT_RUN_REQUIRES_REVIEW");
  } finally {
    await agentDb().from("agent_runs").update({processing_until:null,processing_token:null}).eq("id",run.id).eq("processing_token",token);
  }
}
async function shareDecimals(vault:string) {return arcClient.readContract({address:getAddress(vault),abi:erc20Abi,functionName:"decimals"});}
async function shares(wallet:string,vault:string) {return arcClient.readContract({address:getAddress(vault),abi:erc20Abi,functionName:"balanceOf",args:[getAddress(wallet)]});}
async function prepareStep(run: AgentRun, i: Awaited<ReturnType<typeof agentInputs>>, steps: AgentStep[]) {
  let call:EarnCall;let stage:AgentStep["stage"];let gasLimit:bigint;let gasPrice=BigInt(i.gasPriceWei);
  if(run.decision.transferMinor!=="0") {
    assertAgentDestination({token:ARC_TESTNET_USDC,destination:i.wallet.owner_address,verifiedOwner:i.wallet.owner_address,boundOwner:i.wallet.owner_address,chainId:5042002});
    call={to:ARC_TESTNET_USDC,data:encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[getAddress(i.wallet.owner_address),BigInt(run.decision.transferMinor)]}),value:"0"};stage="TRANSFER";
    gasLimit=(await arcClient.estimateGas({account:getAddress(i.wallet.address),to:call.to,data:call.data,value:0n})*120n+99n)/100n;
  } else {
    if(!run.quote || !isAllowedVault(run.quote.vaultAddress) || !run.quote.expiresAt || Date.parse(run.quote.expiresAt)<=Date.now())throw new Error("AGENT_QUOTE_EXPIRED");
    const captured=await captureNextEarnCall(run.quote,i.wallet.address);call=captured.call;stage=captured.stage;
    if(stage==="APPROVAL" && steps.some(s=>s.stage==="APPROVAL"))throw new Error("AGENT_APPROVAL_NOT_OBSERVED");
    validateAgentEarnCall(call,run.quote,i.wallet.address,await shares(i.wallet.address,run.quote.vaultAddress),await shareDecimals(run.quote.vaultAddress));
    const fee=run.quote.gasFees.find(f=>stage==="APPROVAL" ? /^approv/i.test(f.name) : /deposit|withdraw/i.test(f.name));
    if(!fee?.gasLimit || !fee.maxGasPriceWei)throw new Error("AGENT_GAS_UNAVAILABLE");gasLimit=BigInt(fee.gasLimit);gasPrice=BigInt(fee.maxGasPriceWei);
  }
  if(BigInt(nativeWeiToUsdcCeil((gasLimit*gasPrice).toString()).minorUnits)>BigInt(i.feeReserveMinor))throw new Error("AGENT_FEE_RESERVE_EXCEEDED");
  const step={id:randomUUID(),run_id:run.id,user_id:run.user_id,state:"PREPARED" as const,stage,call,gas_limit:gasLimit.toString(),gas_price_wei:gasPrice.toString(),started_block:(await arcClient.getBlockNumber()).toString(),amount_minor:stage==="TRANSFER"?run.decision.transferMinor:stage==="EARN"?run.quote!.amount.minorUnits:"0",circle_transaction_id:null,tx_hash:null,receipt:null};
  const {error}=await agentDb().from("agent_run_steps").insert(step);if(error)throw new Error("AGENT_STEP_STORE_UNAVAILABLE");return step;
}
async function settleStep(run: AgentRun, initial: AgentStep): Promise<AgentRun> {
  let step=initial;
  try {
    const {data:wallet,error}=await agentDb().from("agent_wallets").select("*").eq("user_id",run.user_id).single();if(error || !wallet || wallet.account_type!=="EOA")throw new Error();
    if(!step.tx_hash && step.circle_transaction_id) {
      const {devc}=await agentAdapter().getSdk(); const tx=(await devc.getTransaction({id:step.circle_transaction_id})).data?.transaction;
      if(!tx || tx.walletId!==wallet.circle_wallet_id || tx.blockchain!=="ARC-TESTNET" || tx.refId!==step.id)throw new Error();
      if(tx.txHash && /^0x[0-9a-fA-F]{64}$/.test(tx.txHash))step=await patchStep(step,{tx_hash:tx.txHash.toLowerCase()});
      else if(["FAILED","DENIED","CANCELLED"].includes(tx.state)) {
        await patchStep(step,{state:"FAILED",receipt:{providerState:tx.state}});return await patchRun(run,"FAILED","AGENT_PROVIDER_FAILED");
      } else return run;
    }
    if(!step.tx_hash)return await patchRun(run,"UNKNOWN","AGENT_SUBMISSION_UNRESOLVED");
    const hash=step.tx_hash as Hex;
    let receipt;try{receipt=await arcClient.getTransactionReceipt({hash});}catch{return run;}
    if(receipt.blockNumber<=BigInt(step.started_block))throw new Error();
    const transaction=await arcClient.getTransaction({hash});
    if(!same(transaction.from,wallet.address) || !transaction.to || !same(transaction.to,step.call.to) || !same(transaction.input,step.call.data) || transaction.value!==0n)throw new Error();
    const feeMinor=nativeWeiToUsdcCeil((receipt.gasUsed*receipt.effectiveGasPrice).toString()).minorUnits;
    if(receipt.status==="reverted") {
      await patchStep(step,{state:"VERIFIED",receipt:{status:"REVERTED",blockNumber:receipt.blockNumber.toString(),feeMinor}});
      return await patchRun(run,"FAILED","AGENT_RECEIPT_REVERTED");
    }
    if(step.stage==="APPROVAL")verifyApprovalReceipt(receipt,{to:step.call.to,data:step.call.data,value:0n},wallet.address);
    else if(step.stage==="EARN") {if(!run.quote)throw new Error();verifyEarnReceipt(receipt,run.quote);}
    else {
      assertAgentDestination({token:step.call.to,destination:wallet.owner_address,verifiedOwner:wallet.owner_address,boundOwner:wallet.owner_address,chainId:5042002});
      const exact=receipt.logs.some(log=>{if(!same(log.address,ARC_TESTNET_USDC))return false;try{const e=decodeEventLog({abi:erc20Abi,data:log.data,topics:log.topics});return e.eventName==="Transfer" && same(e.args.from,wallet.address) && same(e.args.to,wallet.owner_address) && e.args.value===BigInt(step.amount_minor);}catch{return false;}});if(!exact)throw new Error();
    }
    await patchStep(step,{state:"VERIFIED",receipt:{status:"VERIFIED",blockNumber:receipt.blockNumber.toString(),feeMinor,gasUsed:receipt.gasUsed.toString(),gasPriceWei:receipt.effectiveGasPrice.toString()}});
    if(run.state==="UNKNOWN")return await patchRun(run,"PARTIAL","AGENT_RECOVERED_REVIEW_BEFORE_NEXT_RUN");
    if(step.stage==="APPROVAL")return run;
    return finish(run);
  } catch {
    if(step.state!=="UNKNOWN")await patchStep(step,{state:"UNKNOWN"}).catch(()=>undefined);
    return patchRun(run,"UNKNOWN","AGENT_RECEIPT_NOT_VERIFIED");
  }
}
async function finish(run: AgentRun) {
  let i;try{i=await agentInputs(run.user_id);}catch{return patchRun(run,"PARTIAL","AGENT_FINAL_BALANCE_UNAVAILABLE");}
  const stillReturning=run.return_all && (BigInt(i.agentPosition.currentBalance.minorUnits)>0n || BigInt(i.cash.balance.minorUnits)>0n);
  const needsTransfer=run.decision.withdrawMinor!=="0" && (run.decision.kind==="LIQUIDITY_TOP_UP" || run.return_all);
  return patchRun(run,stillReturning || needsTransfer ? "PARTIAL":"COMPLETED",stillReturning ? "AGENT_RETURN_HAS_RESIDUAL_ASSETS":null);
}
