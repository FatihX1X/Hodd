# Hodd demo · shot-by-shot evidence checklist

Film: `HoddDemo` (1920×1080, 60 fps, 140 s), `src/demo/Demo.tsx`. No voiceover; the film is told in burned-in English subtitles ([SCRIPT.md](./SCRIPT.md), `hodd-demo.srt`) over an original score.

Every figure, hash and decision in the film comes from one of these sources:

| Source | What it holds | How to re-check |
|---|---|---|
| **Onchain receipts** | `evidence/receipts.json` holds 12 Arc Testnet receipts (chain 5042002), all `SUCCESS`, read 2026-10-16 10:58 UTC. | `node scripts/verify-evidence.mjs` is read-only (`eth_getTransactionReceipt`) |
| **Onchain state** | `evidence/balances.json` (block 67,488,244) and `evidence/vault-config.json` (block 67,488,501). | `node scripts/read-balances.mjs` and `node scripts/read-vault-config.mjs` are read-only `eth_call`s |
| **Production records** | `evidence/agent-history.json` holds the production owner's latest 20 Autopilot runs (`agent_runs`) and their 16 onchain steps (`agent_run_steps`), exported read-only on 2026-10-16. User ids are removed. | Supabase project `lbdtfzyulgegpsxhszfw` |
| **App UI** | `public/demo/shots/*.png` is real Hodd UI captured by `scripts/capture-demo.mjs` with Playwright. See *How the console was captured* below. | Re-run the capture |
| **Arcscan** | `public/demo/shots/arcscan-*.png` holds the public explorer pages for the hashes above, captured on 2026-10-16. | Open the links below |

**What was not done.** No transaction was sent while making this film. Every chain access was a read. No API key, private key, session token or Circle credential appears on screen or in the repository. The wallet injected during capture refuses every signing request.

## How the console was captured

The console (`app.hoddfinance.xyz`) requires a signed-in Supabase session. It was captured from a local production build (`pnpm build && next start`) of this repository's `main`. The sign-in was mocked the same way as in `tests/e2e/live-session.ts`. In this build:

- **Live reads.** These are Hodd's own server routes at capture time:
  - the owner wallet's USDC balance (`/api/arc/treasury`, Arc RPC)
  - Morpho's recent yield and the owner wallet's own Morpho position (`/api/earn/portfolio`)
  - the Circle Gateway balances (`/api/gateway/balances`)
- **Wallet and policy.** These are the production owner's: wallet `0xDEf0…2e7C`, safety buffer 1 USDC, lead time 3 days and Morpho cap 50%.
- **Bills are SAMPLE DATA.** These four bills were entered for the demo and are tagged on screen:

  | Bill | Amount (USDC) | Due |
  |---|---|---|
  | Payroll | 12 | +2 days |
  | Studio rent | 6 | +8 days |
  | Supplier invoice | 4.5 | +15 days |
  | Cloud hosting | 1.5 | +22 days |

  The production owner's real bills are not shown.
- **The Autopilot page.** It was fed from production records and onchain reads instead of the live `/api/autopilot/status` route, which needs the server's service key. Run history and steps come from `agent-history.json`. Vault balances, owner, operator and limits come from `balances.json` and `vault-config.json`. The Morpho yield is 420 bps, as the live read returned. The USYC yield is left `null`, which the page shows as "Unknown".
- **The Connections page.** The MCP endpoint URL text `http://127.0.0.1:3107` was replaced with `https://app.hoddfinance.xyz` in the DOM. That is the same path on the production host. Nothing else was edited.
- **Hoddie.** The answers are real responses from the local build's `/api/hoddie` route to typed questions, computed on the sample workspace above.
- **Not shown.** The USYC card on the Invest page depends on the session and is not shown.

## Section by section

### 00:00–00:12 · Hook
| Time | On screen | Evidence | Kind |
|---|---|---|---|
| 0:01–0:05 | "Payroll / Rent / Invoice", kinetic type | Narrative framing only; no figure | — |
| 0:05–0:09 | Hodd mark, "A treasury on Arc that keeps money ahead of what it owes" | Product positioning, from the landing page | — |
| 0:09–0:12 | `www.hoddfinance.xyz` | `live-landing.png`, captured on 2026-10-16 | LIVE |

### 00:12–00:29 · Live treasury
| Time | On screen | Evidence | Kind |
|---|---|---|---|
| 0:12–0:17 | **31.56 USDC** liquid, verified balance badge | `console-overview-full.png`. Live `/api/arc/treasury` read of the owner wallet. `balances.json` has 31.563327 at block 67,488,244. | LIVE |
| 0:12–0:17 | Total 33.46 = 31.56 liquid + 1.90 in Morpho | The same capture. The 1.90 is the owner wallet's own Morpho position (live read), not the vault. | LIVE |
| 0:17–0:23 | Bills inside the 3-day lead time protected; a later bill kept liquid because Morpho liquidity is low | `console-obligations-full.png`. The engine output on the **sample bills**. | SAMPLE |
| 0:17–0:23 | "lead time 3 to 30 days" | `protectionLeadDays: z.number().int().min(3).max(30)` in `src/lib/treasury/models.ts`; the Policy page | CODE |
| 0:23–0:29 | Protected **25.00** (24.00 bills + 1.00 buffer), Deployable **8.46** (33.46 − 25.00) | `console-overview-full.png`. The Treasury Engine computes in integer minor units, with no model involved. | SAMPLE + LIVE |

### 00:29–00:54 · Agent wallet, funding and limits
| Time | On screen | Evidence | Kind |
|---|---|---|---|
| 0:29–0:36 | Owner `0xDEf0…2e7C` → HoddieVault `0xA425…D02d` ← operator `0xae40…750b` (Circle agent wallet) | `vault-config.json`: `owner()` and `operator()` at block 67,488,501 | ONCHAIN |
| 0:36–0:41 | Owner funds Autopilot with **30 USDC**, owner → `0xae…750b` | [0xc69f43b2…4dcf](https://testnet.arcscan.app/tx/0xc69f43b23add5999b6aa7697ab37eba0a7167b4a909052f772d32e9943614dcf), block 67,127,988, 2026-10-14 08:05:06 UTC. `arcscan-funding.png` shows "Transfer 30 USDC to 0xae…750b". | ONCHAIN |
| 0:41–0:54 | Allowed destinations: Morpho, Hodd's USYC pool, approved recipient capped at 7 USDC, the owner. Anything else reverts. | `vault-config.json`: `morphoAllowed`, `usycAllowed`, `recipientApproved` true, `recipientCap` 7,000,000. Reverts: `StrategyNotAllowed` / `RecipientNotApproved` in `contracts/src/HoddieVault.sol`; the operator's `transferToOwner` can only pay `owner()`. | ONCHAIN + CODE |
| 0:41–0:54 | "Owner: your wallet · Operator: your agent", "Take everything back yourself" | `console-autopilot-full.png`: the Autopilot page's vault card. `withdrawAll()` and `pause()` are `onlyOwner` in `contracts/src/HoddieVault.sol`. | RECORD + CODE |

Caveat: the vault was created through the permissionless factory by the dev test signer `0xB7a0…a19c` (tx [0x7c7199e8…0e87](https://testnet.arcscan.app/tx/0x7c7199e80c96eeb2f7d6f364d3a1fec539a2a30336a70fa30a9f03029d800e87)), with owner = the owner's wallet. The film says the owner's wallet *owns* the vault, which `owner()` proves. It never says the owner deployed it. The vault's per-transaction and 24-hour limits are currently at the maximum (2⁶⁴−1), so the film does not show amount limits as active. It shows the destination allowlist and the recipient cap, which are enforced.

### 00:54–01:25 · AI advisor decision and policy
| Time | On screen | Evidence | Kind |
|---|---|---|---|
| 0:54–1:03 | Run **4aa31f1d** · 2026-10-15 03:07 UTC · trigger "six-hour check". Engine proposal **INVEST 10.523539 USDC → Morpho**, recent yield **4.20%**, 1.000000 USDC protected. | `agent-history.json` run `4aa31f1d-5c22-49da-b1bc-661cfea7b40d`: `decision.kind` INVEST, `depositMinor` 10523539, `protectedMinor` 1000000, `snapshot.trigger` SCHEDULE ("Six-hour check" in `src/lib/autopilot/triggers.ts`) | RECORD |
| 1:03–1:12 | Advisor **openai/gpt-oss-120b on Groq**, sees aggregate figures only, action **FOLLOW**, status FOLLOWED. The rationale is typed out verbatim. | `decision.advisor`: `model`, `provider` GROQ, `action` FOLLOW, `status` FOLLOWED, `rationale` "Follow engine: invest 10.523539 USDC in Morpho (4.20% APY) as it's higher yield and no pending bills." | RECORD |
| 1:12–1:21 | Policy envelope: FOLLOW / ALLOCATE / WAIT / MOVE. Bills, top-ups and returns are decided by the engine only. An answer outside the envelope is discarded. | `src/lib/autopilot/vault-advisor.ts` (`vaultAdvisorEnvelope`) | CODE |
| 1:21–1:25 | "Always deciding": on its own schedule the agent decides again and records why. History page. | `console-autopilot-history-full.png`, built from `agent-history.json`. Scheduled runs (trigger SCHEDULE, "Six-hour check") on Oct 14 04:07, 16:07, Oct 15 03:07, 10:07, 17:07 and Oct 16 00:07, 07:07 UTC; each stores the engine's proposal and, from Oct 14 16:07 on, the advisor's answer and rationale. The owner has 22 runs in total (9 COMPLETED, 9 NO_ACTION, 3 FAILED, 1 PARTIAL); the page shows the latest 20. | RECORD |

On how the advisor is presented: every recorded advisor answer for this owner is FOLLOW, and the film shows exactly that. No INVEST, ALLOCATE or MOVE answer was manufactured. The narration says the advisor "may follow, allocate, wait or move between strategies", which is what the envelope allows. It does not say that the model picks strategies on its own. Amounts come from the deterministic engine.

### 01:25–01:45 · Execution and the Arcscan receipt
| Time | On screen | Evidence | Kind |
|---|---|---|---|
| 1:25–1:29 | Recheck on fresh balances | `vaultLegAllowed` in `src/lib/autopilot/vault-runner.ts` checks each leg against a fresh decision and fresh positions before signing; `decision.ts` refuses stale balances (older than 60 s). | CODE |
| 1:29–1:40 | The Circle agent wallet `0xae…750b` calls **depositToStrategy** on vault `0xA4…D02d`. Success, block **67,263,362**, 10.523539 USDC → Morpho. | [0xe52ff166…c29f](https://testnet.arcscan.app/tx/0xe52ff16674cfbcf98f6183576f5a78d82c7a084796464b8c88dd4f6b40fac29f), 2026-10-15 03:07:18 UTC, gas 325,695, 18 logs. `arcscan-agent-invest.png`. | ONCHAIN |
| 1:37–1:45 | Hodd verifies from the vault's events → **Completed** | `agent_run_steps` row `24f7cf07…`, stage VAULT, state **VERIFIED**, same tx hash. Run state COMPLETED. | RECORD |

### 01:45–02:02 · USYC pool and liquidity
| Time | On screen | Evidence | Kind |
|---|---|---|---|
| 1:45–1:50 | Hodd's USYC pool (HoddUSYCVault `0x97a7…0b76`), deposit 1 USDC | [0x1781b126…760c](https://testnet.arcscan.app/tx/0x1781b12687b12d5b3b71ae2fe4064aa4badc9aa9f6181acb8ead790c2c5a760c), block 67,041,440, 2026-10-13. The approval was [0x79f470da…5a51](https://testnet.arcscan.app/tx/0x79f470da7de8d0343f4d0233347bd261e9ed89f7394a0401d987cf2c775b5a51). | ONCHAIN |
| 1:50–1:55 | Round trip: **0.999895 USDC** back from 1 USDC | [0x9e9268ce…9312](https://testnet.arcscan.app/tx/0x9e9268ce29315dc7cf5aaf8fc1d5453c62459e714635261bc999462bbf439312), block 67,041,452. `arcscan-usyc-withdraw.png`. | ONCHAIN |
| 1:55–2:02 | Autopilot's USYC path, verified on a test vault | Test vault `0xc7eF…333F`: the agent's `depositToStrategy` of 0.6 USDC → USYC, [0x0dfd6795…054d](https://testnet.arcscan.app/tx/0x0dfd6795a8dc5b75370e01631f35d3b29b0109676f2dd10f31954247d456054d), and its `redeemFromStrategy` of 0.200999 USDC for a bill, [0x5baadc5c…eea6](https://testnet.arcscan.app/tx/0x5baadc5c4d405e7a6dbfb9fba7870fd577c5d07e6be816c9d6e7446b55cbdea6) | ONCHAIN |

Caveats, also stated on screen and in the narration:
- The pool round trip was signed by the **dev test signer** `0xB7a0…a19c`, using the app's own quote and verify code. It was not signed by the production owner.
- The production vault **allows** USYC (`usycAllowed` true), but its runs have used **Morpho only**. Its USYC balance is 0 (`balances.json`).
- No USYC yield figure is claimed. The Autopilot page shows it as "Unknown".

### 02:02–02:12 · Hoddie, Claude MCP, Circle Gateway
| Time | On screen | Evidence | Kind |
|---|---|---|---|
| 2:02–2:05 | Hoddie answers "Can I pay this week's bills?" from the engine's numbers | `console-hoddie-bills.png`: a real answer from the local build, on the **sample bills** | LIVE + SAMPLE |
| 2:04–2:08 | Claude runs Hodd over MCP; every change needs approval | `console-connections.png` (the URL text is localised, see above). MCP endpoint `src/app/api/mcp/route.ts`; tools in `src/lib/agent/tools.ts` return a preview and require the user's explicit approval before a write, and payments are signed by the user's own wallet in Hodd. | CODE |
| 2:07–2:12 | Circle Gateway unifies USDC from 12 testnets and brings it to Arc | `console-overview-full.png` Gateway panel, read live from `/api/gateway/balances`; the 12 Gateway testnets (Arc Testnet among them, so USDC from the other 11 can be minted on Arc) are `GATEWAY_CHAINS` in `src/lib/gateway/chains.ts` | LIVE + CODE |

### 02:12–02:20 · Outro
Hodd Finance mark, the tagline "Money should know when it will be needed." and `app.hoddfinance.xyz`.

## Ticker (top bar, 0:12–2:12)
Each ticker item maps to a row above:
- Arc Testnet · 5042002
- Vault 0xA425…D02d · 30.486784 USDC in Morpho (`balances.json` → `vaultMorpho.assetsMinor`)
- Morpho recent yield 4.20%
- Run 4aa31f1d · INVEST 10.523539 USDC · advisor followed
- Block 67,263,362 · depositToStrategy · success
- Bill paid by Autopilot · 7 USDC · block 67,213,918 ([0x72c2affa…d35a](https://testnet.arcscan.app/tx/0x72c2affaf8bd54a797ddbe449063453bb47631cd520e6c5dbcc0ea3eac08d35a), run `60537b21`, the vault's `pay` to the approved recipient)
- USYC round trip · 0.999895 USDC back

## Other receipts checked (not featured)
- Move shares, first vault run: [0x58af220c…e276](https://testnet.arcscan.app/tx/0x58af220ca9dd5906679dea3969c79a971898cf70c60da58645de205a2128e276)
- Move 19.523539 USDC to the vault: [0x68a0751a…dda3](https://testnet.arcscan.app/tx/0x68a0751a2160d9b2a3d19126d223b45ee1f993b579dd3de555fc096894a7dda3)
- Autopilot pays the approved 2 USDC bill: [0x35ca2d3c…796b](https://testnet.arcscan.app/tx/0x35ca2d3c7b45b55a32a1b9aec31c70f292259efc71edbe8763374a46c09d796b)

## Sound and subtitles
- **No voiceover.** The narration is subtitles only. `scripts/pace_captions.py` times them at speaking pace: each line is spoken with Kokoro v1.0 (Apache-2.0, local) only to measure its length, and no audio is kept. Each subtitle then stays up until the next one, at most 17.7 characters per second on screen.
- **Music.** Original score, synthesised in `scripts/compose_music.py --timeline src/demo/music-timeline.json`. It uses no samples and no third-party audio.
