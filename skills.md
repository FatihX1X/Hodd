# Skills dizini

`.claude/skills/<ad>/SKILL.md` altındaki skill'ler. Hangi iş için hangisi:

| Skill | Ne zaman |
| --- | --- |
| verify | Her değişiklikten sonra, review/merge/ship öncesi: typecheck, lint, test, build. |
| cross-review | Bir branch bitince: Codex (yoksa salt-okunur reviewer subagent) ile çapraz inceleme ve ek test. En fazla 3 tur. |
| supabase-migration | Şema, RLS, fonksiyon veya trigger değişikliğinde: migration + rollback-only SQL testi. |
| money-path-review | Tutar, quote, ücret, imza veya ödeme koduna dokunan her diff: integer minor-unit, session'a bağlı quote, belirsiz sonuçta otomatik retry yok. |
| wallet-smoke | Test wallet ile Arc Testnet akışı (en fazla 1 USDC) ve ArcScan doğrulaması. Sadece testnet. |
| ship | Her şey yeşilken: commit, main'e merge, push, Vercel deploy durumu. Force push yok. |

Çalışma döngüsü: planla → branch'te yaz + test → cross-review → düzelt (≤3 tur) → verify → (roller değişir) → main'e merge → ship → memory.md güncelle.
