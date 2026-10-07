# Hodd memory

Her çalışma oturumunun sonunda güncellenir. Bu dosya her oturumda yüklenir (CLAUDE.md `@memory.md`).

## Proje durumu (2026-10-07)

Hodd: Arc Testnet üzerinde bireyler/küçük işletmeler için likidite öncelikli hazine konsolu. Next.js 16, Supabase (RLS), Circle (PIN / Passkey) ve MetaMask/Rabby cüzdanları.

- Stage 4 (Earn): yerel, kullanıcı onaylı yürütme kodu hazır. Canlı doğrulama: sadece Rabby geçti. Passkey ve MetaMask bekliyor, Circle PIN/SCA fail-closed (`SCA_FEE_CEILING_UNSUPPORTED`). Stage 4 tamamlanmış DEĞİL.
- Stage 5 (Send/ödeme): defter, EOA / PIN / Passkey iş akışı ve geçitler kodda var; hepsi mock testli. Canlı ödeme yapılmadı. Tamamlanmış DEĞİL.
- Stage 6 (MCP/OAuth/ajan) ve deploy: Stage 5 teknik + canlı kabulüne kadar başlamaz (README). Kullanıcı kararıyla deploy yapılabilir ama yürütme bayrakları production'da kapalı kalır.
- Başlangıç doğrulaması (2026-10-07): typecheck, lint, test PASS (mock/unit).

## Kararlar ve nedenleri

- Sert limitler (değişmez): asıl cüzdanın private key/seed/PIN'i sohbete, loga veya commit'e yazılmaz; mainnet ve gerçek para yok; production'da execution bayrakları kapalı. Neden: kullanıcı kararı, geri alınamaz para riski.
- `pnpm` PATH'te yok; `corepack pnpm` kullanılır (package.json `pnpm@11.19.0`).
- Codex CLI bu makinede kurulu değil; cross-review için salt-okunur reviewer subagent kullanılır. Neden: aynı işi bağımsız ikinci göz olarak yapar.
- Eski `/ship` komutu skill'e taşındı (`.claude/skills/ship`). Neden: tek kaynak.
- İzin kuralları `.claude/settings.json`: deny yok, riskli işler `ask`. Neden: kullanıcı onayıyla (2026-10-07).

## Yapılacaklar (öncelik sırasıyla)

1. Stage 4/5 kodunda insan eli gerektirmeyen açıkları kapat (README "outstanding acceptance work" listesi, mock ile test edilebilenler).
2. Test wallet oluştur (`.env.test.local`), yalnızca public adres burada tutulur; faucet fonlaması insana kalır.
3. Stage 4 kabul kanıtları: Passkey ve MetaMask canlı smoke (insan adımı).
4. Stage 5 canlı ödeme smoke (en fazla 1 USDC): PIN, Passkey, MetaMask, Rabby (insan adımı).
5. Circle PIN/SCA Earn fee-ceiling desteği (Circle tarafında doğrulanana kadar fail-closed kalır).
6. Vercel deploy kontrolü (hodd.vercel.app), bayraklar kapalı.

## Bilinen sorunlar

- Circle PIN/SCA Earn `SCA_FEE_CEILING_UNSUPPORTED` ile kapalı (Circle UCW SCA için `feeLevel` istiyor, Hodd'un azami ücretini zorlayamıyor).
- Circle Earn pozisyon indeksi çekimden sonra birkaç dakika geriden gelir; bu sürede çekim quote'u reddedilebilir.
- Rabby verilen gas limitini yükseltebilir; imzalanan gas fiyatı yine de sınırlıdır.
- Codex CLI, pnpm ve vercel CLI PATH'te yok.

## Test wallet

Public adres: `0x62dCe01b1a7B9a6f592f148d305E0D5751478386` (Arc Testnet, 2026-10-07). Key yalnızca git-ignored `.env.test.local` içinde. Bakiye 0 USDC (RPC ile okundu, chain id 5042002 doğrulandı) — faucet bekliyor.

## Aşama doğrulama durumu

| Aşama | Durum | Kanıt |
| --- | --- | --- |
| Earn, Rabby (EOA) | testnet onchain | deposit 0.5 USDC blok 66009558, withdraw 0.25 USDC blok 66009751, redeem-all blok 66009872 (README; tx hash'leri `earn_provider_evidence` tablosunda, ArcScan linki eklenecek) |
| Earn, MetaMask | mock | canlı bekliyor |
| Earn, Circle Passkey | mock | canlı bekliyor |
| Earn, Circle PIN | fail-closed | SCA fee ceiling |
| Send, EOA / PIN / Passkey | mock | canlı ödeme yok |
| Supabase RLS testleri | rollback-only SQL | `supabase/tests/*.sql` |
| Preflight (Arc RPC) | testnet onchain okuma | chain id 5042002, HTTP 200 (yazma yok) |

## İnsan adımları (atla, listede tut)

1. **Faucet:** Arc Testnet faucet'inden test wallet'a (`0x62dC…8386`) ve smoke yapacağın cüzdanlara test USDC al. Bakiye gelince `wallet-smoke` skill'i devam eder.
2. **Rabby/MetaMask Earn+Send smoke (en fazla 1 USDC):** `.env.local`'e `HODD_EARN_EXECUTION_ENABLED=true` ve `HODD_PAYMENT_EXECUTION_ENABLED=true` yaz (yalnızca yerelde), `corepack pnpm dev` ile aç, `http://localhost:3000` → giriş → cüzdan paneli → MetaMask'ı bağla → Earn: 0.5 USDC yatır → tarayıcı penceresinde Onayla → 0.25 USDC çek → hepsini çek (redeem-all). Sonra Send: en fazla 1 USDC kendi test alıcına gönder. Her işlemin hash'ini ArcScan'de bul ve buraya yaz.
3. **Circle Passkey:** aynı akış, cüzdan olarak "Circle Passkey" seç; tarayıcının passkey istemini Onayla. Önce Circle Console'da Gas Station'ın Arc Testnet için açık olduğunu kontrol et.
4. **Circle PIN:** Circle Console'da App ID / Client Key doğru mu bak; PIN penceresinde PIN'i kendin gir. SCA fee ceiling desteği doğrulanana kadar Earn fail-closed kalır.
5. Production/Vercel'de bayrakları AÇMA (bu zaten kodda kapalı).

## Oturum günlüğü

- 2026-10-07: skill'ler (.claude/skills), memory.md, skills.md ve izinler kuruldu (commit c9baddd, main'e push). Temel doğrulama yeşil (typecheck, lint, test). Test wallet oluşturuldu, bakiye 0. Vercel main'den otomatik deploy ediyor (proje `hodd`, hodd.vercel.app HTTP 200).
- Kalan Stage 4/5 kabul işleri tamamen canlı tarayıcı/cüzdan onayı gerektiriyor; kodda mock ile kapatılabilecek açık bulunmadı. Bir sonraki adım: faucet sonrası wallet-smoke.
