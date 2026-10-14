// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from "viem";
import { createLiveStarterWorkspace } from "@/lib/treasury/starter";
const owner="0x00000000000000000000000000000000000000aa", agent="0x00000000000000000000000000000000000000bb";
const vault="0x00000000000000000000000000000000000000dd";
const m=vi.hoisted(()=>({rpc:vi.fn(),wallet:null as unknown,mandate:null as unknown,open:null as unknown,holdings:0n,start:vi.fn(),create:vi.fn(),upserts:[] as unknown[],balance:50_000_000n,rpcDown:false,receipt:vi.fn(),agentPosition:0n,agentCash:0n,investCalls:vi.fn(),fundingStatus:vi.fn(),ownerAction:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/earn/server-context",()=>({earnServerContext:async()=>{const workspace=createLiveStarterWorkspace();workspace.policy.enabledStrategies.MORPHO=true;workspace.policy.strategyCapsBps.MORPHO=4000;
  const client={auth:{getClaims:async()=>({data:{claims:{session_id:"session"}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{revision:7},error:null})})})})};
  return {client,userId:"user",wallet:{address:owner,provider:"INJECTED_RABBY"},workspace};}}));
vi.mock("@/lib/execution/live-readiness",()=>({assertWalletOwnership:async()=>undefined,reserveLiveUsage:async()=>undefined}));
vi.mock("@/lib/earn/live-controls",()=>({liveControls:async()=>new Map([["EXECUTION",true],["AGENT",true]])}));
vi.mock("./access",()=>({agentAccess:()=>({allowed:true,open:true,mode:"TESTNET_LIVE"})}));
vi.mock("./circle",()=>({agentCircle:()=>({createWalletSet:async()=>({data:{walletSet:{id:"00000000-0000-4000-8000-000000000002"}}})})}));
vi.mock("./wallets",()=>({agentIdempotencyKey:()=>"key",createAgentWallet:m.create}));
vi.mock("./inputs",()=>({agentInputs:vi.fn(),agentHoldings:async()=>m.agentCash}));
vi.mock("./runner",()=>({advanceAgentRun:vi.fn(),startAgentRun:m.start}));
vi.mock("@/lib/earn/gateway",()=>({arcClient:{getGasPrice:async()=>15_000_000_000n,readContract:async()=>{if(m.rpcDown)throw new Error("Request exceeds defined limit");return m.balance;},estimateGas:async()=>49_338n,getTransactionReceipt:m.receipt},discoverAllowedVaults:async()=>[{address:"0xaabbef1d3971c710276ed41ec791bbe14cdb8e88"}],getEarnPosition:async()=>({currentBalance:{currency:"USDC",decimals:6,minorUnits:m.agentPosition.toString()}})}));
vi.mock("./vault-http",()=>({vaultInvestCalls:m.investCalls,vaultFundingStatus:m.fundingStatus,vaultOwnerAction:m.ownerAction,vaultView:async()=>({vault:null,balances:null,bills:[],needsYou:[]})}));
vi.mock("./store",()=>({
  agentDb:()=>({rpc:m.rpc,from:()=>({upsert:async(row:unknown)=>{m.upserts.push(row);m.wallet={...(row as object)};return {error:null};}})}),
  loadWallet:async()=>m.wallet,loadMandate:async()=>m.mandate,openRun:async()=>m.open,
}));
import { agentHttp } from "./http";
const post=(action:"invest"|"funding"|"return-all"|"mandate"|"vault",body:unknown)=>agentHttp(new Request("https://app.hoddfinance.xyz/api/autopilot/"+action,{method:"POST",headers:{origin:"https://app.hoddfinance.xyz","content-type":"application/json"},body:JSON.stringify(body)}),action);
const reviewed=()=>m.rpc.mock.calls.find(([name])=>name==="hodd_agent_review")?.[1] as {p_mandate:Record<string,unknown>;p_kind:string;p_mandate_revision:number;p_workspace_revision:number};
beforeEach(()=>{
  vi.clearAllMocks();m.upserts=[];m.open=null;m.holdings=0n;m.balance=50_000_000n;m.rpcDown=false;
  m.wallet={user_id:"user",circle_wallet_id:"00000000-0000-4000-8000-000000000001",wallet_set_id:"00000000-0000-4000-8000-000000000002",address:agent,owner_address:owner,account_type:"EOA"};
  m.mandate={mandate:{budgetMinor:"50000000",reserveMinor:"5000000",maxPerRunMinor:"10000000",maxMorphoBps:4000,enabled:false,paused:true},revision:11,spent_minor:"14892",return_requested:false};
  m.rpc.mockImplementation(async(name:string,args:{p_kind?:string})=>({data:name==="hodd_confirm_agent_review"?args.p_kind:null,error:null}));
  m.start.mockResolvedValue({id:"run",state:"RUNNING"});m.agentPosition=0n;m.agentCash=0n;
  const call=(kind:string,to:string,amountMinor="0")=>({kind,call:{to,data:"0x",value:"0"},gasBudgetWei:"1776180000000000",gasCeiling:{gasLimit:"59206",gasPriceWei:"30000000000"},amountMinor});
  m.investCalls.mockImplementation(async(_wallet:unknown,amount:bigint)=>({vaultAddress:vault,holdingsMinor:m.holdings,fund:call("FUND","0x3600000000000000000000000000000000000000",amount.toString()),calls:[call("CREATE_VAULT","0x311578B21F269ca0E45f5c16324A3E51f69ce389"),call("AGENT_GAS","0x3600000000000000000000000000000000000000","500000"),call("FUND","0x3600000000000000000000000000000000000000",amount.toString())]}));
  m.fundingStatus.mockResolvedValue({status:"UNRELATED"});
});
describe("one-click invest",()=>{
  it("confirms an enabled mandate covering what the vault holds plus the amount and returns the owner's vault calls in order",async()=>{
    m.holdings=19_986_487n;
    const response=await post("invest",{amountMinor:"10000000"});const body=await response.json();
    expect(response.status).toBe(200);
    expect(reviewed()).toMatchObject({p_kind:"MANDATE",p_mandate_revision:11,p_workspace_revision:7,p_mandate:{budgetMinor:"30001379",reserveMinor:"0",maxPerRunMinor:"30001379",maxMorphoBps:4000,enabled:true,paused:false}});
    expect(m.rpc).toHaveBeenCalledWith("hodd_confirm_agent_review",expect.objectContaining({p_kind:"MANDATE",p_session:"session"}));
    expect(body).toMatchObject({mode:"VAULT",vaultAddress:vault,agentAddress:agent});
    expect(body.calls.map((item:{kind:string})=>item.kind)).toEqual(["CREATE_VAULT","AGENT_GAS","FUND"]);
    expect(body.funding).toMatchObject({kind:"FUND",amountMinor:"10000000"});
    expect(m.investCalls).toHaveBeenCalledWith(expect.objectContaining({address:agent}),10_000_000n);
    expect(m.start).not.toHaveBeenCalled();
  });
  it("counts what the custodial agent still holds in the budget; its next run moves it into the vault",async()=>{
    m.agentCash=40_000_000n;m.holdings=2_000_000n;
    const response=await post("invest",{amountMinor:"1000000"});expect(response.status).toBe(200);
    expect(reviewed()).toMatchObject({p_mandate:{budgetMinor:(14_892n+2_000_000n+40_000_000n+1_000_000n).toString()}});
  });
  it("never exceeds the policy's Morpho cap and creates the agent wallet on first use",async()=>{
    m.wallet=null;m.mandate=null;m.create.mockResolvedValue({id:"00000000-0000-4000-8000-000000000003",address:agent});
    const response=await post("invest",{amountMinor:"5000000",maxMorphoBps:9000});
    expect(response.status).toBe(200);expect(m.create).toHaveBeenCalledTimes(1);expect(m.upserts).toHaveLength(1);
    expect(reviewed()).toMatchObject({p_mandate_revision:0,p_mandate:{budgetMinor:"5000000",maxMorphoBps:4000}});
  });
  it("refuses while a run is open, over the testnet budget limit and for malformed amounts, before any review",async()=>{
    m.open={id:"run"};let response=await post("invest",{amountMinor:"1000000"});expect(response.status).toBe(409);expect((await response.json()).code).toBe("AGENT_RUN_OPEN");
    m.open=null;m.holdings=999_000_000n;response=await post("invest",{amountMinor:"2000000"});expect(response.status).toBe(400);expect((await response.json()).code).toBe("AGENT_BUDGET_LIMIT");m.holdings=0n;
    for(const amountMinor of ["0","1.5","-1"]){response=await post("invest",{amountMinor});expect(response.status).toBe(400);}
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("refuses an agent bound to another owner wallet",async()=>{
    m.wallet={...(m.wallet as object),owner_address:"0x00000000000000000000000000000000000000cc"};
    const response=await post("invest",{amountMinor:"1000000"});expect(response.status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();
  });
});
describe("funding checks before anything changes",()=>{
  it("refuses an amount the owner's Arc balance cannot cover, without touching the mandate",async()=>{
    const { EarnAccessError } = await import("@/lib/earn/security");
    m.investCalls.mockRejectedValueOnce(new EarnAccessError("AGENT_FUNDS_INSUFFICIENT","Your wallet has 5 USDC on Arc Testnet; this needs about 10.7 USDC including the vault setup and network fees.",400));
    const response=await post("invest",{amountMinor:"10000000"});
    expect(response.status).toBe(400);expect((await response.json()).message).toContain("Your wallet has 5 USDC on Arc Testnet");
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("reports a throttled RPC as retryable and changes nothing",async()=>{
    m.investCalls.mockRejectedValueOnce(new Error("AGENT_FUNDING_UNAVAILABLE"));const response=await post("invest",{amountMinor:"1000000"});
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"AGENT_FUNDING_UNAVAILABLE",message:expect.stringContaining("try again")});expect(m.rpc).not.toHaveBeenCalled();
  });
  it("reports the transfer into the vault, and only falls back to the custodial check for an unrelated one",async()=>{
    const hash="0x"+"c".repeat(64);
    m.fundingStatus.mockResolvedValueOnce({status:"ARRIVED",amountMinor:"10000000"});
    expect(await (await post("funding",{txHash:hash})).json()).toEqual({status:"ARRIVED",amountMinor:"10000000"});
    m.fundingStatus.mockResolvedValueOnce({status:"VAULT_NOT_DEPLOYED",amountMinor:"10000000"});
    expect((await (await post("funding",{txHash:hash})).json()).status).toBe("VAULT_NOT_DEPLOYED");
    expect(m.receipt).not.toHaveBeenCalled();
  });
  it("passes owner-only vault calls through after checking the request",async()=>{
    m.ownerAction.mockResolvedValueOnce({status:"ALREADY"});
    let response=await post("vault",{op:"approve-bill",obligationId:"bill-1"});expect(response.status).toBe(200);expect(await response.json()).toEqual({status:"ALREADY"});
    expect(m.ownerAction).toHaveBeenCalledWith(expect.objectContaining({address:agent}),expect.anything(),{op:"approve-bill",obligationId:"bill-1"});
    response=await post("vault",{op:"pay-anyone",to:owner});expect(response.status).toBe(400);
    m.wallet={...(m.wallet as object),owner_address:"0x00000000000000000000000000000000000000cc"};
    response=await post("vault",{op:"withdraw-all"});expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it("tells the page when the owner's transfer has landed with the agent",async()=>{
    const hash="0x"+"b".repeat(64);
    const transfer=(from:string,to:string,value:bigint)=>({address:"0x3600000000000000000000000000000000000000",topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer",args:{from:from as `0x${string}`,to:to as `0x${string}`}}),data:encodeAbiParameters([{type:"uint256"}],[value])});
    m.receipt.mockRejectedValueOnce(new Error("not found"));expect(await (await post("funding",{txHash:hash})).json()).toEqual({status:"PENDING"});
    m.receipt.mockResolvedValueOnce({status:"reverted",logs:[]});expect((await (await post("funding",{txHash:hash})).json()).status).toBe("REVERTED");
    m.receipt.mockResolvedValueOnce({status:"success",logs:[transfer(owner,"0x00000000000000000000000000000000000000cc",5n)]});expect((await (await post("funding",{txHash:hash})).json()).status).toBe("UNRELATED");
    m.receipt.mockResolvedValueOnce({status:"success",logs:[transfer(owner,agent,10_000_000n)]});expect(await (await post("funding",{txHash:hash})).json()).toEqual({status:"ARRIVED",amountMinor:"10000000"});
    expect((await post("funding",{txHash:"0x12"})).status).toBe(400);
  });
});
describe("one-click return all",()=>{
  it("authorizes a paused return to the verified owner and starts the run in the same request",async()=>{
    const response=await post("return-all",{phase:"now"});
    expect(response.status).toBe(200);expect((await response.json()).run).toEqual({id:"run",state:"RUNNING"});
    expect(reviewed()).toMatchObject({p_kind:"RETURN_ALL",p_mandate:{enabled:false,paused:true,budgetMinor:"50000000"}});
    expect(m.start).toHaveBeenCalledWith("user");
  });
  it("lifts an old budget to the counted spend so a return is never refused",async()=>{
    m.mandate={...(m.mandate as object),spent_minor:"60000000"};
    expect((await post("return-all",{phase:"now"})).status).toBe(200);
    expect(reviewed()).toMatchObject({p_kind:"RETURN_ALL",p_mandate:{budgetMinor:"60000000",maxPerRunMinor:"10000000"}});
  });
  it("reports an unresolved run without starting another",async()=>{
    m.rpc.mockImplementation(async(name:string)=>name==="hodd_confirm_agent_review"?{data:null,error:{message:"agent run unresolved"}}:{data:null,error:null});
    const response=await post("return-all",{phase:"now"});
    expect(response.status).toBe(409);expect((await response.json()).message).toMatch(/still finishing/);expect(m.start).not.toHaveBeenCalled();
  });
  it("keeps one-click starts to return all; a mandate still needs its review",async()=>{
    expect((await post("mandate",{phase:"now"})).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
  });
});
describe("AI advisor",()=>{
  it("has no opt-in: one-click invest writes the mandate without an advisor flag",async()=>{
    m.mandate={mandate:{budgetMinor:"50000000",reserveMinor:"0",maxPerRunMinor:"1000000",maxMorphoBps:4000,enabled:true,paused:false,advisorEnabled:false},revision:4,spent_minor:"0",return_requested:false};
    expect((await post("invest",{amountMinor:"1000000"})).status).toBe(200);
    expect(reviewed().p_mandate).not.toHaveProperty("advisorEnabled");
  });
});
