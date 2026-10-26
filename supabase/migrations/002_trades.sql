-- Kasvukonto: tehingupõhine arvestus. Käivita Supabase'i SQL Editoris üks kord.
-- Olemasolevad investeeringud tõstetakse automaatselt üheks ostutehinguks.

alter table public.holdings
  add column if not exists buy_currency text not null default 'EUR',
  add column if not exists buy_price numeric,
  add column if not exists buy_fx numeric,
  add column if not exists buy_date date;

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  holding_id uuid not null references public.holdings on delete cascade,
  date date not null default current_date,
  side text not null check (side in ('buy','sell')),
  qty numeric not null check (qty > 0),
  price numeric not null check (price >= 0),   -- tehingu valuutas, 1 tk kohta
  currency text not null default 'EUR',
  fx numeric not null default 1,               -- mitu eurot 1 valuutaühiku eest
  fee numeric not null default 0,              -- tehingutasu eurodes
  created_at timestamptz not null default now()
);

alter table public.trades enable row level security;
drop policy if exists "own trades" on public.trades;
create policy "own trades" on public.trades for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.trades to authenticated;
grant all on public.trades to service_role;

insert into public.trades (user_id, holding_id, date, side, qty, price, currency, fx, fee)
select h.user_id, h.id, coalesce(h.buy_date, h.created_at::date), 'buy', h.qty,
       coalesce(h.buy_price, h.avg_price), coalesce(h.buy_currency, 'EUR'), coalesce(h.buy_fx, 1), 0
from public.holdings h
where h.qty > 0
  and not exists (select 1 from public.trades t where t.holding_id = h.id);
