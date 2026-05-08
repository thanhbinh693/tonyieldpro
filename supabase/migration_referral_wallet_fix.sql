-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: referral fix + per-network wallet columns
-- Run in Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add per-network wallet columns to admin_config (idempotent)
ALTER TABLE admin_config
  ADD COLUMN IF NOT EXISTS admin_wallet_mainnet text DEFAULT '',
  ADD COLUMN IF NOT EXISTS admin_wallet_testnet text DEFAULT '';

-- 2. Backfill: copy existing admin_wallet into the testnet column if blank
UPDATE admin_config
  SET admin_wallet_testnet = admin_wallet
  WHERE admin_wallet_testnet = '' AND admin_wallet IS NOT NULL AND admin_wallet <> '';

-- 3. Ensure referred_by column exists and is indexed for fast lookup
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referred_by text DEFAULT '';

-- 4. Index on referred_by — speeds up "who referred this user?" queries
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by)
  WHERE referred_by IS NOT NULL AND referred_by <> '';

-- 5. Index on referral_code — speeds up getReferrerByCode()
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code)
  WHERE referral_code IS NOT NULL AND referral_code <> '';

-- 6. Composite index on transactions for the deposit-count check in applyReferralCommission
CREATE INDEX IF NOT EXISTS idx_tx_user_type ON transactions (user_id, type);

-- 7. Index for idempotency guard in creditReferralCommission
--    (user_id + type + label prefix — partial index on referral rows)
CREATE INDEX IF NOT EXISTS idx_tx_referral_rows ON transactions (user_id, type)
  WHERE type = 'referral';

-- ─────────────────────────────────────────────────────────────────────────────
-- Optional: verify columns were added
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'admin_config'
--   ORDER BY ordinal_position;
-- ─────────────────────────────────────────────────────────────────────────────
