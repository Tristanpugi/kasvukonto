-- Kasvukonto andmebaas. Käivita Supabase'i SQL Editoris üks kord.

create table if not exists public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ticker text not null,
  symbol text,                -- hinnaallika sümbol, nt VWCE.DE, LHV1T.TL, BTC-EUR
  name text,
  type text not null default 'ETF',  -- ETF, Aktsia, Fond, Võlakiri, Hoius, Krüpto, Muu
  qty numeric not null default 0,
  avg_price numeric not null default 0,
  target numeric not null default 0,
  nominal numeric,
  rate numeric,
  maturity date,
  manual_price numeric,
  manual_price_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.txns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  kind text not null check (kind in ('dividend','deposit','withdraw')),
  ticker text,
  amount numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  monthly numeric not null default 300
);

-- Turuhinnad on ühised kõigile kasutajatele; neid kirjutab ainult serveri funktsioon.
create table if not exists public.prices (
  symbol text primary key,
  price numeric not null,          -- eurodes
  currency text not null default 'EUR',
  native_price numeric,
  native_currency text,
  updated_at timestamptz not null default now(),
  source text
);

alter table public.holdings enable row level security;
alter table public.txns enable row level security;
alter table public.settings enable row level security;
alter table public.prices enable row level security;

create policy "own holdings" on public.holdings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own txns" on public.txns for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own settings" on public.settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "read prices" on public.prices for select
  to authenticated using (true);

-- Õigused Data API jaoks (vajalik, kui "Automatically expose new tables" on välja lülitatud).
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.holdings, public.txns, public.settings to authenticated;
grant select on public.prices to authenticated;
grant all on public.holdings, public.txns, public.settings, public.prices to service_role;

-- Ostu valuuta (lisatud hiljem). avg_price on alati eurodes; dollarites ostu algandmed on siin.
alter table public.holdings
  add column if not exists buy_currency text not null default 'EUR',
  add column if not exists buy_price numeric,
  add column if not exists buy_fx numeric,
  add column if not exists buy_date date;
