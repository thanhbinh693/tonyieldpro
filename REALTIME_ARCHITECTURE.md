# TONYield — Kiến trúc Realtime (Tối ưu)

## Vấn đề cũ

| Vấn đề | Hậu quả |
|--------|---------|
| `setInterval(tick, 5000)` trong client | Mỗi user mở app → N request/giây lên DB |
| Profit tick trên client | Race condition multi-tab, drain battery, không đồng bộ |
| `lastSnapshot` + `applyingRemote` | Logic phức tạp, dễ lỗi |
| Poll DB mỗi 5s dù không có gì thay đổi | Lãng phí băng thông |

---

## Kiến trúc mới

```
┌─────────────────────────────────────────────────────┐
│  Supabase pg_cron (mỗi 1 phút)                      │
│       │                                             │
│       ▼                                             │
│  Edge Function: tick-profits                        │
│  • Query investments WHERE next_profit_time <= now  │
│  • credit_profit RPC (CAS — tránh double credit)    │
│  • Update DB: earned, balance, next_profit_time     │
│       │                                             │
│       ▼                                             │
│  Supabase Realtime (WebSocket)                      │
│  • postgres_changes event → push tới client         │
│       │                                             │
│       ▼                                             │
│  Client React                                       │
│  • Nhận WS event → getUserBundle → update state     │
│  • PlanRing: setInterval 1s chỉ force re-render     │
│    countdown tính từ nextProfitTime trong state      │
└─────────────────────────────────────────────────────┘
```

---

## Deploy

### 1. Edge Function

```bash
supabase functions deploy tick-profits --no-verify-jwt
```

### 2. Cron (pg_cron)

Vào **Supabase Dashboard → Database → Extensions** → bật `pg_cron` và `pg_net`.

Chạy `supabase/cron-setup.sql` trong **SQL Editor** (thay `<PROJECT_REF>` và `<SERVICE_ROLE_KEY>`).

### 3. Realtime

Đảm bảo **Supabase Dashboard → Database → Replication** đã bật Realtime cho các bảng:
- `users`
- `investments`
- `transactions`

---

## Lợi ích

| Trước | Sau |
|-------|-----|
| Client poll DB mỗi 5s | Server push qua WebSocket |
| N users × 5s = N×12 req/phút | 1 Edge Function/phút cho tất cả users |
| Race condition multi-tab | CAS RPC trong DB, idempotent |
| Battery drain (mobile) | Client chỉ render countdown local |
| `setInterval` phức tạp | `setTick` 1s đơn giản, không call DB |
| Lỗi stale state | DB là source of truth, WS sync |

---

## Luồng Activate Plan

```
User click [Activate]
     │
     ▼
Optimistic update (ngay lập tức)
• setInvestments: activated=true, nextProfitTime=now+intervalMs
• PlanRing bắt đầu đếm ngược liền
     │
     ▼ async
DB write: investments.activated=true, next_profit_time=...
     │
     ├── Success → Realtime confirm (không cần làm gì thêm)
     │
     └── Fail → Rollback optimistic update + showToast error
```

---

## Interval tick-profits

Mặc định pg_cron chạy mỗi **1 phút**. Nếu plan có `profitIntervalMinutes=5`, 
tick-profits sẽ bỏ qua investment đó trong 4/5 lần chạy (vì `next_profit_time > now`).
Không cần lo về hiệu năng — query chỉ fetch investments `WHERE next_profit_time <= now`.
