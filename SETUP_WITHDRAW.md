# 🚀 Hướng dẫn Setup Auto-Withdraw — Không cần VPS

## Kiến trúc (event-driven, không có vòng lặp)

```
User nhấn Withdraw
  → Frontend ghi pending vào Supabase DB
  → Database Webhook kích hoạt NGAY LẬP TỨC
  → Edge Function process-withdrawal chạy
  → Gửi TON từ ví admin → ví user
  → Update status: completed
```

---

## Bước 1 — Chạy SQL Migration

Vào **Supabase Dashboard → SQL Editor**, paste toàn bộ nội dung file sau rồi nhấn **Run**:

```
supabase/migration_webhook_withdraw.sql
```

Sau khi chạy sẽ thấy kết quả query cuối hiển thị 3 cột `fail_reason`, `status`, `to_wallet` — nghĩa là OK.

---

## Bước 2 — Cài Supabase CLI & Deploy Edge Function

Chạy lần lượt trên terminal (máy local):

```bash
# Cài Supabase CLI
npm install -g supabase

# Đăng nhập (mở browser tự động)
supabase login

# Link project — lấy project-ref tại: Dashboard → Settings → General → Reference ID
supabase link --project-ref xblsdppxltvyvlvxsrkn

# Deploy Edge Function
supabase functions deploy process-withdrawal
```

Sau khi deploy xong, vào **Supabase → Edge Functions** sẽ thấy `process-withdrawal` xuất hiện.

---

## Bước 3 — Set Secrets cho Edge Function

> ⚠️ Supabase CLI **không cho phép** tên secret bắt đầu bằng `SUPABASE_` — dùng đúng tên như bên dưới.

```bash
# Seed phrase 24 từ của ví admin (ví này sẽ gửi TON cho user)
supabase secrets set ADMIN_MNEMONIC="word1 word2 word3 ... word24"

# Service Role Key — lấy tại: Dashboard → Settings → API → service_role (secret)
# ⚠️ KHÔNG dùng tên SUPABASE_SERVICE_KEY — CLI sẽ báo lỗi và bỏ qua
supabase secrets set SERVICE_KEY=eyJhbGci...

# Mạng TON — đổi thành mainnet khi ra production
supabase secrets set TON_NETWORK=testnet

# Chuỗi bất kỳ bạn tự đặt — dùng để xác thực webhook
supabase secrets set WEBHOOK_SECRET=chuoi_random_cua_ban

# Optional nhưng khuyến khích — tránh bị rate limit TonCenter
supabase secrets set TON_API_KEY=your_toncenter_api_key
```

Kiểm tra đã set đủ chưa:

```bash
supabase secrets list
```

Phải thấy đủ: `ADMIN_MNEMONIC`, `SERVICE_KEY`, `TON_NETWORK`, `WEBHOOK_SECRET`.

---

## Bước 4 — Tạo Database Webhook

Vào **Supabase Dashboard → Database → Webhooks → Create a new hook**, điền như sau:

| Field | Value |
|-------|-------|
| Name | `trigger-withdrawal` |
| Table | `transactions` |
| Events | ✅ **INSERT** (chỉ INSERT, bỏ UPDATE/DELETE) |
| Type | Supabase Edge Functions |
| Edge Function | `process-withdrawal` |

Phần **HTTP Headers** — Supabase đã tự thêm sẵn 2 header mặc định:
```
Content-type:  application/json
Authorization: Bearer eyJ...
```

Bạn chỉ cần nhấn **+ Add header** và thêm 1 header nữa:
```
Key:   x-webhook-secret
Value: chuoi_random_cua_ban   ← đúng chuỗi đã set ở WEBHOOK_SECRET bước 3
```

Nhấn **Save**.

---

## Bước 5 — Test thử

1. Mở app, connect ví TON testnet → nhấn **Withdraw**, nhập số tiền nhỏ (ví dụ 0.01 TON)
2. Vào **Supabase → Table Editor → transactions** → thấy row mới `status: pending`
3. Vài giây sau → `status: processing` → `status: completed`
4. Xem log chi tiết tại **Supabase → Edge Functions → process-withdrawal → Logs**

---

## Xử lý lỗi thường gặp

**`supabaseKey is required`**
→ Secret `SERVICE_KEY` chưa được set. Chạy lại:
```bash
supabase secrets set SERVICE_KEY=eyJhbGci...
supabase functions deploy process-withdrawal
```

**`Env name cannot start with SUPABASE_`**
→ Đổi tên thành `SERVICE_KEY` (không có prefix `SUPABASE_`).

**Lệnh bị stuck ở `processing` > 3 phút** (Edge Function timeout)
→ Chạy trong SQL Editor để reset:
```sql
select retry_stuck_withdrawals();
```

**Status `failed`**
→ Xem cột `fail_reason` trong bảng `transactions`. Tiền đã được hoàn lại tự động.

**Status `sent`**
→ Tiền đã gửi đi nhưng blockchain chưa confirm trong 90s. Không cần làm gì, tiền vẫn đến ví user.

**Admin balance thấp**
→ Log sẽ hiện `Admin balance insufficient`. Nạp thêm TON vào ví admin là xong.

---

## Bảng trạng thái transaction

| Status | Ý nghĩa | Hành động |
|--------|---------|-----------|
| `pending` | Mới tạo, webhook chưa kịp fire | Tự động xử lý |
| `processing` | Edge Function đang chạy | Chờ tối đa 3 phút |
| `sent` | Đã gửi, chờ blockchain confirm | Tiền đang trên đường, OK |
| `completed` | Hoàn thành ✅ | — |
| `failed` | Thất bại, đã hoàn tiền | Xem `fail_reason` |

---

## Lưu ý bảo mật

- **Không commit** `ADMIN_MNEMONIC` hay `SERVICE_KEY` lên GitHub
- `WEBHOOK_SECRET` ngăn người ngoài gọi thẳng vào Edge Function
- Edge Function dùng **CAS (Compare-And-Swap)** — nếu webhook fire 2 lần, lần 2 sẽ bị bỏ qua, không gửi TON 2 lần
