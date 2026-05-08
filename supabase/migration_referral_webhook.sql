-- ═══════════════════════════════════════════════════════════════════════════
-- migration_referral_webhook.sql
-- Referral system — đảm bảo các cột cần thiết tồn tại
-- Chạy trong Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Thêm cột referred_by nếu chưa có ─────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT DEFAULT '';

-- ── 2. Đảm bảo các cột referral stats tồn tại ────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code       TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_friends    INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_commission NUMERIC(18,6) DEFAULT 0;

-- ── 3. Index cho referral_code (lookup khi tìm referrer) ──────────────────────
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code);

-- ── 4. Index cho referred_by (để query "ai refer user này") ───────────────────
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by);

-- ── 5. Đảm bảo cột type 'referral' được chấp nhận trong transactions ─────────
-- Nếu bạn dùng ENUM cho cột type, thêm giá trị mới:
-- ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'referral';
-- Nếu dùng TEXT thì không cần làm gì.

-- ── 6. Backfill: set referral_code = id cho tất cả user chưa có ─────────────
UPDATE users SET referral_code = CAST(id AS TEXT) WHERE referral_code IS NULL OR referral_code = '';

-- ═══════════════════════════════════════════════════════════════════════════
-- TELEGRAM WEBHOOK SETUP
-- ═══════════════════════════════════════════════════════════════════════════
-- Sau khi deploy edge function, set webhook bằng curl:
--
--   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
--     -H "Content-Type: application/json" \
--     -d '{"url": "https://<YOUR_PROJECT>.supabase.co/functions/v1/telegram-webhook"}'
--
-- Verify:
--   curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
--
-- Thêm secret cho Edge Function:
--   supabase secrets set TELEGRAM_BOT_TOKEN=your_bot_token_here
-- ═══════════════════════════════════════════════════════════════════════════
