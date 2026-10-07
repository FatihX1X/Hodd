---
name: supabase-migration
description: Add or change a Supabase migration for Hodd with RLS and a rollback-only SQL test. Use for any schema, policy, function or trigger change.
---

# supabase-migration

Files: `supabase/migrations/<UTC timestamp>_<name>.sql`, tests in `supabase/tests/<name>.sql`, schema snapshot `supabase/hodd-schema.sql`.

Rules:
1. Every new table: `enable row level security` and an owner-scoped select policy (`auth.uid() = owner`). Browser roles get NO insert/update/delete on server-written ledger or evidence tables; only the server-only secret key writes them.
2. Money columns are integer minor units (bigint), never float or decimal dollars. Add CHECK constraints (>= 0, status enums).
3. Functions are `security invoker` unless there is a written reason; set `search_path`.
4. Write a rollback-only test (`begin; ... rollback;`) like `supabase/tests/payment_ledger.sql`: owner isolation (user B cannot see or modify user A), browser write denial, constraint violations, and no leftover data.
5. Put the manual rollback (down) statements in a comment block at the bottom of the migration.
6. Use the Supabase MCP only after `list_tables`. Apply to a branch or test project, or run the test inside a rolled-back transaction; never run destructive SQL on live data. Run `get_advisors` (security) afterwards.
7. Update `supabase/hodd-schema.sql` and the README migration list.
8. Record the migration (applied? tested?) in memory.md.
