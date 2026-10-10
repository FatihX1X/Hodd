import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { loadEnvConfig } = require(require.resolve('@next/env', {paths:[require.resolve('next/package.json')]}));
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const results = { circleConfigured: Boolean(process.env.CIRCLE_API_KEY?.startsWith('TEST')), entityConfigured: Boolean(process.env.CIRCLE_ENTITY_SECRET), testSignerConfigured: Boolean(process.env.HODD_TEST_SIGNER_PRIVATE_KEY) };
for (const [name,url,auth] of [['arc',process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network',false], ['circle','https://api.circle.com/v1/w3s/config/entity/publicKey',true]]) {
 try { const r=await fetch(url,{method:auth?'GET':'POST',headers:auth?{Authorization:'Bearer '+process.env.CIRCLE_API_KEY}:{'Content-Type':'application/json'},body:auth?undefined:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(10000)});results[name]={status:r.status,...(!auth?{chainId:(await r.json()).result}:{})}; } catch {results[name]={reachable:false};}
}
console.log(JSON.stringify(results));
