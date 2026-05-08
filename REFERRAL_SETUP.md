# Referral System — Setup Guide

## Flow

```
User A
↓ Nhận referral link từ bot
https://t.me/your_bot?start=<UserA_TelegramID>
↓
User B click link
↓
Telegram gửi webhook POST → /functions/v1/telegram-webhook
  { message: { text: "/start <UserA_ID>", from: { id: UserB_ID } } }
↓
Edge Function: telegram-webhook
  → upsert users (User B)
  → users.set referred_by = UserA_ID  (chỉ nếu chưa được refer)
↓
User B mở app, deposit
↓
submitDeposit() → insert tx vào DB
  → gọi /functions/v1/credit-referral
      { user_id: UserB, deposit_amount: X }
↓
Edge Function: credit-referral
  → check: B có referred_by không?
  → check: đây có phải lần deposit đầu không?
  → idempotency check (tx ID)
  → update referrer balance + referral_commission + referral_friends
  → insert transaction type='referral' cho referrer
```

---

## Deploy Steps

### 1. Chạy SQL migration
```sql
-- Supabase Dashboard → SQL Editor
-- Chạy file: supabase/migration_referral_webhook.sql
```

### 2. Deploy Edge Functions
```bash
supabase functions deploy telegram-webhook --no-verify-jwt
supabase functions deploy credit-referral --no-verify-jwt
```

### 3. Thêm Bot Token secret
```bash
supabase secrets set TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
```

### 4. Set Telegram Webhook
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/telegram-webhook",
    "allowed_updates": ["message"]
  }'
```

### 5. Verify webhook
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## Files Changed

| File | Thay đổi |
|------|----------|
| `supabase/functions/telegram-webhook/index.ts` | **MỚI** — Nhận webhook từ Telegram, lưu referred_by |
| `supabase/functions/credit-referral/index.ts` | **MỚI** — Credit commission khi first deposit |
| `supabase/migration_referral_webhook.sql` | **MỚI** — SQL migration |
| `src/utils/supabase.js` | Replace `creditReferralCommission` → `creditReferralViaServer` |
| `src/hooks/useApp.js` | Remove client-side referral logic → gọi server-side |

---

## Key Improvements

- ✅ **Referral tracking qua Telegram webhook** — không phụ thuộc vào client tự report
- ✅ **Commission chỉ credit 1 lần** (first deposit only) — Edge Function kiểm tra
- ✅ **Idempotent** — cùng deposit không credit 2 lần
- ✅ **Server-side** — client không thể fake referral
- ✅ **Non-blocking** — referral fail không ảnh hưởng deposit
