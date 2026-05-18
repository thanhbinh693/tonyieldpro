-- TonYield unified Supabase database setup
-- Run this whole file once in Supabase Dashboard -> SQL Editor.

create table if not exists users (
  id bigint primary key,
  username text default '',
  first_name text default '',
  balance numeric(18,6) default 0,
  total_deposit numeric(18,6) default 0,
  total_withdraw numeric(18,6) default 0,
  total_profit numeric(18,6) default 0,
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
  bot_chat_id bigint,
  bot_started_at timestamptz,
  bot_blocked_at timestamptz,
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
  admin_wallet_testnet text default '',
  admin_wallet_mainnet text default '',
  withdrawal_webhook_url text default '',
  withdrawal_webhook_secret text default '',
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

create table if not exists notifications (
  id bigserial primary key,
  title text not null default '',
  body text not null default '',
  audience text not null default 'all' check (audience in ('all', 'user')),
  user_id bigint references users(id) on delete cascade,
  created_by bigint,
  created_at timestamptz default now()
);

alter table users add column if not exists referral_deposit_volume numeric(18,6) default 0;
alter table users add column if not exists referred_by text default '';
alter table users add column if not exists total_profit numeric(18,6) default 0;
alter table users add column if not exists bot_chat_id bigint;
alter table users add column if not exists bot_started_at timestamptz;
alter table users add column if not exists bot_blocked_at timestamptz;
alter table admin_config add column if not exists admin_wallet_testnet text default '';
alter table admin_config add column if not exists admin_wallet_mainnet text default '';
alter table admin_config add column if not exists withdrawal_webhook_url text default '';
alter table admin_config add column if not exists withdrawal_webhook_secret text default '';
alter table investments add column if not exists updated_at timestamptz default now();
alter table transactions add column if not exists fail_reason text default '';
alter table transactions add column if not exists updated_at timestamptz default now();

update users u
set total_profit = coalesce(p.profit_amount, 0),
    updated_at = now()
from (
  select user_id, round(sum(abs(amount))::numeric, 6) as profit_amount
  from transactions
  where type = 'profit'
    and status = 'completed'
  group by user_id
) p
where u.id = p.user_id
  and coalesce(u.total_profit, 0) = 0
  and coalesce(p.profit_amount, 0) > 0;

insert into admin_config (id) values (1)
on conflict (id) do update set updated_at = now();

insert into plans (
  id, name, tier, min_amount, max_amount, rate, duration, duration_unit,
  duration_ms, profit_interval_hours, profit_interval_minutes, profit_interval_ms,
  active_days, color, hot
) values
  (1, 'Starter Yield', 'Starter', 0.01, 0.99, 2.5, 1, 'hours', 3600000,  0.0833, 5,  300000,  '{0,1,2,3,4,5,6}', 'gold',   false),
  (2, 'Pro Yield',     'Pro',     1,    4.99, 3.0, 2, 'hours', 7200000,  0.25,   15, 900000,  '{0,1,2,3,4,5,6}', 'blue',   true),
  (3, 'VIP Yield',     'VIP',     5,    null, 3.5, 3, 'hours', 10800000, 0.5,    30, 1800000, '{0,1,2,3,4,5,6}', 'purple', false)
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

update users
set bot_chat_id = id,
    updated_at = now()
where bot_chat_id is null;

update investments
set plan = case
  when plan ilike 'basic' then 'Starter Yield'
  when plan ilike 'professional' then 'Pro Yield'
  when plan ilike 'elite' then 'VIP Yield'
  else plan
end
where plan ilike any (array['basic', 'professional', 'elite']);

update transactions
set label = replace(replace(replace(label, 'Basic', 'Starter Yield'), 'Professional', 'Pro Yield'), 'Elite', 'VIP Yield')
where label ~* '(basic|professional|elite)';

create index if not exists idx_users_referral_code on users (referral_code);
create index if not exists idx_users_referred_by on users (referred_by);
create index if not exists idx_users_bot_chat_id on users (bot_chat_id);
create index if not exists idx_investments_user_id on investments (user_id);
create index if not exists idx_investments_status on investments (status);
create index if not exists idx_investments_due on investments (status, activated, next_profit_time);
create index if not exists idx_transactions_user_id on transactions (user_id);
create index if not exists idx_transactions_type_status on transactions (type, status);
create index if not exists idx_transactions_pending_withdraw
  on transactions (status, type, created_at)
  where status = 'pending' and type = 'withdraw';
create index if not exists idx_notifications_created_at on notifications (created_at desc);
create index if not exists idx_notifications_user_id on notifications (user_id, created_at desc);

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
set search_path = public
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
      total_profit = total_profit + p_profit,
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

create or replace function record_deposit(
  p_user_id bigint,
  p_username text,
  p_first_name text,
  p_amount numeric,
  p_from_balance boolean,
  p_tx_id text,
  p_inv_id text,
  p_invoice_id text,
  p_plan_id int,
  p_plan text,
  p_plan_color text,
  p_rate numeric,
  p_days_total int,
  p_profit_interval_ms bigint,
  p_profit_interval_minutes numeric,
  p_profit_interval_hours numeric,
  p_active_days int[],
  p_start_time bigint,
  p_end_time bigint,
  p_next_profit_time bigint
) returns table(balance numeric, total_deposit numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric;
  v_balance numeric;
  v_total_deposit numeric;
begin
  insert into users (id, username, first_name, referral_code, bot_chat_id, join_date, updated_at)
  values (
    p_user_id,
    coalesce(p_username, ''),
    coalesce(p_first_name, ''),
    p_user_id::text,
    p_user_id,
    current_date::text,
    now()
  )
  on conflict (id) do update set
    username = coalesce(nullif(excluded.username, ''), users.username),
    first_name = coalesce(nullif(excluded.first_name, ''), users.first_name),
    referral_code = coalesce(nullif(users.referral_code, ''), excluded.referral_code),
    bot_chat_id = coalesce(users.bot_chat_id, excluded.bot_chat_id),
    bot_blocked_at = case when users.bot_chat_id is null then null else users.bot_blocked_at end,
    updated_at = now();

  select users.balance into current_balance
  from users
  where users.id = p_user_id
  for update;

  if p_from_balance and current_balance < p_amount then
    raise exception 'Insufficient balance';
  end if;

  update users
  set balance = case when p_from_balance then users.balance - p_amount else users.balance end,
      total_deposit = users.total_deposit + p_amount,
      updated_at = now()
  where users.id = p_user_id
  returning users.balance, users.total_deposit
  into v_balance, v_total_deposit;

  balance := v_balance;
  total_deposit := v_total_deposit;

  insert into transactions (id, user_id, type, label, amount, status, invoice_id, plan_id, created_at, updated_at)
  values (
    p_tx_id,
    p_user_id,
    'deposit',
    case when p_from_balance then 'Reinvest - ' || p_plan else 'Deposit - ' || p_plan end,
    case when p_from_balance then -p_amount else p_amount end,
    'completed',
    p_invoice_id,
    p_plan_id,
    p_start_time,
    now()
  )
  on conflict (id) do nothing;

  insert into investments (
    id, user_id, plan, plan_color, plan_id, amount, rate, earned, days_total,
    profit_interval_ms, profit_interval_minutes, profit_interval_hours,
    active_days, start_time, end_time, next_profit_time, status, activated,
    invoice_id, updated_at
  )
  values (
    p_inv_id, p_user_id, p_plan, p_plan_color, p_plan_id, p_amount, p_rate, 0, p_days_total,
    p_profit_interval_ms, p_profit_interval_minutes, p_profit_interval_hours,
    p_active_days, p_start_time, p_end_time, p_next_profit_time, 'active', false,
    p_invoice_id, now()
  )
  on conflict (id) do nothing;

  return next;
end;
$$;

grant execute on function record_deposit(
  bigint, text, text, numeric, boolean, text, text, text, int, text, text,
  numeric, int, bigint, numeric, numeric, int[], bigint, bigint, bigint
) to anon, authenticated;

create or replace function register_referral_user(
  p_user_id bigint,
  p_username text,
  p_first_name text,
  p_referred_by_code text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  referrer_id bigint;
  attached_count int := 0;
begin
  insert into users (id, username, first_name, referral_code, bot_chat_id, join_date, updated_at)
  values (p_user_id, coalesce(p_username, ''), coalesce(p_first_name, ''), p_user_id::text, p_user_id, current_date::text, now())
  on conflict (id) do update set
    username = coalesce(nullif(excluded.username, ''), users.username),
    first_name = coalesce(nullif(excluded.first_name, ''), users.first_name),
    referral_code = coalesce(nullif(users.referral_code, ''), excluded.referral_code),
    bot_chat_id = coalesce(users.bot_chat_id, excluded.bot_chat_id),
    bot_blocked_at = case when users.bot_chat_id is null then null else users.bot_blocked_at end,
    updated_at = now();

  if coalesce(p_referred_by_code, '') = '' or p_referred_by_code = p_user_id::text then
    return false;
  end if;

  select id into referrer_id
  from users
  where referral_code = p_referred_by_code
    and id <> p_user_id
  limit 1;

  if referrer_id is null then
    return false;
  end if;

  update users
  set referred_by = '',
      updated_at = now()
  where id = referrer_id
    and referred_by = p_user_id::text;

  update users
  set referred_by = p_referred_by_code,
      updated_at = now()
  where id = p_user_id
    and coalesce(referred_by, '') = '';

  get diagnostics attached_count = row_count;

  if attached_count > 0 then
    update users
    set referral_friends = (
          select count(*) from users invitees
          where invitees.referred_by = p_referred_by_code
            and invitees.id <> referrer_id
            and invitees.referral_code <> coalesce((select referred_by from users where id = referrer_id), '')
        ),
        referrals = (
          select count(*) from users invitees
          where invitees.referred_by = p_referred_by_code
            and invitees.id <> referrer_id
            and invitees.referral_code <> coalesce((select referred_by from users where id = referrer_id), '')
        ),
        updated_at = now()
    where id = referrer_id;
  end if;

  return attached_count > 0;
end;
$$;

grant execute on function register_referral_user(bigint, text, text, text) to anon, authenticated;

create or replace function sync_referral_counts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int := 0;
begin
  update users older_link
  set referred_by = '',
      updated_at = now()
  from users newer_link
  where older_link.referred_by = newer_link.referral_code
    and newer_link.referred_by = older_link.referral_code
    and older_link.created_at <= newer_link.created_at;

  update users referrers
  set referral_friends = coalesce(counts.invitee_count, 0),
      referrals = coalesce(counts.invitee_count, 0),
      updated_at = now()
  from (
    select referrers_inner.id, count(invitees.id)::int as invitee_count
    from users referrers_inner
    left join users invitees
      on invitees.referred_by = referrers_inner.referral_code
      and invitees.id <> referrers_inner.id
      and invitees.referral_code <> coalesce(referrers_inner.referred_by, '')
    group by referrers_inner.id
  ) counts
  where referrers.id = counts.id
    and (
      referrers.referral_friends is distinct from counts.invitee_count
      or referrers.referrals is distinct from counts.invitee_count
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function sync_referral_counts() to anon, authenticated;

create or replace function credit_referral_commission(
  p_user_id bigint,
  p_deposit_amount numeric,
  p_deposit_tx_id text,
  p_now bigint default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  invitee record;
  referrer record;
  referral_rate numeric;
  commission numeric;
  referral_tx_id text;
  now_ms bigint;
  inserted_count int := 0;
begin
  if p_user_id is null or p_deposit_amount is null or p_deposit_amount <= 0 then
    return false;
  end if;

  select id, username, first_name, referred_by
  into invitee
  from users
  where id = p_user_id;

  if invitee.id is null or coalesce(invitee.referred_by, '') = '' then
    return false;
  end if;

  select id
  into referrer
  from users
  where referral_code = invitee.referred_by
    and id <> p_user_id
  for update;

  if referrer.id is null then
    return false;
  end if;

  select admin_config.referral_rate
  into referral_rate
  from admin_config
  where id = 1;

  commission := round((p_deposit_amount * (coalesce(referral_rate, 5) / 100))::numeric, 6);
  if commission <= 0 then
    return false;
  end if;

  referral_tx_id := 'ref-' || referrer.id::text || '-' || p_user_id::text || '-' || coalesce(nullif(p_deposit_tx_id, ''), floor(extract(epoch from clock_timestamp()) * 1000)::text);
  now_ms := coalesce(p_now, floor(extract(epoch from clock_timestamp()) * 1000)::bigint);

  insert into transactions (id, user_id, type, label, amount, status, invoice_id, created_at, updated_at)
  values (
    referral_tx_id,
    referrer.id,
    'referral',
    'Referral - @' || coalesce(nullif(invitee.username, ''), nullif(invitee.first_name, ''), p_user_id::text) || ' deposit ' || p_deposit_amount::text || ' TON',
    commission,
    'completed',
    coalesce(p_deposit_tx_id, ''),
    now_ms,
    now()
  )
  on conflict (id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return false;
  end if;

  update users
  set balance = balance + commission,
      referral_commission = referral_commission + commission,
      referral_deposit_volume = referral_deposit_volume + p_deposit_amount,
      updated_at = now()
  where id = referrer.id;

  return true;
end;
$$;

grant execute on function credit_referral_commission(bigint, numeric, text, bigint) to anon, authenticated;

create or replace function repair_referral_commissions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deposit_tx record;
  repaired_count int := 0;
  credited boolean := false;
begin
  for deposit_tx in
    select id, user_id, amount, created_at
    from transactions
    where type = 'deposit'
      and status = 'completed'
      and amount > 0
      and label not ilike 'Reinvest -%'
    order by created_at asc
  loop
    select credit_referral_commission(
      deposit_tx.user_id,
      deposit_tx.amount,
      deposit_tx.id,
      deposit_tx.created_at
    )
    into credited;

    if credited then
      repaired_count := repaired_count + 1;
    end if;
  end loop;

  return repaired_count;
end;
$$;

grant execute on function repair_referral_commissions() to anon, authenticated;

create or replace function delete_user_data(
  p_user_id bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int := 0;
  old_referred_by text := '';
begin
  select coalesce(referred_by, '')
  into old_referred_by
  from users
  where id = p_user_id;

  update users
  set referred_by = '',
      updated_at = now()
  where referred_by = p_user_id::text;

  delete from users
  where id = p_user_id;

  get diagnostics deleted_count = row_count;

  if old_referred_by <> '' then
    update users referrers
    set referral_friends = (
          select count(*) from users invitees
          where invitees.referred_by = old_referred_by
            and invitees.id <> referrers.id
            and invitees.referral_code <> coalesce(referrers.referred_by, '')
        ),
        referrals = (
          select count(*) from users invitees
          where invitees.referred_by = old_referred_by
            and invitees.id <> referrers.id
            and invitees.referral_code <> coalesce(referrers.referred_by, '')
        ),
        updated_at = now()
    where referrers.referral_code = old_referred_by;
  end if;

  perform sync_referral_counts();

  return deleted_count > 0;
end;
$$;

grant execute on function delete_user_data(bigint) to anon, authenticated;

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
alter table notifications enable row level security;

drop policy if exists "allow_all_users" on users;
drop policy if exists "allow_all_investments" on investments;
drop policy if exists "allow_all_transactions" on transactions;
drop policy if exists "allow_all_config" on admin_config;
drop policy if exists "allow_all_plans" on plans;
drop policy if exists "allow_all_notifications" on notifications;

create policy "allow_all_users" on users for all using (true) with check (true);
create policy "allow_all_investments" on investments for all using (true) with check (true);
create policy "allow_all_transactions" on transactions for all using (true) with check (true);
create policy "allow_all_config" on admin_config for all using (true) with check (true);
create policy "allow_all_plans" on plans for all using (true) with check (true);
create policy "allow_all_notifications" on notifications for all using (true) with check (true);

create extension if not exists pg_net with schema extensions;

create or replace function trigger_withdrawal_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg record;
begin
  if new.type <> 'withdraw' or new.status <> 'pending' then
    return new;
  end if;

  select withdrawal_webhook_url, withdrawal_webhook_secret
  into cfg
  from admin_config
  where id = 1;

  if coalesce(cfg.withdrawal_webhook_url, '') = '' then
    return new;
  end if;

  perform net.http_post(
    url := cfg.withdrawal_webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(cfg.withdrawal_webhook_secret, '')
    ),
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', to_jsonb(new)
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists trg_withdrawal_webhook_insert on transactions;
drop trigger if exists trg_withdrawal_webhook_update on transactions;

create trigger trg_withdrawal_webhook_insert
after insert on transactions
for each row
when (new.type = 'withdraw' and new.status = 'pending')
execute function trigger_withdrawal_webhook();

create trigger trg_withdrawal_webhook_update
after update of status, updated_at on transactions
for each row
when (new.type = 'withdraw' and new.status = 'pending')
execute function trigger_withdrawal_webhook();

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

  begin
    alter publication supabase_realtime add table plans;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table admin_config;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table notifications;
  exception when duplicate_object then null;
  end;
end $$;

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('users', 'investments', 'transactions', 'plans', 'admin_config', 'notifications');

create or replace view tonyield_healthcheck as
select 'users.balance' as check_name,
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='balance') as ok
union all
select 'users.total_deposit',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='total_deposit')
union all
select 'users.total_profit',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='total_profit')
union all
select 'users.referral_commission',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='referral_commission')
union all
select 'users.referral_deposit_volume',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='referral_deposit_volume')
union all
select 'users.bot_chat_id',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='bot_chat_id')
union all
select 'admin_config.admin_wallet_testnet',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='admin_config' and column_name='admin_wallet_testnet')
union all
select 'admin_config.admin_wallet_mainnet',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='admin_config' and column_name='admin_wallet_mainnet')
union all
select 'admin_config.withdrawal_webhook_url',
       exists(select 1 from information_schema.columns where table_schema='public' and table_name='admin_config' and column_name='withdrawal_webhook_url')
union all
select 'function.trigger_withdrawal_webhook',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='trigger_withdrawal_webhook')
union all
select 'trigger.trg_withdrawal_webhook_insert',
       exists(select 1 from pg_trigger where tgname='trg_withdrawal_webhook_insert')
union all
select 'function.record_deposit',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_deposit')
union all
select 'function.register_referral_user',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='register_referral_user')
union all
select 'function.sync_referral_counts',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sync_referral_counts')
union all
select 'function.credit_referral_commission',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='credit_referral_commission')
union all
select 'function.repair_referral_commissions',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='repair_referral_commissions')
union all
select 'function.delete_user_data',
       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='delete_user_data')
union all
select 'notifications.table',
       exists(select 1 from information_schema.tables where table_schema='public' and table_name='notifications')
union all
select 'realtime.notifications',
       exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications')
union all
select 'realtime.users',
       exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='users')
union all
select 'realtime.investments',
       exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='investments')
union all
select 'realtime.transactions',
       exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='transactions')
union all
select 'realtime.plans',
       exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='plans')
union all
select 'realtime.admin_config',
       exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='admin_config');

select * from tonyield_healthcheck order by check_name;

-- ---------------------------------------------------------------------------
-- Minimal security hardening
-- ---------------------------------------------------------------------------
-- Frontend code in Telegram Web/Mini App is inspectable. Keep anon read access
-- for the current UI/realtime flow, but block direct client writes and direct
-- money/admin RPC calls. Sensitive writes should go through Supabase Edge
-- Function `secure-api`, which verifies Telegram initData and uses service role.

drop policy if exists "allow_all_users" on users;
drop policy if exists "allow_all_investments" on investments;
drop policy if exists "allow_all_transactions" on transactions;
drop policy if exists "allow_all_config" on admin_config;
drop policy if exists "allow_all_plans" on plans;
drop policy if exists "allow_all_notifications" on notifications;

drop policy if exists "public_select_users" on users;
drop policy if exists "public_select_investments" on investments;
drop policy if exists "public_select_transactions" on transactions;
drop policy if exists "public_select_config" on admin_config;
drop policy if exists "public_select_plans" on plans;
drop policy if exists "public_select_notifications" on notifications;

create policy "public_select_users" on users
  for select using (true);

create policy "public_select_investments" on investments
  for select using (true);

create policy "public_select_transactions" on transactions
  for select using (true);

create policy "public_select_config" on admin_config
  for select using (true);

create policy "public_select_plans" on plans
  for select using (true);

create policy "public_select_notifications" on notifications
  for select using (true);

revoke execute on function credit_profit(bigint, text, numeric, numeric, bigint, bigint, text, text, bigint)
  from anon, authenticated;
revoke execute on function record_deposit(
  bigint, text, text, numeric, boolean, text, text, text, int, text, text,
  numeric, int, bigint, numeric, numeric, int[], bigint, bigint, bigint
) from anon, authenticated;
revoke execute on function register_referral_user(bigint, text, text, text)
  from anon, authenticated;
revoke execute on function credit_referral_commission(bigint, numeric, text, bigint)
  from anon, authenticated;
revoke execute on function repair_referral_commissions()
  from anon, authenticated;
revoke execute on function sync_referral_counts()
  from anon, authenticated;
revoke execute on function delete_user_data(bigint)
  from anon, authenticated;
revoke execute on function retry_stuck_withdrawals()
  from anon, authenticated;

grant execute on function credit_profit(bigint, text, numeric, numeric, bigint, bigint, text, text, bigint)
  to service_role;
grant execute on function record_deposit(
  bigint, text, text, numeric, boolean, text, text, text, int, text, text,
  numeric, int, bigint, numeric, numeric, int[], bigint, bigint, bigint
) to service_role;
grant execute on function register_referral_user(bigint, text, text, text)
  to service_role;
grant execute on function credit_referral_commission(bigint, numeric, text, bigint)
  to service_role;
grant execute on function repair_referral_commissions()
  to service_role;
grant execute on function sync_referral_counts()
  to service_role;
grant execute on function delete_user_data(bigint)
  to service_role;
grant execute on function retry_stuck_withdrawals()
  to service_role;
