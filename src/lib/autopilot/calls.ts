import { decodeFunctionData, formatUnits, parseAbi, parseUnits } from "viem";
import { EARN_EXECUTE_ABI, validateEarnCall, type EarnCall } from "@/lib/earn/router";
import type { EarnQuote } from "@/lib/earn/models";
const vaultAbi=parseAbi(["function deposit(uint256 assets,address receiver)","function withdraw(uint256 assets,address receiver,address owner)","function redeem(uint256 shares,address receiver,address owner)"]);
const approvalAbi=parseAbi(["function approve(address spender,uint256 amount)","function increaseAllowance(address spender,uint256 amount)"]);
/** Strengthen the shared router validator to one exact economic instruction. */
export function validateAgentEarnCall(call:EarnCall,quote:EarnQuote,wallet:string,shareBalance:bigint,shareDecimals:number) {
 const checked=validateEarnCall(call,quote,wallet,{shareBalance});
 const expectedShares=quote.sharesToRedeem?parseUnits(quote.sharesToRedeem,shareDecimals):null;
 if(checked.stage==="APPROVAL") {
  const {args}=decodeFunctionData({abi:approvalAbi,data:call.data});
  // Earn Kit approves the whole share balance (+1) for a withdrawal; never more than the wallet owns.
  // The router call below must still withdraw exactly the quoted assets and sweep spare shares back.
  const limit=quote.operation==="DEPOSIT"?BigInt(quote.amount.minorUnits):expectedShares===null?null:(shareBalance>expectedShares?shareBalance:expectedShares);
  if(limit===null || args[1]>limit+1n)throw new Error("AGENT_APPROVAL_AMOUNT_MISMATCH");return checked;
 }
 const [params,tokenInputs]=decodeFunctionData({abi:EARN_EXECUTE_ABI,data:call.data}).args;
 if(params.instructions.length!==1 || tokenInputs.length!==1)throw new Error("AGENT_MULTIPLE_INSTRUCTIONS_REFUSED");
 const inner=decodeFunctionData({abi:vaultAbi,data:params.instructions[0].data});
 if(quote.operation!=="DEPOSIT") {
  // Earn Kit hands the router the whole share balance and withdraws exactly the quoted assets
  // (enforced by validateEarnCall); unused shares must be swept straight back to this wallet.
  const input=tokenInputs[0].amount;
  if(expectedShares===null || input<=0n || input>shareBalance)throw new Error("AGENT_SHARE_INPUT_MISMATCH");
  if(!params.tokens.some(t=>t.token.toLowerCase()===quote.vaultAddress.toLowerCase() && t.beneficiary.toLowerCase()===wallet.toLowerCase()))throw new Error("AGENT_SHARE_SWEEP_MISSING");
  if(inner.functionName==="redeem" && inner.args[0]>input)throw new Error("AGENT_REDEEM_AMOUNT_MISMATCH");
  if(inner.functionName!=="withdraw" && inner.functionName!=="redeem")throw new Error("AGENT_WITHDRAW_FUNCTION_MISMATCH");
 }
 return checked;
}
/**
 * Arc is EIP-1559: Circle rejects a legacy gasPrice for developer wallets
 * ("priorityFee too low"). The approved per-gas ceiling becomes maxFee, so the
 * debit stays bounded by gasLimit × ceiling; the tip is the network estimate x2,
 * at least 2 gwei and never above the ceiling.
 */
export function agentFeeConfig(gasLimit: string, ceilingWei: bigint, networkPriorityWei: bigint) {
 const floor=2_000_000_000n;let priority=networkPriorityWei*2n;if(priority<floor)priority=floor;if(priority>ceilingWei)priority=ceilingWei;
 return {type:"absolute" as const,config:{gasLimit,maxFee:formatUnits(ceilingWei,9),priorityFee:formatUnits(priority,9)}};
}
