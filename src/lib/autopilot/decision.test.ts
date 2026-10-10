// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createLiveStarterWorkspace } from "@/lib/treasury/starter";
import type { EarnPosition } from "@/lib/earn/models";
import { decideAutopilot, money, type DecisionInputs } from "./decision";
import { validateMandate } from "./models";
const now=new Date("2026-10-10T12:00:00Z");
export function inputs(): DecisionInputs {
 const workspace=createLiveStarterWorkspace(now); workspace.liquidUsdc=money(10_000_000n);workspace.totalTreasury=workspace.liquidUsdc;workspace.policy.safetyBuffer=money(0n);
 const position:EarnPosition={walletAddress:"0x0000000000000000000000000000000000000001",vaultAddress:"0xaabbef1d3971c710276ed41ec791bbe14cdb8e88",vaultName:"Morpho",currentBalance:{...money(0n),currency:"USDC",decimals:6},maxWithdrawable:{...money(0n),currency:"USDC",decimals:6},redeemable:{...money(0n),currency:"USDC",decimals:6},liquidityStatus:"READY",shares:"0",apyBps:0,pnl:{status:"UNAVAILABLE",reason:"No history"},observedAt:now.toISOString()};
 return {workspace,ownerPositions:[],agentPosition:position,mandate:{budgetMinor:"50000000",reserveMinor:"5000000",maxPerRunMinor:"20000000",maxMorphoBps:4000,enabled:true,paused:false},cashMinor:"50000000",spentMinor:"0",feeReserveMinor:"100000",now};
}
function setPosition(i:DecisionInputs,value:bigint){i.agentPosition.currentBalance={...money(value),currency:"USDC",decimals:6};i.agentPosition.redeemable=i.agentPosition.currentBalance;i.agentPosition.maxWithdrawable=i.agentPosition.currentBalance;i.agentPosition.shares=value.toString();}
describe("deterministic agent decisions",()=>{
 it("invests only arrived budget after the reserve and fees, within both Morpho caps",()=>{const d=decideAutopilot(inputs());expect(d.kind).toBe("INVEST");expect(d.depositMinor).toBe("19900000");});
 it("sends exactly the protected capital shortfall to the owner",()=>{const i=inputs();i.workspace.policy.safetyBuffer=money(12_000_000n);expect(decideAutopilot(i)).toMatchObject({kind:"LIQUIDITY_TOP_UP",transferMinor:"2000000",depositMinor:"0"});});
 it("withdraws for the shortfall when cash covers fees only",()=>{const i=inputs();i.workspace.policy.safetyBuffer=money(12_000_000n);i.cashMinor="100000";setPosition(i,10_000_000n);expect(decideAutopilot(i)).toMatchObject({kind:"LIQUIDITY_TOP_UP",withdrawMinor:"2100000",transferMinor:"0"});});
 it("refills the agent reserve",()=>{const i=inputs();i.cashMinor="1000000";setPosition(i,10_000_000n);expect(decideAutopilot(i)).toMatchObject({kind:"RESERVE_REFILL",withdrawMinor:"4100000"});});
 it("returns NO_ACTION at the cap or while paused",()=>{const i=inputs();setPosition(i,20_000_000n);expect(decideAutopilot(i).kind).toBe("NO_ACTION");i.mandate.paused=true;expect(decideAutopilot(i).explanation).toContain("paused");});
 it("caps funding, per-run amounts, exhausted budgets and low liquidity",()=>{const i=inputs();i.cashMinor="999000000";i.mandate.maxPerRunMinor="1000000";expect(BigInt(decideAutopilot(i).depositMinor)).toBeLessThanOrEqual(900000n);i.spentMinor=i.mandate.budgetMinor;expect(decideAutopilot(i).kind).toBe("NO_ACTION");i.returnAll=true;expect(decideAutopilot(i).kind).toBe("NO_ACTION");});
 it("does not infer funding from the mandate and refuses stale positions",()=>{const i=inputs();i.cashMinor="0";expect(decideAutopilot(i).kind).toBe("NO_ACTION");i.cashMinor="50000000";i.agentPosition.observedAt=new Date(now.getTime()-60001).toISOString();expect(decideAutopilot(i).kind).toBe("NO_ACTION");});
 it("withdraws and returns while paused even after Morpho is disabled",()=>{const i=inputs();i.mandate.paused=true;i.workspace.policy.enabledStrategies.MORPHO=false;i.returnAll=true;setPosition(i,2_000_000n);expect(decideAutopilot(i)).toMatchObject({kind:"RETURN_ALL",withdrawMinor:"2000000"});setPosition(i,0n);expect(decideAutopilot(i).transferMinor).toBe("19900000");});
 it("uses the horizon, active overdue obligations and minimum coverage",()=>{const i=inputs();i.workspace.obligations=[{id:"bill",title:"Bill",category:"RENT",amount:money(6_000_000n),dueAt:"2026-10-09T00:00:00Z",recipient:null,priority:"HIGH",status:"OVERDUE",description:""}];i.workspace.policy.minimumLiquidityCoverageBps=20000;expect(decideAutopilot(i).transferMinor).toBe("2000000");i.workspace.obligations[0].status="PAID";expect(decideAutopilot(i).kind).toBe("INVEST");});
 it("preserves exact rounding for one-unit budgets",()=>{const i=inputs();i.mandate={...i.mandate,budgetMinor:"1",reserveMinor:"0",maxPerRunMinor:"1"};i.cashMinor="1";i.feeReserveMinor="1";expect(decideAutopilot(i).kind).toBe("NO_ACTION");});
});
describe("mandate validation",()=>{
 it("rejects over-budget/per-run/reserve/policy caps and non-integer input",()=>{const i=inputs();for(const patch of [{budgetMinor:"1000000001"},{budgetMinor:"0"},{reserveMinor:"50000001"},{maxPerRunMinor:"50000001"},{maxPerRunMinor:"0"},{maxMorphoBps:6001},{budgetMinor:"1.5"},{budgetMinor:1},{maxMorphoBps:1.1}])expect(()=>validateMandate({...i.mandate,...patch},i.workspace.policy)).toThrow();});
 it("rejects unknown fields and a disabled Morpho strategy",()=>{const i=inputs();expect(()=>validateMandate({...i.mandate,recipient:"attacker"},i.workspace.policy)).toThrow();i.workspace.policy.enabledStrategies.MORPHO=false;expect(()=>validateMandate(i.mandate,i.workspace.policy)).toThrow();});
});
