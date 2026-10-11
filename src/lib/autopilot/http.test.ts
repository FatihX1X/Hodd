// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi } from "viem";
import { createLiveStarterWorkspace } from "@/lib/treasury/starter";
const owner="0x00000000000000000000000000000000000000aa", agent="0x00000000000000000000000000000000000000bb";
const m=vi.hoisted(()=>({rpc:vi.fn(),wallet:null as unknown,mandate:null as unknown,open:null as unknown,holdings:0n,start:vi.fn(),create:vi.fn(),upserts:[] as unknown[],balance:50_000_000n,rpcDown:false,receipt:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/earn/server-context",()=>({earnServerContext:async()=>{const workspace=createLiveStarterWorkspace();workspace.policy.enabledStrategies.MORPHO=true;workspace.policy.strategyCapsBps.MORPHO=4000;
  const client={auth:{getClaims:async()=>({data:{claims:{session_id:"session"}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{revision:7},error:null})})})})};
  return {client,userId:"user",wallet:{address:owner,provider:"INJECTED_RABBY"},workspace};}}));
vi.mock("@/lib/execution/live-readiness",()=>({assertWalletOwnership:async()=>undefined,reserveLiveUsage:async()=>undefined}));
vi.mock("@/lib/earn/live-controls",()=>({liveControls:async()=>new Map([["EXECUTION",true],["AGENT",true]])}));
vi.mock("./access",()=>({agentAccess:()=>({allowed:true,open:true,mode:"TESTNET_LIVE"})}));
vi.mock("./circle",()=>({agentCircle:()=>({createWalletSet:async()=>({data:{walletSet:{id:"00000000-0000-4000-8000-000000000002"}}})})}));
vi.mock("./wallets",()=>({agentIdempotencyKey:()=>"key",createAgentWallet:m.create}));
vi.mock("./inputs",()=>({agentInputs:vi.fn(),agentHoldings:async()=>m.holdings}));
vi.mock("./runner",()=>({advanceAgentRun:vi.fn(),startAgentRun:m.start}));
vi.mock("@/lib/earn/gateway",()=>({arcClient:{getGasPrice:async()=>15_000_000_000n,readContract:async()=>{if(m.rpcDown)throw new Error("Request exceeds defined limit");return m.balance;},estimateGas:async()=>49_338n,getTransactionReceipt:m.receipt}}));
vi.mock("./store",()=>({
  agentDb:()=>({rpc:m.rpc,from:()=>({upsert:async(row:unknown)=>{m.upserts.push(row);m.wallet={...(row as object)};return {error:null};}})}),
  loadWallet:async()=>m.wallet,loadMandate:async()=>m.mandate,openRun:async()=>m.open,
}));
import { agentHttp } from "./http";
const post=(action:"invest"|"funding"|"return-all"|"mandate",body:unknown)=>agentHttp(new Request("https://app.hoddfinance.xyz/api/autopilot/"+action,{method:"POST",headers:{origin:"https://app.hoddfinance.xyz","content-type":"application/json"},body:JSON.stringify(body)}),action);
const reviewed=()=>m.rpc.mock.calls.find(([name])=>name==="hodd_agent_review")?.[1] as {p_mandate:Record<string,unknown>;p_kind:string;p_mandate_revision:number;p_workspace_revision:number};
beforeEach(()=>{
  vi.clearAllMocks();m.upserts=[];m.open=null;m.holdings=0n;m.balance=50_000_000n;m.rpcDown=false;
  m.wallet={user_id:"user",circle_wallet_id:"00000000-0000-4000-8000-000000000001",wallet_set_id:"00000000-0000-4000-8000-000000000002",address:agent,owner_address:owner,account_type:"EOA"};
  m.mandate={mandate:{budgetMinor:"50000000",reserveMinor:"5000000",maxPerRunMinor:"10000000",maxMorphoBps:4000,enabled:false,paused:true},revision:11,spent_minor:"14892",return_requested:false};
  m.rpc.mockImplementation(async(name:string,args:{p_kind?:string})=>({data:name==="hodd_confirm_agent_review"?args.p_kind:null,error:null}));
  m.start.mockResolvedValue({id:"run",state:"RUNNING"});
});
describe("one-click invest",()=>{
  it("confirms an enabled mandate covering held funds plus the amount and returns the exact funding transfer",async()=>{
    m.holdings=19_986_487n;
    const response=await post("invest",{amountMinor:"10000000"});const body=await response.json();
    expect(response.status).toBe(200);
    expect(reviewed()).toMatchObject({p_kind:"MANDATE",p_mandate_revision:11,p_workspace_revision:7,p_mandate:{budgetMinor:"30001379",reserveMinor:"0",maxPerRunMinor:"30001379",maxMorphoBps:4000,enabled:true,paused:false}});
    expect(m.rpc).toHaveBeenCalledWith("hodd_confirm_agent_review",expect.objectContaining({p_kind:"MANDATE",p_session:"session"}));
    expect(body.funding.call.to).toBe("0x3600000000000000000000000000000000000000");
    expect(decodeFunctionData({abi:erc20Abi,data:body.funding.call.data}).args).toEqual([expect.stringMatching(new RegExp(agent.slice(2),"i")),10_000_000n]);
    // 49,338 gas +20% at 2x the 15 gwei network price: the wallet signs inside this ceiling without its own RPC call.
    expect(body.funding.gasCeiling).toEqual({gasLimit:"59206",gasPriceWei:"30000000000"});expect(body.funding.gasBudgetWei).toBe((59_206n*30_000_000_000n).toString());
    expect(m.start).not.toHaveBeenCalled();
  });
  it("never exceeds the policy's Morpho cap and creates the agent wallet on first use",async()=>{
    m.wallet=null;m.mandate=null;m.create.mockResolvedValue({id:"00000000-0000-4000-8000-000000000003",address:agent});
    const response=await post("invest",{amountMinor:"5000000",maxMorphoBps:9000});
    expect(response.status).toBe(200);expect(m.create).toHaveBeenCalledTimes(1);expect(m.upserts).toHaveLength(1);
    expect(reviewed()).toMatchObject({p_mandate_revision:0,p_mandate:{budgetMinor:"5000000",maxMorphoBps:4000}});
  });
  it("refuses while a run is open, over the testnet budget limit and for malformed amounts, before any review",async()=>{
    m.open={id:"run"};let response=await post("invest",{amountMinor:"1000000"});expect(response.status).toBe(409);expect((await response.json()).code).toBe("AGENT_RUN_OPEN");
    m.open=null;m.holdings=999_000_000n;response=await post("invest",{amountMinor:"2000000"});expect(response.status).toBe(400);expect((await response.json()).code).toBe("AGENT_BUDGET_LIMIT");
    for(const amountMinor of ["0","1.5","-1"]){response=await post("invest",{amountMinor});expect(response.status).toBe(400);}
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("refuses an agent bound to another owner wallet",async()=>{
    m.wallet={...(m.wallet as object),owner_address:"0x00000000000000000000000000000000000000cc"};
    const response=await post("invest",{amountMinor:"1000000"});expect(response.status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();
  });
});
describe("funding checks before anything changes",()=>{
  it("refuses an amount the owner's Arc balance cannot cover with the network fee, without touching the mandate",async()=>{
    m.balance=10_000_000n;let response=await post("invest",{amountMinor:"10000000"});
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"AGENT_FUNDS_INSUFFICIENT",message:expect.stringContaining("Invest at most 9.998223 USDC")});
    m.balance=5_000_000n;response=await post("invest",{amountMinor:"10000000"});
    expect(response.status).toBe(400);expect((await response.json()).message).toContain("Your wallet has 5 USDC on Arc Testnet");
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("reports a throttled RPC as retryable and changes nothing",async()=>{
    m.rpcDown=true;const response=await post("invest",{amountMinor:"1000000"});
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"AGENT_FUNDING_UNAVAILABLE",message:expect.stringContaining("try again")});expect(m.rpc).not.toHaveBeenCalled();
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
