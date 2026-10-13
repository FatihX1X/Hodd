import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { earnServerContext } from "@/lib/earn/server-context";
import { assertWalletOwnership, reserveLiveUsage } from "@/lib/execution/live-readiness";
import { EarnAccessError } from "@/lib/earn/security";
import { liveControls } from "@/lib/earn/live-controls";
import { agentAccess } from "./access";
import { agentCircle } from "./circle";
import { decodeEventLog, encodeFunctionData, erc20Abi, formatUnits, getAddress } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { boundedArcGasPrice, bufferedEarnGasLimit } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { createAgentWallet, agentIdempotencyKey } from "./wallets";
import { AGENT_MAX_BUDGET_MINOR, validateMandate, type AgentWallet, type Mandate } from "./models";
import { agentDb, loadWallet, loadMandate, openRun } from "./store";
import { agentHoldings, agentInputs } from "./inputs";
import { advanceAgentRun, startAgentRun } from "./runner";
import { scheduledTrigger, type RunTrigger } from "./triggers";
import { advisorConfigured, groqAdvisorModel } from "./advisor-model";
import { autopilotSecret } from "./secrets";
import { treasuryPolicySchema, treasuryWorkspaceSchema } from "@/lib/treasury/models";
const headers={"Cache-Control":"no-store"};
const messages:Record<string,string>={
  AGENT_SCHEMA_UNAVAILABLE:"Autopilot is not provisioned. Its local migration has not been applied.",
  AGENT_RATE_LIMIT:"Autopilot starts at most one run every 5 minutes. Nothing was sent; it will start shortly.",
  AGENT_RUN_OPEN:"The agent is still finishing its current step. Nothing new was sent; try again in a moment.",
  AGENT_BUDGET_LIMIT:"Autopilot manages at most 1,000 USDC in total on testnet. Choose a smaller amount.",
  AGENT_OWNER_PROOF_REQUIRED:"Verify ownership of your connected wallet on Overview first. Nothing was sent.",
  AGENT_OWNER_WALLET_CHANGED:"Your agent belongs to another of your wallets. Connect that wallet to use it.",
  AGENT_FUNDING_UNAVAILABLE:"Arc Testnet could not check your transfer right now. Nothing was sent or changed; try again in a moment.",
};
const env=()=>({nodeEnv:process.env.NODE_ENV,vercel:process.env.VERCEL,vercelEnv:process.env.VERCEL_ENV,liveFlag:process.env.HODD_TESTNET_LIVE,localFlag:process.env.HODD_AGENT_EXECUTION_ENABLED});
async function access(request:Request, execution:boolean,cron=false) {
  const decision=agentAccess(request,env(),await liveControls(),execution,cron);
  if(!decision.allowed)throw new EarnAccessError(decision.code,decision.message,decision.status);
  return decision;
}
async function context() {
  const c=await earnServerContext();const {data}=await c.client.auth.getClaims();
  if(data?.claims.client_id)throw new EarnAccessError("FIRST_PARTY_REQUIRED","Open Autopilot in Hodd to change its mandate.",403);
  await assertWalletOwnership(c,"TESTNET_LIVE");
  // Circle PIN ownership was checked against the user's Circle wallet list in earnServerContext.
  if(c.wallet.provider==="CIRCLE_USER_CONTROLLED") {
    const {error}=await agentDb().from("wallet_ownership_proofs").upsert({user_id:c.userId,wallet_address:c.wallet.address.toLowerCase(),provider:c.wallet.provider,proof:{method:"CIRCLE_BOUND_WALLET",walletId:c.wallet.walletId},verified_at:new Date().toISOString()});
    if(error)throw new Error("AGENT_OWNER_PROOF_REQUIRED");
  }
  return {...c,sessionId:String(data!.claims.session_id)};
}
type Ctx=Awaited<ReturnType<typeof context>>;
const usdc=(minor:bigint)=>formatUnits(minor>0n?minor:0n,6);
/** The owner's exact USDC transfer to the agent with a server-estimated gas ceiling; refuses before signing when funds are short. */
async function fundingTransfer(owner:`0x${string}`,agent:`0x${string}`,amount:bigint) {
  const call={to:ARC_TESTNET_USDC,data:encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[agent,amount]}),value:"0"};
  const short=(balance:bigint,fee:bigint)=>new EarnAccessError("AGENT_FUNDS_INSUFFICIENT",`Your wallet has ${usdc(balance)} USDC on Arc Testnet. Invest at most ${usdc(balance-fee)} USDC so the network fee is covered. Nothing was sent.`,400);
  let balance:bigint, gas:bigint, price:bigint;
  try { balance=await arcClient.readContract({address:ARC_TESTNET_USDC,abi:erc20Abi,functionName:"balanceOf",args:[owner]}); price=boundedArcGasPrice(await arcClient.getGasPrice()); }
  catch { throw new Error("AGENT_FUNDING_UNAVAILABLE"); }
  if(balance<amount)throw short(balance,nativeWeiToUsdcMinor(60_000n*price));
  try { gas=await arcClient.estimateGas({account:owner,to:ARC_TESTNET_USDC,data:call.data,value:0n}); } catch { throw new Error("AGENT_FUNDING_UNAVAILABLE"); }
  const gasLimit=bufferedEarnGasLimit(gas), fee=nativeWeiToUsdcMinor(gasLimit*price);
  if(balance<amount+fee)throw short(balance,fee);
  return {call,gasBudgetWei:(gasLimit*price).toString(),gasCeiling:{gasLimit:gasLimit.toString(),gasPriceWei:price.toString()},amountMinor:amount.toString()};
}
const nativeWeiToUsdcMinor=(wei:bigint)=>BigInt(nativeWeiToUsdcCeil(wei.toString()).minorUnits);
type Kind="MANDATE"|"RETURN_ALL";
/** Creates the user's agent wallet once; an existing one must belong to the connected owner. */
async function ensureWallet(c:Ctx,mode:"TESTNET_LIVE"|"LOCAL_ENABLED"):Promise<AgentWallet> {
  const existing=await loadWallet(c.userId);
  if(existing) {
    if(existing.owner_address!==c.wallet.address.toLowerCase())throw new Error("AGENT_OWNER_WALLET_CHANGED");
    return existing;
  }
  await reserveLiveUsage(c.client,mode,"CIRCLE_SESSION");
  const circle=agentCircle();
  // Env is server-only. Otherwise a deterministic wallet-set creation key survives lost responses.
  const walletSetId=process.env.CIRCLE_AGENT_WALLET_SET_ID?.trim() || (await circle.createWalletSet({name:"Hodd Autopilot Testnet",idempotencyKey:agentIdempotencyKey("wallet-set","hodd-autopilot-testnet")})).data?.walletSet?.id;
  if(!walletSetId)throw new Error("AGENT_WALLET_SET_UNAVAILABLE");
  const wallet=await createAgentWallet(circle,c.userId,walletSetId,"EOA");
  const stored={user_id:c.userId,circle_wallet_id:wallet.id,wallet_set_id:walletSetId,address:wallet.address.toLowerCase(),owner_address:c.wallet.address.toLowerCase(),account_type:"EOA"};
  const {error}=await agentDb().from("agent_wallets").upsert(stored,{onConflict:"user_id",ignoreDuplicates:true});if(error)throw new Error("AGENT_WALLET_STORE_UNAVAILABLE");
  const created=await loadWallet(c.userId);if(!created)throw new Error("AGENT_WALLET_STORE_UNAVAILABLE");return created;
}
/** Binds exact limits to this session, workspace revision, mandate revision and verified owner. */
async function review(c:Ctx,wallet:AgentWallet,mandateRevision:number,kind:Kind,mandate:Mandate) {
  const {data:row,error}=await c.client.from("treasury_workspaces").select("revision").eq("user_id",c.userId).single();if(error)throw new Error("AGENT_WORKSPACE_UNAVAILABLE");
  const reviewId=randomUUID();const {error:reviewError}=await agentDb().rpc("hodd_agent_review",{p_id:reviewId,p_user:c.userId,p_session:c.sessionId,p_workspace_revision:row.revision,p_mandate_revision:mandateRevision,p_owner:wallet.owner_address,p_mandate:mandate,p_kind:kind});
  if(reviewError)throw new Error("AGENT_REVIEW_UNAVAILABLE");
  return reviewId;
}
async function confirm(c:Ctx,reviewId:string,kind:Kind) {
  const {data,error}=await agentDb().rpc("hodd_confirm_agent_review",{p_id:reviewId,p_user:c.userId,p_session:c.sessionId,p_kind:kind});
  if(error && /run unresolved/i.test(error.message))throw new Error("AGENT_RUN_OPEN");
  if(error || data!==kind)throw new Error("AGENT_REVIEW_CHANGED");
}
export async function agentHttp(request:Request,action:"wallet"|"mandate"|"invest"|"funding"|"run"|"status"|"return-all"|"pause"|"recover") {
  try {
    const read=request.method==="GET";
    // GETs are read-only. Reuse same-origin JSON guards without requiring an Origin on normal navigation reads.
    const gate=await access(read ? new Request(request.url,{headers:{...Object.fromEntries(request.headers),origin:new URL(request.url).origin,"content-type":"application/json"}}) : request,action==="run" || action==="recover");
    const c=await context();
    const mode=gate.mode === "TESTNET_LIVE" ? "TESTNET_LIVE" : "LOCAL_ENABLED";
    if(read) {
      const wallet=await loadWallet(c.userId), stored=await loadMandate(c.userId);
      const {data:runs,error}=await agentDb().from("agent_runs").select("*").eq("user_id",c.userId).order("created_at",{ascending:false}).limit(20);
      if(error)throw new Error("AGENT_SCHEMA_UNAVAILABLE");
      const {data:steps,error:stepError}=await agentDb().from("agent_run_steps").select("id,run_id,stage,state,circle_transaction_id,tx_hash,receipt").eq("user_id",c.userId).order("created_at",{ascending:false}).limit(60);
      if(stepError)throw new Error("AGENT_SCHEMA_UNAVAILABLE");
      let balances=null, balanceError=null;
      if(wallet && stored)try{const i=await agentInputs(c.userId);balances={cashMinor:i.cash.balance.minorUnits,positionMinor:i.agentPosition.currentBalance.minorUnits,redeemableMinor:i.agentPosition.redeemable.minorUnits,observedAt:i.cash.observedAt};}catch{balanceError="Fresh balances are unavailable. Execution stays closed until they can be read.";}
      const policy=c.workspace.policy;
      const [controls,configured]=await Promise.all([liveControls(),advisorConfigured()]);
      return Response.json({status:"READY",mode:gate.mode,executionEnabled:gate.open,advisor:{available:configured && controls?.get("AGENT_ADVISOR")===true,model:configured?groqAdvisorModel():null},wallet,mandate:stored?.mandate ?? null,spentMinor:stored?String(stored.spent_minor):"0",returnRequested:stored?.return_requested ?? false,balances,balanceError,runs:runs ?? [],steps:steps ?? [],policyMorphoCapBps:policy.enabledStrategies.MORPHO?policy.strategyCapsBps.MORPHO:0},{headers});
    }
    const body=await request.json();
    if(action==="wallet") {
      z.object({}).strict().parse(body);
      await access(request,true);
      return Response.json({status:"READY",wallet:await ensureWallet(c,mode)},{headers});
    }
    if(action==="invest") {
      // One click: the agent wallet, an enabled mandate covering this amount and the funding call the owner signs.
      const input=z.object({amountMinor:z.string().regex(/^[1-9]\d{0,15}$/),maxMorphoBps:z.number().int().min(0).max(10_000).optional()}).strict().parse(body);
      await access(request,true);
      await reserveLiveUsage(c.client,mode,"QUOTE");
      const wallet=await ensureWallet(c,mode);
      if(await openRun(c.userId))throw new Error("AGENT_RUN_OPEN");
      const current=await loadMandate(c.userId), policy=c.workspace.policy;
      const cap=policy.enabledStrategies.MORPHO?policy.strategyCapsBps.MORPHO:0;
      // The budget covers what the agent already holds plus this amount; fees and returns already counted stay counted.
      const budget=BigInt(current?.spent_minor ?? "0")+await agentHoldings(wallet.address)+BigInt(input.amountMinor);
      if(budget>AGENT_MAX_BUDGET_MINOR)throw new Error("AGENT_BUDGET_LIMIT");
      const mandate=validateMandate({budgetMinor:budget.toString(),reserveMinor:"0",maxPerRunMinor:budget.toString(),maxMorphoBps:Math.min(input.maxMorphoBps ?? cap,cap),enabled:true,paused:false},policy);
      // Checked before anything changes: the browser never runs its own RPC simulation (public Arc RPC limits
      // and wallet extensions made that fail before the wallet opened). The wallet signs within this exact ceiling.
      const funding=await fundingTransfer(getAddress(c.wallet.address),getAddress(wallet.address),BigInt(input.amountMinor));
      await confirm(c,await review(c,wallet,current?.revision ?? 0,"MANDATE",mandate),"MANDATE");
      return Response.json({status:"READY",agentAddress:wallet.address,mandate,funding},{headers});
    }
    if(action==="funding") {
      // Read-only: did the owner's transfer land with the agent? The page waits on this instead of a browser RPC.
      const input=z.object({txHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/)}).strict().parse(body);
      const wallet=await loadWallet(c.userId);
      if(!wallet || wallet.owner_address!==c.wallet.address.toLowerCase())throw new Error("AGENT_SETUP_REQUIRED");
      let receipt;try{receipt=await arcClient.getTransactionReceipt({hash:input.txHash.toLowerCase() as `0x${string}`});}catch{return Response.json({status:"PENDING"},{headers});}
      if(receipt.status!=="success")return Response.json({status:"REVERTED"},{headers});
      const arrived=receipt.logs.reduce((sum,log)=>{if(log.address.toLowerCase()!==ARC_TESTNET_USDC.toLowerCase())return sum;try{const e=decodeEventLog({abi:erc20Abi,data:log.data,topics:log.topics});return e.eventName==="Transfer" && e.args.from.toLowerCase()===wallet.owner_address && e.args.to.toLowerCase()===wallet.address ? sum+e.args.value : sum;}catch{return sum;}},0n);
      return Response.json({status:arrived>0n?"ARRIVED":"UNRELATED",amountMinor:arrived.toString()},{headers});
    }
    if(action==="pause") {
      z.object({}).strict().parse(body);const {error}=await agentDb().rpc("hodd_pause_agent",{p_user:c.userId});if(error)throw new Error("AGENT_PAUSE_UNAVAILABLE");
      return Response.json({status:"PAUSED"},{headers});
    }
    if(action==="mandate" || action==="return-all") {
      const reviewPhase=z.object({phase:z.literal("review"),mandate:z.unknown().optional()}).strict(), confirmPhase=z.object({phase:z.literal("confirm"),reviewId:z.string().uuid(),confirmed:z.literal(true)}).strict();
      const input=(action==="return-all" ? z.discriminatedUnion("phase",[reviewPhase,confirmPhase,z.object({phase:z.literal("now")}).strict()]) : z.discriminatedUnion("phase",[reviewPhase,confirmPhase])).parse(body);
      const kind:Kind=action==="return-all"?"RETURN_ALL":"MANDATE";
      await reserveLiveUsage(c.client,mode,"QUOTE");
      if(input.phase==="confirm") {await confirm(c,input.reviewId,kind);return Response.json({status:"CONFIRMED",runRequired:kind==="RETURN_ALL"},{headers});}
      const wallet=await loadWallet(c.userId),current=await loadMandate(c.userId);
      if(!wallet || wallet.owner_address!==c.wallet.address.toLowerCase())throw new Error("AGENT_SETUP_REQUIRED");
      // Counted returns can exceed an old budget; the confirmation refuses budget < spent, which must never block a return.
      const spent=BigInt(current?.spent_minor ?? "0"), budget=current ? BigInt(current.mandate.budgetMinor) : 0n;
      const mandate=validateMandate(kind==="RETURN_ALL" ? {...current?.mandate,budgetMinor:(spent>budget && spent<=AGENT_MAX_BUDGET_MINOR ? spent : budget).toString(),maxMorphoBps:c.workspace.policy.enabledStrategies.MORPHO?Math.min(current?.mandate.maxMorphoBps ?? 0,c.workspace.policy.strategyCapsBps.MORPHO):0,paused:true,enabled:false} : input.phase==="review" ? input.mandate : undefined,c.workspace.policy);
      if(input.phase==="now") {
        // One click: the only destination is the verified owner, so authorizing and starting happen together.
        await access(request,true);
        await confirm(c,await review(c,wallet,current?.revision ?? 0,kind,mandate),kind);
        return Response.json({status:"READY",run:await startAgentRun(c.userId)},{headers});
      }
      const reviewId=await review(c,wallet,current?.revision ?? 0,kind,mandate);
      return Response.json({status:"REVIEW",reviewId,mandate,network:"Arc Testnet (5042002)",token: "0x3600000000000000000000000000000000000000",destination:wallet.owner_address,agentAddress:wallet.address,explanation:kind==="RETURN_ALL"?"Pause the mandate. Withdraw the Morpho position and send all agent USDC to your verified wallet in one run; only a network-fee remainder stays.":"Authorize server signing from this separate Circle wallet within these limits. Funding is a separate transfer you sign."},{headers});
    }
    if(action==="recover") {
      const input=z.object({stepId:z.string().uuid(),txHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/)}).strict().parse(body);
      const {error}=await agentDb().from("agent_run_steps").update({tx_hash:input.txHash.toLowerCase()}).eq("id",input.stepId).eq("user_id",c.userId).in("state",["UNKNOWN","SUBMITTING","SUBMITTED"]).is("tx_hash",null);
      if(error)throw new Error("AGENT_RECOVERY_UNAVAILABLE");
      const open=await openRun(c.userId);return Response.json({status:"READY",run:open ? await advanceAgentRun(open) : null},{headers});
    }
    z.object({}).strict().parse(body);
    if(action==="status") {const run=await openRun(c.userId);return Response.json({status:"READY",run:run?await advanceAgentRun(run,gate.open):null},{headers});}
    return Response.json({status:"READY",run:await startAgentRun(c.userId)},{headers});
  } catch(error) {
    const known=error instanceof EarnAccessError;
    const code=known ? error.code : error instanceof z.ZodError ? "INVALID_REQUEST" : error instanceof Error && /^AGENT_[A-Z_]+$/.test(error.message) ? error.message : "AGENT_UNAVAILABLE";
    const status=known?error.status:code==="AGENT_RATE_LIMIT"?429:code==="AGENT_RUN_OPEN"?409:code==="INVALID_REQUEST" || code==="AGENT_BUDGET_LIMIT"?400:code==="AGENT_OWNER_PROOF_REQUIRED" || code==="AGENT_OWNER_WALLET_CHANGED"?403:503;
    return Response.json({status:"ERROR",code,message:known?error.message:messages[code] ?? "Autopilot cannot safely complete this request. Check existing runs before trying again."},{status,headers});
  }
}
/** A bearer secret compared in constant time. */
function bearerMatches(request:Request,secret:string|undefined) {
  if(!secret)return false;
  const supplied=request.headers.get("authorization") ?? "", expected="Bearer "+secret;
  return Buffer.byteLength(supplied)===Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
}
/**
 * The scheduler tick (Vercel cron daily, the Supabase scheduler hourly). A run starts only for agents that are due:
 * six hours since the last run, a changed treasury policy, or a bill entering its protection window or falling due
 * (see triggers.ts). Bounded per invocation; the next tick picks up the rest.
 */
export async function agentCron(request:Request) {
  try {
    if(!bearerMatches(request,process.env.CRON_SECRET) && !bearerMatches(request,(await autopilotSecret("autopilot_scheduler_secret")) ?? undefined))return Response.json({status:"ERROR"},{status:401,headers});
    await access(request,true,true);
    const {data,error}=await agentDb().from("agent_mandates").select("user_id,mandate").eq("mandate->>enabled","true").eq("mandate->>paused","false").order("updated_at",{ascending:true}).limit(50);if(error)throw new Error();
    const results:{trigger:RunTrigger;id?:string;state:string}[]=[];const now=new Date();
    for(const row of data ?? []) {
      const [last,stored]=await Promise.all([
        agentDb().from("agent_runs").select("created_at,policy:snapshot->workspace->policy").eq("user_id",row.user_id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
        agentDb().from("treasury_workspaces").select("workspace").eq("user_id",row.user_id).maybeSingle(),
      ]);
      if(last.error || stored.error || !stored.data)continue;
      const workspace=treasuryWorkspaceSchema.safeParse(stored.data.workspace);if(!workspace.success)continue;
      const lastRun=last.data as {created_at:string;policy:unknown}|null;
      const lastPolicy=lastRun?.policy ? treasuryPolicySchema.safeParse(lastRun.policy) : null;
      const trigger=scheduledTrigger({now,lastRunAt:lastRun?new Date(lastRun.created_at):null,lastPolicy:lastPolicy?.success?lastPolicy.data:null,workspace:workspace.data});
      if(!trigger)continue;
      try{const run=await startAgentRun(row.user_id,trigger);results.push({trigger,id:run.id,state:run.state});}catch{results.push({trigger,state:"FAILED"});}
      if(results.length>=5)break; // bounded Hobby invocation; the next tick continues.
    }
    return Response.json({status:"READY",results},{headers});
  } catch {return Response.json({status:"ERROR",code:"AGENT_CRON_UNAVAILABLE"},{status:503,headers});}
}
