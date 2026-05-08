-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Setup Database Webhook cho auto-withdraw
-- Chạy trong: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Sau khi chạy SQL này, vào:
--   Supabase Dashboard → Database → Webhooks → Create Webhook
-- Với config:
--   Name:    trigger-withdrawal
--   Table:   transactions
--   Events:  INSERT
--   URL:     https://<project-ref>.supabase.co/functions/v1/process-withdrawal
--   Headers: x-webhook-secret: <WEBHOOK_SECRET của bạn>
--
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Thêm cột fail_reason vào transactions nếu chưa có
alter table transactions
  add column if not exists fail_reason text default null;

-- 2. Thêm status 'sent' vào check constraint (nếu có)
-- (nếu không có constraint thì bỏ qua bước này)

-- 3. Index để query pending nhanh
create index if not exists idx_transactions_pending_withdraw
  on transactions (status, type, created_at)
  where status = 'pending' and type = 'withdraw';

-- 4. Index để worker check nhanh theo user
create index if not exists idx_transactions_user_type
  on transactions (user_id, type, status);

-- ─── OPTIONAL: Retry function cho các lệnh bị stuck ─────────────────────────
-- Chạy hàm này thủ công hoặc dùng pg_cron để retry các lệnh 'sent' quá lâu
-- (trường hợp Edge Function timeout trước khi confirm)

create or replace function retry_stuck_withdrawals()
returns void
language plpgsql
security definer
as $$
declare
  stuck_tx record;
begin
  -- Tìm các lệnh 'processing' > 3 phút (Edge Function có thể đã crash)
  for stuck_tx in
    select id, user_id, amount
    from transactions
    where type = 'withdraw'
      and status = 'processing'
      and updated_at < now() - interval '3 minutes'
  loop
    -- Reset về pending để webhook có thể retry
    update transactions
    set status     = 'pending',
        fail_reason = 'Reset from stuck processing state',
        updated_at  = now()
    where id = stuck_tx.id;

    raise notice 'Reset stuck tx: %', stuck_tx.id;
  end loop;
end;
$$;

-- ─── OPTIONAL: pg_cron retry mỗi 5 phút ────────────────────────────────────
-- Chỉ bật nếu project Supabase của bạn có pg_cron extension (Pro plan)
-- select cron.schedule('retry-stuck-withdrawals', '*/5 * * * *', 'select retry_stuck_withdrawals()');

-- ─── VERIFY: Kiểm tra setup đúng ────────────────────────────────────────────
select
  column_name, data_type
from information_schema.columns
where table_name = 'transactions'
  and column_name in ('status', 'fail_reason', 'to_wallet')
order by column_name;
