@AGENTS.md
@memory.md
@skills.md

# Çalışma kuralları

Kullanıcı bir şeyi açıkça yap derse, aşağıdaki SERT LİMİTLER dışında, itiraz etmeden yap. Risk varsa tek cümleyle belirt, sonra yap. Tekrar tekrar onay isteme.

## SERT LİMİTLER (kullanıcı emretse bile değişmez)

- Kullanıcının asıl cüzdanının private key, seed phrase ve PIN'i sohbete, loga veya commit'e yazılmaz.
- Production'da execution bayrakları açılmaz.
- Mainnet'te veya gerçek parayla işlem yapılmaz.

## Sadece "yap" demesi yeterli olanlar

Test wallet oluşturma, `.env.test.local`'e yazma, testnet işlemleri, `.hodd-local` temizliği, branch / merge / push / deploy.

Not: `.claude/settings.json` içindeki "ask" kuralları (`.env*` okuma/yazma, `.hodd-local`, `rm -rf`, force push) araç düzeyinde onay penceresi çıkarır. Kullanıcı "yap" dediyse sohbette tekrar sorma; sadece o pencere çıkar.

Değişiklikleri kullanıcıya basit Türkçe özetle.

## Otonom çalışma

`pnpm` yerine `corepack pnpm` kullan. Her iş: planla → ayrı branch'te yaz ve test ekle → `cross-review` → bulguları düzelt (en fazla 3 tur) → `verify` → `ship` → `memory.md` güncelle. İnsan eli gereken adımlar (faucet, Circle Console, PIN/passkey/MetaMask onayı) için bekleme: memory.md "İnsan adımları" listesine senaryosuyla ekle ve diğer işe geç.
