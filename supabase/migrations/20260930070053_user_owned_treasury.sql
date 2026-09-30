-- Stage 5 schema blueprint. Apply through Supabase SQL Editor after project creation,
-- then generate a tracked migration with the Supabase CLI when the project is linked.
create table if not exists public.treasury_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null check (schema_version = 4),
  workspace jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('CIRCLE_USER_CONTROLLED','CIRCLE_MODULAR','INJECTED_METAMASK','INJECTED_RABBY')),
  chain text not null check (chain = 'ARC-TESTNET'),
  chain_id bigint not null check (chain_id = 5042002),
  address text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  account_type text not null check (account_type in ('EOA','SCA','MSCA')),
  circle_wallet_id text,
  label text not null check (char_length(label) between 1 and 60),
  is_authoritative boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, chain)
);

alter table public.treasury_workspaces enable row level security;
alter table public.wallet_connections enable row level security;
revoke all on public.treasury_workspaces, public.wallet_connections from anon;
grant select, insert, update, delete on public.treasury_workspaces, public.wallet_connections to authenticated;

create policy "workspace owner select" on public.treasury_workspaces for select to authenticated using ((select auth.uid()) = user_id);
create policy "workspace owner insert" on public.treasury_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "workspace owner update" on public.treasury_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "workspace owner delete" on public.treasury_workspaces for delete to authenticated using ((select auth.uid()) = user_id);

create policy "wallet owner select" on public.wallet_connections for select to authenticated using ((select auth.uid()) = user_id);
create policy "wallet owner insert" on public.wallet_connections for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "wallet owner update" on public.wallet_connections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "wallet owner delete" on public.wallet_connections for delete to authenticated using ((select auth.uid()) = user_id);
