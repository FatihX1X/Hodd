import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { earnServerContext } from "@/lib/earn/server-context";
import { assertWalletOwnership, reserveLiveUsage } from "@/lib/execution/live-readiness";
import { EarnAccessError } from "@/lib/earn/security";
import { liveControls } from "@/lib/earn/live-controls";
import { agentAccess } from "./access";
import { agentCircle } from "./circle";
import { createAgentWallet, agentIdempotencyKey } from "./wallets";
import { validateMandate } from "./models";
import { agentDb, loadWallet, loadMandate, openRun } from "./store";
import { agentInputs } from "./inputs";
import { advanceAgentRun, startAgentRun } from "./runner";
const headers={"Cache-Control":"no-store"};
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
export async function agentHttp(request:Request,action:"wallet"|"mandate"|"run"|"status"|"return-all"|"pause"|"recover") {
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
      return Response.json({status:"READY",mode:gate.mode,executionEnabled:gate.open,wallet,mandate:stored?.mandate ?? null,spentMinor:stored?String(stored.spent_minor):"0",returnRequested:stored?.return_requested ?? false,balances,balanceError,runs:runs ?? [],steps:steps ?? []},{headers});
    }
    const body=await request.json();
    if(action==="wallet") {
      z.object({}).strict().parse(body);
      await access(request,true);
      await reserveLiveUsage(c.client,mode,"CIRCLE_SESSION");
      const existing=await loadWallet(c.userId);
      if(existing) {
        if(existing.owner_address!==c.wallet.address.toLowerCase())throw new Error("AGENT_OWNER_WALLET_CHANGED");
        return Response.json({status:"READY",wallet:existing},{headers});
      }
      const circle=agentCircle();
      // Env is server-only. Otherwise a deterministic wallet-set creation key survives lost responses.
      const walletSetId=process.env.CIRCLE_AGENT_WALLET_SET_ID?.trim() || (await circle.createWalletSet({name:"Hodd Autopilot Testnet",idempotencyKey:agentIdempotencyKey("wallet-set","hodd-autopilot-testnet")})).data?.walletSet?.id;
      if(!walletSetId)throw new Error("AGENT_WALLET_SET_UNAVAILABLE");
      const wallet=await createAgentWallet(circle,c.userId,walletSetId,"EOA");
      const stored={user_id:c.userId,circle_wallet_id:wallet.id,wallet_set_id:walletSetId,address:wallet.address.toLowerCase(),owner_address:c.wallet.address.toLowerCase(),account_type:"EOA"};
      const {error}=await agentDb().from("agent_wallets").upsert(stored,{onConflict:"user_id",ignoreDuplicates:true});if(error)throw new Error("AGENT_WALLET_STORE_UNAVAILABLE");
      return Response.json({status:"READY",wallet:await loadWallet(c.userId)},{headers});
    }
    if(action==="pause") {
      z.object({}).strict().parse(body);const {error}=await agentDb().rpc("hodd_pause_agent",{p_user:c.userId});if(error)throw new Error("AGENT_PAUSE_UNAVAILABLE");
      return Response.json({status:"PAUSED"},{headers});
    }
    if(action==="mandate" || action==="return-all") {
      const input=z.discriminatedUnion("phase",[z.object({phase:z.literal("review"),mandate:z.unknown().optional()}).strict(),z.object({phase:z.literal("confirm"),reviewId:z.string().uuid(),confirmed:z.literal(true)}).strict()]).parse(body);
      await reserveLiveUsage(c.client,mode,"QUOTE");
      if(input.phase==="review") {
        const wallet=await loadWallet(c.userId),current=await loadMandate(c.userId);
        if(!wallet || wallet.owner_address!==c.wallet.address.toLowerCase())throw new Error("AGENT_SETUP_REQUIRED");
        const mandate=validateMandate(action==="return-all" ? {...current?.mandate,maxMorphoBps:c.workspace.policy.enabledStrategies.MORPHO?Math.min(current?.mandate.maxMorphoBps ?? 0,c.workspace.policy.strategyCapsBps.MORPHO):0,paused:true,enabled:false} : input.mandate,c.workspace.policy);
        const {data:row,error}=await c.client.from("treasury_workspaces").select("revision").eq("user_id",c.userId).single();if(error)throw new Error("AGENT_WORKSPACE_UNAVAILABLE");
        const reviewId=randomUUID();const {error:reviewError}=await agentDb().rpc("hodd_agent_review",{p_id:reviewId,p_user:c.userId,p_session:c.sessionId,p_workspace_revision:row.revision,p_mandate_revision:current?.revision ?? 0,p_owner:wallet.owner_address,p_mandate:mandate,p_kind:action==="return-all"?"RETURN_ALL":"MANDATE"});
        if(reviewError)throw new Error("AGENT_REVIEW_UNAVAILABLE");
        return Response.json({status:"REVIEW",reviewId,mandate,network:"Arc Testnet (5042002)",token: "0x3600000000000000000000000000000000000000",destination:wallet.owner_address,agentAddress:wallet.address,explanation:action==="return-all"?"Pause the mandate. Redeem and return available USDC in capped runs; fees, low liquidity or budget exhaustion can leave residual funds.":"Authorize server signing from this separate Circle wallet within these limits. Funding is a separate transfer you sign."},{headers});
      }
      const {data:kind,error}=await agentDb().rpc("hodd_confirm_agent_review",{p_id:input.reviewId,p_user:c.userId,p_session:c.sessionId,p_kind:action==="return-all"?"RETURN_ALL":"MANDATE"});if(error || kind!==(action==="return-all"?"RETURN_ALL":"MANDATE"))throw new Error("AGENT_REVIEW_CHANGED");
      return Response.json({status:"CONFIRMED",runRequired:kind==="RETURN_ALL"},{headers});
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
    const status=known?error.status:code==="AGENT_RATE_LIMIT"?429:code==="INVALID_REQUEST"?400:503;
    return Response.json({status:"ERROR",code,message:known?error.message:code==="AGENT_SCHEMA_UNAVAILABLE"?"Autopilot is not provisioned. Its local migration has not been applied.":code==="AGENT_RATE_LIMIT"?"Autopilot starts at most one run every 5 minutes. Nothing was sent; try Run now again shortly.":"Autopilot cannot safely complete this request. Check existing runs before trying again."},{status,headers});
  }
}
export async function agentCron(request:Request) {
  try {
    const secret=process.env.CRON_SECRET;const supplied=request.headers.get("authorization") ?? "";const expected="Bearer "+secret;
    if(!secret || Buffer.byteLength(supplied)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return Response.json({status:"ERROR"},{status:401,headers});
    await access(request,true,true);
    const {data,error}=await agentDb().from("agent_mandates").select("user_id,mandate").eq("mandate->>enabled","true").eq("mandate->>paused","false").order("updated_at",{ascending:true}).limit(5);if(error)throw new Error();
    const results=[];
    for(const row of data ?? []) {
      const {data:last,error:lastError}=await agentDb().from("agent_runs").select("created_at").eq("user_id",row.user_id).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(lastError || last && Date.now()-Date.parse(last.created_at)<5*60_000)continue;
      try{const run=await startAgentRun(row.user_id);results.push({id:run.id,state:run.state});}catch{results.push({state:"FAILED"});}
      if(results.length>=5)break; // bounded Hobby invocation; Run now covers other agents.
    }
    return Response.json({status:"READY",results},{headers});
  } catch {return Response.json({status:"ERROR",code:"AGENT_CRON_UNAVAILABLE"},{status:503,headers});}
}
