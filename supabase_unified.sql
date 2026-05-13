-- TonYield unified Supabase database setup
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table if not exists users (
  id bigint primary key,
  username text default '',
  first_name text default '',
  balance numeric(18,6) default 0,
  total_deposit numeric(18,6) default 0,
  total_withdraw numeric(18,6) default 0,
  today_profit numeric(18,6) default 0,
  referrals int default 0,
  wallet_addr text default '',
  join_date text default '',
  status text default 'active',
  referral_code text default '',
  referral_friends int default 0,
  referral_commission numeric(18,6) default 0,
  referral_deposit_volume numeric(18,6) default 0,
  referred_by text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists investments (
  id text primary key,
  user_id bigint references users(id) on delete cascade,
  plan text,
  plan_color text default 'gold',
  amount numeric(18,6),
  rate numeric(12,6),
  earned numeric(18,6) default 0,
  days_total int,
  profit_interval_hours numeric default 24,
  profit_interval_minutes numeric default 1440,
  profit_interval_ms bigint default 86400000,
  active_days int[] default '{1,2,3,4,5}',
  start_time bigint,
  end_time bigint,
  next_profit_time bigint,
  status text default 'active',
  activated boolean default false,
  invoice_id text default '',
  plan_id int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists transactions (
  id text primary key,
  user_id bigint references users(id) on delete cascade,
  type text,
  label text,
  amount numeric(18,6),
  status text default 'pending',
  invoice_id text default '',
  to_wallet text default '',
  plan_id int,
  fail_reason text default '',
  created_at bigint,
  created_at_ts timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists admin_config (
  id int primary key default 1,
  min_withdraw numeric(18,6) default 5,
  referral_rate numeric(8,4) default 5,
  maintenance_mode boolean default false,
  admin_wallet text default '',
  admin_ids bigint[] default '{}',
  bot_username text default '',
  ton_network text not null default 'testnet' check (ton_network in ('mainnet', 'testnet')),
  updated_at timestamptz default now(),
  constraint single_admin_config_row check (id = 1)
);

create table if not exists plans (
  id int primary key,
  name text,
  tier text default 'Starter',
  min_amount numeric(18,6) default 10,
  max_amount numeric(18,6),
  rate numeric(12,6) default 2.5,
  duration int default 30,
  duration_unit text default 'days',
  duration_ms bigint default 2592000000,
  profit_interval_hours numeric default 24,
  profit_interval_minutes numeric default 1440,
  profit_interval_ms bigint default 86400000,
  active_days int[] default '{1,2,3,4,5}',
  color text default 'gold',
  hot boolean default false,
  updated_at timestamptz default now()
);

alter table users add column if not exists referral_deposit_volume numeric(18,6) default 0;
alter table users add column if not exists referred_by text default '';
alter table investments add column if not exists updated_at timestamptz default now();
alter table transactions add column if not exists fail_reason text default '';
alter table transactions add column if not exists updated_at timestamptz default now();

insert into admin_config (id) values (1)
on conflict (id) do update set updated_at = now();

insert into plans (
  id, name, tier, min_amount, max_amount, rate, duration, duration_unit,
  duration_ms, profit_interval_hours, profit_interval_minutes, profit_interval_ms,
  active_days, color, hot
) values
  (1, 'Basic',        'Starter', 0.01, 0.99, 2.5, 1, 'hours', 3600000,  0.0833, 5,  300000,  '{0,1,2,3,4,5,6}', 'gold',   false),
  (2, 'Professional', 'Pro',     1,    4.99, 3.0, 2, 'hours', 7200000,  0.25,   15, 900000,  '{0,1,2,3,4,5,6}', 'blue',   true),
  (3, 'Elite',        'VIP',     5,    null, 3.5, 3, 'hours', 10800000, 0.5,    30, 1800000, '{0,1,2,3,4,5,6}', 'purple', false)
on conflict (id) do update set
  name = excluded.name,
  tier = excluded.tier,
  min_amount = excluded.min_amount,
  max_amount = excluded.max_amount,
  rate = excluded.rate,
  duration = excluded.duration,
  duration_unit = excluded.duration_unit,
  duration_ms = excluded.duration_ms,
  profit_interval_hours = excluded.profit_interval_hours,
  profit_interval_minutes = excluded.profit_interval_minutes,
  profit_interval_ms = excluded.profit_interval_ms,
  active_days = excluded.active_days,
  color = excluded.color,
  hot = excluded.hot,
  updated_at = now();

update users
set referral_code = cast(id as text)
where referral_code is null or referral_code = '';

create index if not exists idx_users_referral_code on users (referral_code);
create index if not exists idx_users_referred_by on users (referred_by);
create index if not exists idx_investments_user_id on investments (user_id);
create index if not exists idx_investments_status on investments (status);
create index if not exists idx_investments_due on investments (status, activated, next_profit_time);
create index if not exists idx_transactions_user_id on transactions (user_id);
create index if not exists idx_transactions_type_status on transactions (type, status);
create index if not exists idx_transactions_pending_withdraw
  on transactions (status, type, created_at)
  where status = 'pending' and type = 'withdraw';

create or replace view withdrawal_queue as
select
  t.id,
  t.user_id,
  u.username,
  u.first_name,
  t.amount,
  t.to_wallet,
  t.status,
  t.fail_reason,
  to_timestamp(t.created_at / 1000) as requested_at,
  t.updated_at
from transactions t
left join users u on u.id = t.user_id
where t.type = 'withdraw'
order by t.created_at desc;

create or replace function credit_profit(
  p_user_id bigint,
  p_investment_id text,
  p_profit numeric,
  p_new_earned numeric,
  p_next_time bigint,
  p_old_next_time bigint,
  p_tx_id text,
  p_tx_label text,
  p_now bigint
) returns boolean
language plpgsql
security definer
as $$
declare
  updated_count int;
begin
  update investments
  set earned = p_new_earned,
      next_profit_time = p_next_time,
      updated_at = now()
  where id = p_investment_id
    and user_id = p_user_id
    and next_profit_time = p_old_next_time;

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    return false;
  end if;

  update users
  set balance = balance + p_profit,
      today_profit = today_profit + p_profit,
      updated_at = now()
  where id = p_user_id;

  insert into transactions (id, user_id, type, label, amount, status, created_at)
  values (p_tx_id, p_user_id, 'profit', p_tx_label, p_profit, 'completed', p_now)
  on conflict (id) do nothing;

  return true;
end;
$$;

grant execute on function credit_profit(bigint, text, numeric, numeric, bigint, bigint, text, text, bigint)
  to anon, authenticated;

create or replace function retry_stuck_withdrawals()
returns void
language plpgsql
security definer
as $$
begin
  update transactions
  set status = 'pending',
      fail_reason = 'Reset from stuck processing state',
      updated_at = now()
  where type = 'withdraw'
    and status = 'processing'
    and updated_at < now() - interval '3 minutes';
end;
$$;

alter table users enable row level security;
alter table investments enable row level security;
alter table transactions enable row level security;
alter table admin_config enable row level security;
alter table plans enable row level security;

drop policy if exists "allow_all_users" on users;
drop policy if exists "allow_all_investments" on investments;
drop policy if exists "allow_all_transactions" on transactions;
drop policy if exists "allow_all_config" on admin_config;
drop policy if exists "allow_all_plans" on plans;

create policy "allow_all_users" on users for all using (true) with check (true);
create policy "allow_all_investments" on investments for all using (true) with check (true);
create policy "allow_all_transactions" on transactions for all using (true) with check (true);
create policy "allow_all_config" on admin_config for all using (true) with check (true);
create policy "allow_all_plans" on plans for all using (true) with check (true);

do $$
begin
  begin
    alter publication supabase_realtime add table users;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table investments;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table transactions;
  exception when duplicate_object then null;
  end;
end $$;

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('users', 'investments', 'transactions');
