// Read-only: the production HoddieVault owner, operator, limits, strategies and approved recipient. Usage: node video/scripts/read-vault-config.mjs
import { createPublicClient, http, parseAbi, getAddress } from "viem";
const c = createPublicClient({ transport: http("https://rpc.testnet.arc.network") });
const v = getAddress("0xa425dd0acc673405e648ebe64eed2fc4da0ad02d");
const abi = parseAbi(["function owner() view returns (address)","function operator() view returns (address)","function maxDepositPerTx() view returns (uint256)","function depositLimit24h() view returns (uint256)","function maxPaymentPerTx() view returns (uint256)","function paymentLimit24h() view returns (uint256)","function isStrategy(address) view returns (bool)","function isRecipient(address) view returns (bool)","function recipientCap(address) view returns (uint256)","function paused() view returns (bool)"]);
const r = (f, a=[]) => c.readContract({ address: v, abi, functionName: f, args: a }).catch(e => "ERR " + e.shortMessage);
const out = {};
for (const f of ["owner","operator","maxDepositPerTx","depositLimit24h","maxPaymentPerTx","paymentLimit24h","paused"]) out[f] = String(await r(f));
out.morphoAllowed = String(await r("isStrategy", [getAddress("0xaabbef1d3971c710276ed41ec791bbe14cdb8e88")]));
out.usycAllowed = String(await r("isStrategy", [getAddress("0x97a7baaa5416e0ac0674c395cec22ff606120b76")]));
const rec = getAddress("0x3406584ccd8cc2fa38bfd3ece96d5dd4371b0040");
out.recipientApproved = String(await r("isRecipient", [rec])); out.recipientCap = String(await r("recipientCap", [rec]));
out.block = String(await c.getBlockNumber());
console.log(JSON.stringify(out, null, 1));
