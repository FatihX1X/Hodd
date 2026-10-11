// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi } from "viem";
const mocks=vi.hoisted(()=>({run:null as unknown,steps:[] as unknown[],inputs:vi.fn(),sdk:vi.fn(),receipt:vi.fn(),tx:vi.fn(),validate:vi.fn(),claim:vi.fn(),events:[] as string[],fresh:null as unknown,decisions:[] as unknown[],decision:{kind:"INVEST",depositMinor:"100",withdrawMinor:"0",transferMinor:"0",remainingBudgetMinor:"1000000",protectedMinor:"0",explanation:"Invest"}}));
vi.mock("server-only",()=>({}));
vi.mock("./inputs",()=>({agentInputs:mocks.inputs}));
vi.mock("./decision",()=>({decideAutopilot:()=>mocks.fresh ?? mocks.decision}));
vi.mock("./quotes",()=>({agentEarnQuote:vi.fn()}));
vi.mock("./circle",()=>({agentAdapter:()=>({getSdk:async()=>({devc:{createContractExecutionTransaction:mocks.sdk}})})}));
vi.mock("./calls",async(original)=>({...(await original<typeof import("./calls")>()),validateAgentEarnCall:mocks.validate}));
vi.mock("@/lib/earn/live-controls",()=>({liveControls:async()=>new Map([["AGENT",true],["EXECUTION",true]])}));
vi.mock("@/lib/earn/capture",()=>({captureNextEarnCall:vi.fn()}));
vi.mock("@/lib/earn/receipts",()=>({verifyApprovalReceipt:vi.fn(),verifyEarnReceipt:vi.fn()}));
vi.mock("@/lib/earn/gateway",()=>({arcClient:{getBlockNumber:async()=>1n,estimateGas:async()=>100n,getGasPrice:async()=>20_000_000_000n,readContract:async({functionName}:{functionName:string})=>functionName==="decimals"?18:1000n,getTransactionReceipt:mocks.receipt,getTransaction:mocks.tx}}));
vi.mock("./store",()=>({
 agentDb:()=>({rpc:mocks.claim,from:(table:string)=>{const query={insert:async(row:unknown)=>{mocks.steps.push(row);return {error:null};},select:()=>query,eq:()=>query,in:()=>query,update:()=>query,order:async()=>({data:mocks.steps,error:null}),single:async()=>({data:table==="agent_runs"?mocks.run:{circle_wallet_id:"circle-wallet",address:"0x0000000000000000000000000000000000000001",owner_address:"0x0000000000000000000000000000000000000002",account_type:"EOA"},error:null}),then:(resolve:(v:unknown)=>void)=>resolve({data:mocks.steps.filter(s=>["SUBMITTED","SUBMITTING","UNKNOWN"].includes((s as {state:string}).state)),error:null})};return query;}}),
 openRun:vi.fn(),
 patchRunDecision:async(run:{decision:unknown})=>{mocks.decisions.push(run.decision);},
 patchRun:async(run:object,state:string,failure:string)=>{mocks.run={...run,state,failure};return mocks.run;},
 patchStep:async(step:{id:string},patch:object)=>{mocks.events.push((patch as {state:string}).state??"HASH");const next={...step,...patch};mocks.steps=mocks.steps.map(s=>(s as {id:string}).id===step.id?next:s);return next;}
}));
import { advanceAgentRun } from "./runner";
import type { AgentRun, AgentStep } from "./store";
const wallet="0x0000000000000000000000000000000000000001";
const target="0x3600000000000000000000000000000000000000";
const hash="0x"+"a".repeat(64);
let run:AgentRun;let step:AgentStep;
beforeEach(()=>{
 vi.clearAllMocks();mocks.events=[];mocks.fresh=null;mocks.decisions=[];
 run={id:"run",user_id:"user",state:"RUNNING",snapshot:{mandateRevision:1,spentMinor:"0",feeReserveMinor:"1000"},decision:mocks.decision as AgentRun["decision"],quote:{operation:"DEPOSIT",expiresAt:new Date(Date.now()+300000).toISOString(),vaultAddress:"0xaabbef1d3971c710276ed41ec791bbe14cdb8e88"} as AgentRun["quote"],return_all:false,created_at:new Date().toISOString(),failure:null};
 step={id:"step",run_id:"run",user_id:"user",state:"PREPARED",stage:"EARN",call:{to:target,data:encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[wallet,100n]}),value:"0"},gas_limit:"1000",gas_price_wei:"20000000000",started_block:"1",circle_transaction_id:null,tx_hash:null,receipt:null,amount_minor:"100"};
 mocks.run=run;mocks.steps=[step];mocks.claim.mockResolvedValue({data:true,error:null});mocks.sdk.mockImplementation(async()=>{mocks.events.push("SDK");return {data:{id:"circle-tx"}};});
 mocks.inputs.mockResolvedValue({wallet:{address:wallet,circle_wallet_id:"circle-wallet",owner_address:"0x0000000000000000000000000000000000000002"},stored:{revision:1,spent_minor:"0",mandate:{budgetMinor:"1000000",enabled:true,paused:false}},workspace:{},ownerPositions:[],agentPosition:{currentBalance:{minorUnits:"0"}},cash:{balance:{minorUnits:"1000000"}},feeReserveMinor:"1000",gasPriceWei:"20000000000"});
 mocks.receipt.mockResolvedValue({status:"success",blockNumber:2n,gasUsed:100n,effectiveGasPrice:20_000_000_000n,logs:[]});
 mocks.tx.mockResolvedValue({from:wallet,to:target,input:step.call.data,value:0n});
});
describe("durable agent runner",()=>{
 it("persists the submission fence before Circle and records its id",async()=>{await advanceAgentRun(run);expect(mocks.events).toEqual(["SUBMITTING","SDK","SUBMITTED"]);expect(mocks.sdk).toHaveBeenCalledTimes(1);expect((mocks.steps[0] as AgentStep).circle_transaction_id).toBe("circle-tx");});
 it("never submits without the processing lease",async()=>{mocks.claim.mockResolvedValue({data:false,error:null});await advanceAgentRun(run);expect(mocks.sdk).not.toHaveBeenCalled();});
 it("retains UNKNOWN after a lost SDK response and never automatically resubmits",async()=>{mocks.sdk.mockRejectedValue(new Error("lost response"));const unknown=await advanceAgentRun(run);expect(unknown.state).toBe("UNKNOWN");await advanceAgentRun(unknown);expect(mocks.sdk).toHaveBeenCalledTimes(1);expect((mocks.steps[0] as AgentStep).state).toBe("UNKNOWN");});
 it("rechecks UNKNOWN by hash and stops at PARTIAL with no new movement",async()=>{run.state="UNKNOWN";step.state="UNKNOWN";step.tx_hash=hash;const result=await advanceAgentRun(run);expect(result.state).toBe("PARTIAL");expect(mocks.sdk).not.toHaveBeenCalled();expect(mocks.receipt).toHaveBeenCalledTimes(1);expect((mocks.steps[0] as AgentStep).receipt?.status).toBe("VERIFIED");});
 it("keeps UNKNOWN for an unrelated receipt",async()=>{run.state="UNKNOWN";step.state="UNKNOWN";step.tx_hash=hash;mocks.tx.mockResolvedValue({from:wallet,to:target,input:"0x",value:0n});expect((await advanceAgentRun(run)).state).toBe("UNKNOWN");expect(mocks.sdk).not.toHaveBeenCalled();});
 it("records exact reverted gas without another transaction",async()=>{step.state="UNKNOWN";step.tx_hash=hash;run.state="UNKNOWN";mocks.receipt.mockResolvedValue({status:"reverted",blockNumber:2n,gasUsed:100n,effectiveGasPrice:20_000_000_000n});expect((await advanceAgentRun(run)).state).toBe("FAILED");expect((mocks.steps[0] as AgentStep).receipt).toMatchObject({status:"REVERTED",feeMinor:"2"});expect(mocks.sdk).not.toHaveBeenCalled();});
 it("status on a closed environment only reads existing receipts",async()=>{await advanceAgentRun(run,false);expect(mocks.sdk).not.toHaveBeenCalled();expect(mocks.validate).not.toHaveBeenCalled();});
 it("refuses an invalid call before the SDK boundary",async()=>{mocks.validate.mockImplementationOnce(()=>{throw new Error("bad call");});expect((await advanceAgentRun(run)).state).toBe("FAILED");expect(mocks.sdk).not.toHaveBeenCalled();});
 it("a fresh pause blocks a prepared step",async()=>{mocks.inputs.mockResolvedValue({...await mocks.inputs(),stored:{revision:2,spent_minor:"0",mandate:{enabled:false,paused:true}}});expect((await advanceAgentRun(run)).state).toBe("PARTIAL");expect(mocks.sdk).not.toHaveBeenCalled();});
});
describe("one-run return all",()=>{
 const owner="0x0000000000000000000000000000000000000002";
 const verified=(stage:AgentStep["stage"],id:string):AgentStep=>({...step,id,stage,state:"VERIFIED",tx_hash:"0x"+id.padEnd(64,"0"),receipt:{status:"VERIFIED"}});
 beforeEach(()=>{run.return_all=true;run.decision={...run.decision,kind:"RETURN_ALL",depositMinor:"0",withdrawMinor:"7969328",transferMinor:"0"};run.quote={...run.quote!,operation:"WITHDRAW"};mocks.fresh={...run.decision,withdrawMinor:"0",transferMinor:"19900000"};});
 it("continues from the verified withdrawal into one transfer of all cash minus that transfer's own gas",async()=>{
  mocks.steps=[verified("APPROVAL","1"),verified("EARN","2")];
  mocks.inputs.mockResolvedValue({...await mocks.inputs(),cash:{balance:{minorUnits:"19986487"}}});
  const result=await advanceAgentRun(run);
  expect(result.state).toBe("RUNNING");expect(mocks.sdk).toHaveBeenCalledTimes(1);
  const sent=mocks.sdk.mock.calls[0][0] as {contractAddress:string;callData:`0x${string}`};
  expect(sent.contractAddress).toBe(target);
  // 120 gas x 20 gwei = 0.0000024 USDC, rounded up to 3 units: everything else goes to the owner.
  expect(decodeFunctionData({abi:erc20Abi,data:sent.callData}).args).toEqual([owner,19986484n]);
  expect(mocks.decisions).toEqual([expect.objectContaining({transferMinor:"19986484"})]);
  expect(mocks.steps.find(s=>(s as AgentStep).stage==="TRANSFER")).toMatchObject({amount_minor:"19986484"});
 });
 it("resumes an UNKNOWN return once its withdrawal verifies, without sending in the same request",async()=>{
  run.state="UNKNOWN";step.state="UNKNOWN";step.tx_hash=hash;mocks.steps=[verified("APPROVAL","1"),step];
  const result=await advanceAgentRun(run);
  expect(result.state).toBe("RUNNING");expect(mocks.sdk).not.toHaveBeenCalled();expect((mocks.steps[1] as AgentStep).state).toBe("VERIFIED");
 });
 it("completes when only the network-fee remainder stays with the agent",async()=>{
  const transfer:AgentStep={...step,id:"3",stage:"TRANSFER",state:"SUBMITTED",tx_hash:hash,amount_minor:"19986484",call:{to:target,data:encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[owner,19986484n]}),value:"0"}};
  mocks.steps=[verified("APPROVAL","1"),verified("EARN","2"),transfer];run.decision={...run.decision,transferMinor:"19986484"};
  mocks.tx.mockResolvedValue({from:wallet,to:target,input:transfer.call.data,value:0n});
  mocks.receipt.mockResolvedValue({status:"success",blockNumber:2n,gasUsed:100n,effectiveGasPrice:20_000_000_000n,logs:[{address:target,topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer",args:{from:wallet,to:owner}}),data:encodeAbiParameters([{type:"uint256"}],[19986484n])}]});
  mocks.inputs.mockResolvedValue({...await mocks.inputs(),cash:{balance:{minorUnits:"1"}}});
  expect((await advanceAgentRun(run)).state).toBe("COMPLETED");expect(mocks.sdk).not.toHaveBeenCalled();
  mocks.inputs.mockResolvedValue({...await mocks.inputs(),cash:{balance:{minorUnits:"5000"}}});run.state="RUNNING";mocks.steps=[verified("APPROVAL","1"),verified("EARN","2"),{...transfer,state:"VERIFIED"}];
  expect((await advanceAgentRun(run))).toMatchObject({state:"PARTIAL",failure:"AGENT_RETURN_HAS_RESIDUAL_ASSETS"});
 });
});
