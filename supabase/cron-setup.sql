-- ─── Supabase pg_cron: gọi tick-profits Edge Function mỗi 1 phút ──────────────
--
-- 1. Vào Supabase Dashboard → Database → Extensions → bật pg_cron và pg_net
-- 2. Vào SQL Editor → chạy đoạn SQL dưới đây
-- 3. Thay <PROJECT_REF> và <SERVICE_ROLE_KEY> bằng giá trị thật
--

-- Bật extensions (nếu chưa có)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Xóa job cũ nếu có
SELECT cron.unschedule('tick-profits') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'tick-profits'
);

-- Tạo cron job: chạy mỗi phút
SELECT cron.schedule(
  'tick-profits',           -- job name
  '* * * * *',              -- mỗi phút
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/tick-profits',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Kiểm tra job đã được tạo
SELECT * FROM cron.job WHERE jobname = 'tick-profits';

-- ─── Kiểm tra log của cron ────────────────────────────────────────────────────
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
