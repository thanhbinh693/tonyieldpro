# 🚀 Setup Auto-Withdraw — Không cần VPS

## Kiến trúc mới (event-driven)

```
User nhấn Withdraw
  → Frontend ghi pending vào Supabase DB
  → Database Webhook kích hoạt NGAY LẬP TỨC
  → Edge Function process-withdrawal chạy
  → Gửi TON từ ví admin → ví user
  → Update status: completed
```

**Không có vòng lặp. Không có server riêng. Tất cả trên Supabase + Vercel.**

---

## Bước 1 — Chạy SQL Migration

Vào **Supabase Dashboard → SQL Editor**, paste và chạy:
```
supabase/migration_webhook_withdraw.sql
```

---

## Bước 2 — Deploy Edge Function

```bash
# Cài Supabase CLI nếu chưa có
npm install -g supabase

# Login
supabase login

# Link project (lấy project-ref tại Dashboard → Settings → General)
supabase link --project-ref <project-ref>

# Deploy
supabase functions deploy process-withdrawal
```

---

## Bước 3 — Set Secrets cho Edge Function

```bash
supabase secrets set ADMIN_MNEMONIC="word1 word2 word3 ... word24"
supabase secrets set TON_NETWORK=testnet
supabase secrets set TON_API_KEY=your_toncenter_api_key
supabase secrets set WEBHOOK_SECRET=random_secret_string_here
```

> **Tạo WEBHOOK_SECRET**: dùng bất kỳ chuỗi random nào, ví dụ:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## Bước 4 — Tạo Database Webhook

Vào **Supabase Dashboard → Database → Webhooks → Create a new hook**:

| Field | Value |
|-------|-------|
| Name | `trigger-withdrawal` |
| Table | `transactions` |
| Events | ✅ **INSERT** only |
| Type | Supabase Edge Functions |
| Edge Function | `process-withdrawal` |
| HTTP Headers | `x-webhook-secret: <WEBHOOK_SECRET bạn đã set>` |

Nhấn **Save**.

---

## Bước 5 — Xóa backend/ (không cần nữa)

```bash
rm -rf backend/
```

Folder `backend/withdrawal-worker.js` là vòng lặp poll cũ — đã được thay thế hoàn toàn bởi Edge Function + Webhook.

---

## Test thử

1. Mở app, connect ví TON testnet
2. Nhấn Withdraw, nhập số tiền
3. Vào **Supabase → Table Editor → transactions** → thấy row mới với status `pending`
4. Vài giây sau → status chuyển thành `processing` → `completed`
5. Vào **Supabase → Edge Functions → process-withdrawal → Logs** để xem chi tiết

---

## Xử lý lỗi

| Status | Ý nghĩa | Hành động |
|--------|---------|-----------|
| `pending` | Mới tạo, chờ webhook | Tự động xử lý |
| `processing` | Edge Function đang chạy | Chờ (tối đa 3 phút) |
| `sent` | Đã gửi, chờ blockchain confirm | Tiền đang trên đường, OK |
| `completed` | Hoàn thành | ✅ |
| `failed` | Thất bại, đã hoàn tiền | Kiểm tra `fail_reason` |

Nếu có lệnh stuck ở `processing` > 3 phút, chạy trong SQL Editor:
```sql
select retry_stuck_withdrawals();
```

---

## Lưu ý bảo mật

- **Không commit** file `.env` hoặc `ADMIN_MNEMONIC` lên git
- `WEBHOOK_SECRET` ngăn người ngoài gọi thẳng Edge Function
- Edge Function dùng **CAS (Compare-And-Swap)** để tránh double-send khi webhook fire 2 lần
