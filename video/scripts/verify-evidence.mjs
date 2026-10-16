// Read-only check of every transaction the demo film shows: fetches each receipt from Arc Testnet and writes
// public/evidence/receipts.json. Sends no transaction. Usage: node video/scripts/verify-evidence.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RPC = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "evidence");

// Each hash comes from docs/*-validation.md or the production agent_run_steps table.
export const EVIDENCE = [
  { id: "agent-invest", label: "Autopilot run 4aa31f1d · vault depositToStrategy 10.523539 USDC → Morpho (Circle agent)", hash: "0xe52ff16674cfbcf98f6183576f5a78d82c7a084796464b8c88dd4f6b40fac29f", source: "agent_run_steps, production owner, 2026-10-15" },
  { id: "funding", label: "Owner funds Autopilot · 30 USDC transfer", hash: "0xc69f43b23add5999b6aa7697ab37eba0a7167b4a909052f772d32e9943614dcf", source: "docs/autopilot-validation.md" },
  { id: "vault-create", label: "Owner's HoddieVault created through the factory", hash: "0x7c7199e80c96eeb2f7d6f364d3a1fec539a2a30336a70fa30a9f03029d800e87", source: "docs/autopilot-validation.md" },
  { id: "move-shares", label: "First vault run · Morpho shares moved to the vault", hash: "0x58af220ca9dd5906679dea3969c79a971898cf70c60da58645de205a2128e276", source: "docs/autopilot-validation.md" },
  { id: "move-cash", label: "First vault run · 19.523539 USDC moved to the vault", hash: "0x68a0751a2160d9b2a3d19126d223b45ee1f993b579dd3de555fc096894a7dda3", source: "docs/autopilot-validation.md" },
  { id: "bill-paid", label: "Autopilot pays the approved 2 USDC bill from the vault", hash: "0x35ca2d3c7b45b55a32a1b9aec31c70f292259efc71edbe8763374a46c09d796b", source: "docs/autopilot-validation.md" },
  { id: "bill-paid-7", label: "Autopilot run 60537b21 pays the approved 7 USDC bill from the vault", hash: "0x72c2affaf8bd54a797ddbe449063453bb47631cd520e6c5dbcc0ea3eac08d35a", source: "agent_run_steps, production owner, 2026-10-14" },
  { id: "usyc-approve", label: "USYC pool · approve 1 USDC (dev test signer)", hash: "0x79f470da7de8d0343f4d0233347bd261e9ed89f7394a0401d987cf2c775b5a51", source: "docs/usyc-validation.md" },
  { id: "usyc-deposit", label: "USYC pool · deposit 1 USDC (dev test signer)", hash: "0x1781b12687b12d5b3b71ae2fe4064aa4badc9aa9f6181acb8ead790c2c5a760c", source: "docs/usyc-validation.md" },
  { id: "usyc-withdraw", label: "USYC pool · withdraw everything, 0.999895 USDC back (dev test signer)", hash: "0x9e9268ce29315dc7cf5aaf8fc1d5453c62459e714635261bc999462bbf439312", source: "docs/usyc-validation.md" },
  { id: "vault-usyc-deposit", label: "Test vault · agent depositToStrategy 0.6 USDC → USYC pool", hash: "0x0dfd6795a8dc5b75370e01631f35d3b29b0109676f2dd10f31954247d456054d", source: "docs/autopilot-validation.md" },
  { id: "vault-usyc-redeem", label: "Test vault · agent redeemFromStrategy 0.200999 USDC for a bill", hash: "0x5baadc5c4d405e7a6dbfb9fba7870fd577c5d07e6be816c9d6e7446b55cbdea6", source: "docs/autopilot-validation.md" },
];

async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (response.ok) { const body = await response.json(); if (!body.error) return body.result; }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error(`${method} failed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  const chainId = parseInt(await rpc("eth_chainId", []), 16);
  if (chainId !== 5_042_002) throw new Error(`Unexpected chain ${chainId}`);
  const results = [];
  for (const item of EVIDENCE) {
    const receipt = await rpc("eth_getTransactionReceipt", [item.hash]);
    const block = receipt ? await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]) : null;
    const result = { ...item, found: Boolean(receipt), status: receipt ? (receipt.status === "0x1" ? "SUCCESS" : "REVERTED") : "NOT_FOUND",
      block: receipt ? parseInt(receipt.blockNumber, 16) : null, from: receipt?.from ?? null, to: receipt?.to ?? null, logs: receipt?.logs.length ?? 0,
      gasUsed: receipt ? parseInt(receipt.gasUsed, 16) : null, timestamp: block ? new Date(parseInt(block.timestamp, 16) * 1000).toISOString() : null,
      explorer: `https://testnet.arcscan.app/tx/${item.hash}` };
    results.push(result);
    console.log(result.status.padEnd(9), String(result.block).padEnd(10), item.id);
  }
  writeFileSync(join(OUT, "receipts.json"), JSON.stringify({ chainId, rpc: RPC, checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
}
