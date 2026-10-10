// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { assertAgentDestination } from "./destination";
import { agentIdempotencyKey, createAgentWallet, type WalletCreator } from "./wallets";
import { agentAccess } from "./access";
import { recoveredRunStatus, stepAction } from "./state";
const owner="0x0000000000000000000000000000000000000001";
describe("agent destination guard",()=>{
 const valid={token:"0x3600000000000000000000000000000000000000",destination:owner,verifiedOwner:owner,boundOwner:owner,chainId:5042002};
 it("allows only canonical USDC to the proven bound owner on Arc Testnet",()=>{expect(()=>assertAgentDestination(valid)).not.toThrow();for(const patch of [{destination:"0x0000000000000000000000000000000000000002"},{verifiedOwner:null},{boundOwner:"0x0000000000000000000000000000000000000002"},{token:owner},{chainId:1}])expect(()=>assertAgentDestination({...valid,...patch})).toThrow();});
});
describe("idempotent agent wallet provisioning",()=>{
 it("uses the same stable UUID-v4 even after a lost response and never switches chain",async()=>{
   const wallets=new Map();const createWallets=vi.fn(async input=>{const key=input.idempotencyKey;const wallet=wallets.get(key) ?? {id:"wallet-id",address:owner,blockchain:"ARC-TESTNET",accountType:"EOA"};wallets.set(key,wallet);return {data:{wallets:[wallet]}};});
   const sdk={createWalletSet:vi.fn(),createWallets} as WalletCreator;
   await createAgentWallet(sdk,"user-a","set","EOA");await createAgentWallet(sdk,"user-a","set","EOA");expect(wallets.size).toBe(1);expect(createWallets.mock.calls[0][0]).toMatchObject({count:1,blockchains:["ARC-TESTNET"],accountType:"EOA"});
   expect(agentIdempotencyKey("wallet","user-a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);expect(agentIdempotencyKey("wallet","user-a")).not.toBe(agentIdempotencyKey("wallet","user-b"));
 });
 it("refuses an unexpected Circle chain/account",async()=>{const sdk={createWalletSet:vi.fn(),createWallets:vi.fn().mockResolvedValue({data:{wallets:[{id:"x",address:owner,blockchain:"ETH",accountType:"EOA"}]}})};await expect(createAgentWallet(sdk,"user","set","EOA")).rejects.toThrow();});
});
describe("environment and kill switches",()=>{
 const request=(host:string)=>new Request("https://"+host+"/api/autopilot/run",{headers:{origin:"https://"+host,"content-type":"application/json"}});
 const controls=new Map([["EXECUTION",true],["AGENT",true]]);
 it("requires loopback next dev and the separate agent opt-in",()=>{expect(agentAccess(request("localhost"),{nodeEnv:"development",localFlag:"true"},controls,true).allowed).toBe(true);for(const c of [null,new Map([["EXECUTION",true]])])expect(agentAccess(request("localhost"),{nodeEnv:"development",localFlag:"true"},c,true).allowed).toBe(false);expect(agentAccess(request("localhost"),{nodeEnv:"development"},controls,true).allowed).toBe(false);});
 it("opens only the live production host and refuses previews, missing origins and unreadable controls",()=>{const env={nodeEnv:"production",vercel:"1",vercelEnv:"production",liveFlag:"true",localFlag:"true"};expect(agentAccess(request("app.hoddfinance.xyz"),env,controls,true).allowed).toBe(true);expect(agentAccess(request("preview.vercel.app"),env,controls,true).allowed).toBe(false);expect(agentAccess(request("app.hoddfinance.xyz"),{...env,vercelEnv:"preview"},controls,true).allowed).toBe(false);expect(agentAccess(new Request("https://app.hoddfinance.xyz/api/autopilot/run"),env,controls,true).allowed).toBe(false);});
});
describe("uncertain run state",()=>{
 it("submits only PREPARED and retains the fence for every uncertain state",()=>{expect(stepAction("PREPARED")).toBe("SUBMIT");for(const state of ["SUBMITTING","SUBMITTED","UNKNOWN"] as const)expect(stepAction(state)).toBe("RECHECK");expect(stepAction("VERIFIED")).toBe("DONE");});
 it("UNKNOWN resolves with proof and requires a review before the next movement",()=>{expect(recoveredRunStatus("UNKNOWN",false,false)).toBe("UNKNOWN");expect(recoveredRunStatus("UNKNOWN",true,false)).toBe("PARTIAL");expect(recoveredRunStatus("UNKNOWN",false,true)).toBe("FAILED");});
});
