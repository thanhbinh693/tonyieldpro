# LuckyDrop Mine Bot — Logic dự án phiên bản TON Wallet

Tài liệu này viết lại toàn bộ logic hiện tại của dự án `LuckyDrop Mine Bot`, nhưng chuyển hạ tầng ví và thanh toán từ **USDT BEP20 / Binance Smart Chain** sang hệ sinh thái **TON Wallet / TON Blockchain**.

---

## 1. Mục tiêu dự án

Xây dựng một Telegram bot game “lì xì có mine” chạy bằng số dư nội bộ, trong đó tiền thật được nạp/rút qua mạng **TON**.

Bot cho phép người dùng:

- Tạo ví nạp tiền riêng trên TON.
- Nạp TON hoặc Jetton vào bot tự động.
- Rút tiền tự động về ví TON cá nhân.
- Tạo game lì xì / Lucky Drop.
- Tham gia Lucky Drop.
- Có cơ chế mine ẩn, thưởng/phạt tự động.
- Mời bạn bè bằng referral link.
- Admin quản lý user, số dư, fee, tỷ lệ mine và ví hệ thống.

---

## 2. Khái niệm chính

### 2.1 TON Wallet

Trong phiên bản TON, bot không dùng địa chỉ BEP20 nữa.

Thay vào đó, mỗi user có thể được định danh nạp tiền bằng một trong hai mô hình:

#### Mô hình A — Một hot wallet chung + memo/comment riêng

Bot sử dụng một ví TON chung:

```text
TON_HOT_WALLET
```

Mỗi user khi nạp sẽ nhận một mã nạp riêng:

```text
LD_<telegram_user_id>
```

User gửi TON hoặc Jetton đến ví hệ thống và bắt buộc nhập comment/memo.

Ví dụ:

```text
To: TON_HOT_WALLET
Amount: 10 TON
Comment: LD_7367805841
```

Ưu điểm:

- Dễ triển khai.
- Không cần tạo nhiều ví con.
- Không cần sweep nhiều ví.
- Chi phí vận hành thấp.

Nhược điểm:

- User phải nhập đúng comment.
- Nếu nhập sai comment thì cần admin xử lý thủ công.

#### Mô hình B — Mỗi user một TON wallet riêng

Bot tạo một ví TON riêng cho từng user từ mnemonic hoặc private key hệ thống.

Ví dụ:

```text
user_id = 7367805841
deposit_wallet = derive_ton_wallet(master_mnemonic, user_id)
```

Ưu điểm:

- User chỉ cần chuyển tiền đến địa chỉ riêng, không cần memo.
- Ít nhầm lẫn hơn.

Nhược điểm:

- Cần quản lý nhiều ví con.
- Cần cấp TON gas cho từng ví để sweep.
- Logic phức tạp hơn.

### Khuyến nghị

Nên dùng **Mô hình A: một hot wallet + memo/comment riêng** cho giai đoạn đầu.

Lý do:

- TON transaction hỗ trợ comment.
- Bot Telegram dễ hiển thị QR hoặc deeplink kèm comment.
- Không cần sweep ví con.
- Phù hợp với hệ thống game có ledger nội bộ.

---

## 3. Token sử dụng

Có hai lựa chọn tài sản:

### 3.1 Dùng TON native coin

Bot nhận/rút trực tiếp đồng TON.

Ưu điểm:

- Dễ triển khai.
- Không cần Jetton contract.
- Ít lỗi hơn.

Nhược điểm:

- Giá TON biến động.
- Nếu game muốn chạy theo USDT thì cần quy đổi giá.

### 3.2 Dùng Jetton, ví dụ USDT trên TON

Bot nhận/rút Jetton như:

```text
USDT Jetton trên TON
```

Ưu điểm:

- Số dư ổn định theo USD.
- Gần giống logic USDT BEP20 hiện tại.

Nhược điểm:

- Logic phức tạp hơn native TON.
- Cần đọc Jetton transfer event.
- Rút Jetton cần tương tác với Jetton wallet contract.

### Khuyến nghị

Nếu muốn giữ logic cũ “USDT game”, nên dùng:

```text
USDT Jetton trên TON
```

Nếu muốn đơn giản và triển khai nhanh, dùng:

```text
TON native coin
```

Trong tài liệu này, logic sẽ được mô tả theo hướng tổng quát, có thể áp dụng cho cả **TON native** và **Jetton USDT**.

---

## 4. Cấu trúc project đề xuất

```text
luckydrop_ton_bot/
├── bot.py
├── config.py
├── database.py
├── ton_client.py
├── ton_wallet.py
├── deposit_monitor.py
├── withdraw_executor.py
├── handlers/
│   ├── user_handlers.py
│   └── admin_handlers.py
├── requirements.txt
├── README.md
└── .env
```

---

## 5. Biến môi trường

File `.env` nên chứa:

```env
BOT_TOKEN=

ADMIN_IDS=

DB_PATH=lixi_ton.db

# TON network
TON_NETWORK=mainnet
TON_API_BASE=https://toncenter.com/api/v2
TON_API_KEY=

# Hot wallet
TON_HOT_WALLET=
TON_HOT_WALLET_MNEMONIC=
TON_HOT_WALLET_PRIVATE_KEY=

# Asset mode: TON hoặc JETTON
ASSET_MODE=TON

# Nếu dùng Jetton
JETTON_MASTER_ADDRESS=
JETTON_DECIMALS=6

# Game settings
MIN_DEPOSIT=1
MIN_WITHDRAW=5
PRESET_AMOUNTS=1,5,10,20,50,100,200,500

DEFAULT_FEE_RATE=10
DEFAULT_CREATOR_WIN_RATE=30
REFERRAL_BONUS=0.5
```

---

## 6. Database schema

### 6.1 Bảng `users`

Lưu thông tin người dùng Telegram.

```sql
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    username        TEXT,
    full_name       TEXT,
    balance         REAL DEFAULT 0,
    referred_by     INTEGER DEFAULT NULL,
    deposit_memo    TEXT DEFAULT NULL,
    ton_wallet      TEXT DEFAULT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
);
```

Ý nghĩa:

| Field | Mô tả |
|---|---|
| `id` | Telegram user ID |
| `username` | Telegram username |
| `full_name` | Tên hiển thị |
| `balance` | Số dư nội bộ |
| `referred_by` | Người giới thiệu |
| `deposit_memo` | Mã nạp riêng nếu dùng hot wallet chung |
| `ton_wallet` | Ví TON riêng của user nếu dùng mô hình ví riêng |

---

### 6.2 Bảng `games`

Lưu các Lucky Drop.

```sql
CREATE TABLE IF NOT EXISTS games (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id  INTEGER NOT NULL,
    amount      REAL NOT NULL,
    mine_digit  INTEGER NOT NULL,
    status      TEXT DEFAULT 'open',
    slots       INTEGER DEFAULT 5,
    remaining   REAL NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (creator_id) REFERENCES users(id)
);
```

---

### 6.3 Bảng `game_members`

Lưu người tham gia từng game.

```sql
CREATE TABLE IF NOT EXISTS game_members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    received    REAL NOT NULL,
    displayed   REAL NOT NULL,
    is_mine     INTEGER DEFAULT 0,
    joined_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(game_id, user_id),
    FOREIGN KEY (game_id) REFERENCES games(id)
);
```

---

### 6.4 Bảng `transactions`

Lưu lịch sử giao dịch.

```sql
CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    type            TEXT NOT NULL,
    amount          REAL NOT NULL,
    asset           TEXT DEFAULT 'TON',
    note            TEXT,
    status          TEXT DEFAULT 'pending',
    chain_tx_hash   TEXT DEFAULT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    reviewed_by     INTEGER,
    reviewed_at     TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

Các `type` chính:

| Type | Mô tả |
|---|---|
| `deposit` | Nạp tiền |
| `withdraw` | Rút tiền |
| `game_send` | Tạo drop |
| `game_recv` | Nhận tiền từ drop |
| `mine_penalty` | Phạt do trúng mine |
| `mine_reward` | Thưởng cho chủ drop |
| `admin_adjust` | Admin chỉnh số dư |
| `admin_fee` | Fee thu từ game |
| `referral` | Hoa hồng giới thiệu |

---

### 6.5 Bảng `deposit_watchlist`

Theo dõi user đang chờ nạp.

```sql
CREATE TABLE IF NOT EXISTS deposit_watchlist (
    user_id      INTEGER PRIMARY KEY,
    since_lt     INTEGER DEFAULT 0,
    since_ts     INTEGER NOT NULL,
    memo         TEXT,
    last_tx_hash TEXT DEFAULT ''
);
```

Với TON, có thể dùng:

- `since_ts`: thời gian bắt đầu chờ nạp.
- `since_lt`: logical time của ví TON để chỉ scan transaction mới hơn.
- `memo`: comment user phải nhập khi nạp.

---

### 6.6 Bảng `processed_tx_hashes`

Chống cộng tiền trùng.

```sql
CREATE TABLE IF NOT EXISTS processed_tx_hashes (
    tx_hash     TEXT PRIMARY KEY,
    credited_at TEXT DEFAULT (datetime('now'))
);
```

---

### 6.7 Bảng `settings`

```sql
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

Default:

```sql
INSERT OR IGNORE INTO settings(key, value) VALUES ('fee_rate', '10');
INSERT OR IGNORE INTO settings(key, value) VALUES ('creator_win_rate', '30');
```

---

## 7. Luồng khởi động bot

File `bot.py` chịu trách nhiệm:

1. Load config.
2. Khởi tạo database.
3. Tạo Telegram application.
4. Đăng ký command handlers.
5. Đăng ký callback query handlers.
6. Đăng ký message handlers.
7. Tạo background job monitor nạp tiền TON.
8. Chạy polling.

Pseudo logic:

```python
def main():
    init_db()

    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("wallet", cmd_wallet))
    app.add_handler(CommandHandler("create_drop", cmd_create_drop))
    app.add_handler(CommandHandler("join_drop", cmd_join_drop))
    app.add_handler(CommandHandler("deposit", cmd_deposit))
    app.add_handler(CommandHandler("withdraw", cmd_withdraw))
    app.add_handler(CommandHandler("history", cmd_history))
    app.add_handler(CommandHandler("refer", cmd_refer))

    app.add_handler(CommandHandler("admin_panel", cmd_admin_panel))
    app.add_handler(CommandHandler("admin_user", cmd_admin_user))
    app.add_handler(CommandHandler("admin_balance", cmd_admin_balance))
    app.add_handler(CommandHandler("admin_stats", cmd_admin_stats))

    app.add_handler(CallbackQueryHandler(combined_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    app.job_queue.run_repeating(
        run_deposit_monitor,
        interval=30,
        first=10,
        name="ton_deposit_monitor"
    )

    app.run_polling()
```

---

## 8. User commands

### 8.1 `/start`

Logic:

1. Lấy thông tin Telegram user.
2. Nếu có referral argument dạng:

```text
/start ref_<user_id>
```

thì lưu `referred_by`.

3. Nếu user mới:
   - Tạo record trong bảng `users`.
   - Tạo `deposit_memo = LD_<user_id>`.
   - Nếu có referrer, cộng thưởng referral.

4. Hiển thị menu chính.

Menu chính:

```text
💰 My Wallet
📜 History
🎁 Create Drop
🧧 Join Drop
🏦 Deposit
💸 Withdraw
🎎 Refer Friends
⚙️ Admin Panel
```

Nếu không phải admin thì ẩn Admin Panel.

---

### 8.2 `/wallet`

Hiển thị:

- Tên user.
- Telegram ID.
- Số dư nội bộ.
- Asset đang dùng: TON hoặc USDT Jetton.
- Số người đã giới thiệu.
- Tổng referral earned.

Ví dụ:

```text
💰 My Wallet

👤 Name: Binh
🆔 ID: 7367805841
💵 Balance: 12.5 TON
🎎 Referrals: 3 friends
🎁 Referral Earned: 1.5 TON
```

---

### 8.3 `/refer`

Bot tạo link:

```text
https://t.me/<bot_username>?start=ref_<user_id>
```

Khi user mới vào bằng link này:

- Người giới thiệu được cộng `REFERRAL_BONUS`.
- Tạo transaction type `referral`.

---

## 9. Logic nạp tiền bằng TON Wallet

### 9.1 Deposit dùng hot wallet chung + memo

Khi user bấm `🏦 Deposit` hoặc dùng `/deposit`:

1. Bot đảm bảo user tồn tại trong DB.
2. Tạo hoặc lấy `deposit_memo`.

Ví dụ:

```text
LD_7367805841
```

3. Thêm user vào `deposit_watchlist`:

```text
user_id = 7367805841
since_ts = now
memo = LD_7367805841
```

4. Bot hiển thị hướng dẫn nạp:

```text
🏦 Deposit TON

Send TON to:

EQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

Amount: any amount >= 1 TON
Comment/Memo: LD_7367805841

⚠️ You must include the exact comment.
✅ Deposit will be credited automatically after confirmation.
```

5. Có thể hiển thị TON deeplink:

```text
ton://transfer/<TON_HOT_WALLET>?text=LD_7367805841
```

Nếu cần kèm amount:

```text
ton://transfer/<TON_HOT_WALLET>?amount=<nanoton_amount>&text=LD_7367805841
```

---

### 9.2 Deposit dùng ví riêng cho từng user

Nếu dùng mô hình ví riêng:

1. Bot derive hoặc tạo ví TON riêng cho user.
2. Lưu vào `users.ton_wallet`.
3. User gửi tiền vào địa chỉ đó.
4. Deposit monitor scan từng ví.
5. Khi phát hiện tiền mới, cộng số dư.
6. Nếu cần, sweep tiền về hot wallet.

Thông báo nạp:

```text
🏦 Deposit TON

Send TON to your personal deposit wallet:

EQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

No memo required.
Network: TON
Minimum deposit: 1 TON
```

---

## 10. Deposit monitor trên TON

File `deposit_monitor.py` chạy mỗi 30 giây.

### 10.1 Nếu dùng TON native

Monitor gọi TON API để lấy transaction mới của hot wallet.

Ví dụ với Toncenter:

```http
GET /api/v2/getTransactions
    ?address=<TON_HOT_WALLET>
    &limit=50
    &archival=true
```

Với mỗi transaction:

1. Kiểm tra transaction incoming.
2. Kiểm tra amount > 0.
3. Decode comment body.
4. Lấy memo/comment.
5. Tìm user trong watchlist có memo tương ứng.
6. Kiểm tra tx chưa xử lý.
7. Kiểm tra tx time >= `since_ts`.
8. Cộng số dư cho user.
9. Tạo transaction record.
10. Mark tx hash đã xử lý.
11. Xóa user khỏi watchlist.
12. Gửi thông báo Telegram cho user.

Pseudo logic:

```python
async def run_deposit_monitor(context):
    watchlist = get_watchlist()
    if not watchlist:
        return

    txs = await ton_client.get_transactions(TON_HOT_WALLET, limit=50)

    for tx in txs:
        tx_hash = tx["hash"]
        tx_time = tx["utime"]
        amount = tx["in_msg"]["value"]
        comment = decode_ton_comment(tx["in_msg"]["msg_data"])

        if is_tx_processed(tx_hash):
            continue

        matched = find_watchlist_by_memo(comment)
        if not matched:
            continue

        if tx_time < matched["since_ts"]:
            continue

        amount_coin = nano_to_ton(amount)

        if amount_coin < MIN_DEPOSIT:
            continue

        update_balance(matched["user_id"], amount_coin)
        create_tx(
            matched["user_id"],
            "deposit",
            amount_coin,
            note=f"TON deposit | tx: {tx_hash}",
            status="approved",
            chain_tx_hash=tx_hash
        )

        mark_tx_processed(tx_hash)
        remove_from_watchlist(matched["user_id"])

        await context.bot.send_message(
            matched["user_id"],
            f"✅ Deposit received: {amount_coin} TON"
        )
```

---

### 10.2 Nếu dùng Jetton USDT trên TON

Monitor cần đọc Jetton transfer notification.

Logic:

1. Lấy transaction của `TON_HOT_WALLET` hoặc Jetton wallet contract.
2. Parse message body theo chuẩn Jetton.
3. Nhận diện opcode transfer notification:

```text
0x7362d09c
```

4. Decode:
   - query_id
   - amount
   - sender
   - forward_payload/comment

5. Lấy comment/memo từ `forward_payload`.
6. Match memo với user.
7. Convert amount theo `JETTON_DECIMALS`.
8. Cộng balance.

Pseudo:

```python
if message.opcode == JETTON_TRANSFER_NOTIFICATION:
    jetton_amount = parse_jetton_amount(message.body)
    comment = parse_forward_payload_comment(message.body)

    user = find_user_by_deposit_memo(comment)

    if user and not is_tx_processed(tx_hash):
        amount = raw_to_asset(jetton_amount, JETTON_DECIMALS)
        credit_user(user.id, amount)
```

---

## 11. Logic rút tiền bằng TON Wallet

### 11.1 User flow

User bấm `💸 Withdraw` hoặc `/withdraw`.

Bot hỏi:

1. Số tiền muốn rút.
2. Địa chỉ ví TON nhận tiền.

Bot validate:

- Amount >= `MIN_WITHDRAW`.
- User balance đủ.
- Địa chỉ TON hợp lệ.
- Nếu dùng Jetton, hot wallet Jetton balance đủ.
- Hot wallet có TON để trả gas.

---

### 11.2 Native TON withdraw

Flow:

1. Trừ số dư user ngay.
2. Tạo transaction:

```text
type = withdraw
status = pending
amount = amount
```

3. Dùng hot wallet ký transaction gửi TON.
4. Nếu thành công:
   - status = approved
   - lưu `chain_tx_hash`
   - thông báo user.
5. Nếu thất bại:
   - hoàn tiền user.
   - status = rejected
   - lưu lỗi.

Pseudo:

```python
async def withdraw_ton(user_id, to_address, amount):
    user = get_user(user_id)

    if user.balance < amount:
        return error("Insufficient balance")

    update_balance(user_id, -amount)

    tx_id = create_tx(
        user_id=user_id,
        tx_type="withdraw",
        amount=amount,
        note=f"Withdraw TON to {to_address}",
        status="pending"
    )

    result = await ton_client.send_ton(
        to_address=to_address,
        amount=amount,
        comment=f"Withdraw #{tx_id}"
    )

    if result.success:
        approve_tx(tx_id, chain_tx_hash=result.tx_hash)
        notify_user_success()
    else:
        update_balance(user_id, amount)
        reject_tx(tx_id, error=result.error)
        notify_user_failed()
```

---

### 11.3 Jetton withdraw

Nếu dùng USDT Jetton trên TON, rút tiền là gửi Jetton transfer từ Jetton wallet của hot wallet.

Flow:

1. Tính raw amount:

```text
raw_amount = amount * 10^JETTON_DECIMALS
```

2. Build Jetton transfer message:

```text
opcode = 0x0f8a7ea5
query_id
amount
destination
response_destination
custom_payload
forward_ton_amount
forward_payload
```

3. Gửi message từ hot wallet đến Jetton wallet contract.
4. Theo dõi transaction hash.
5. Cập nhật DB.

Pseudo:

```python
async def send_jetton(to_address, amount):
    jetton_wallet = await get_hot_wallet_jetton_wallet()

    body = build_jetton_transfer_body(
        amount=asset_to_raw(amount),
        destination=to_address,
        response_destination=TON_HOT_WALLET,
        forward_ton_amount=1,
        forward_payload="LuckyDrop withdrawal"
    )

    result = await ton_client.send_internal_message(
        from_wallet=TON_HOT_WALLET,
        to=jetton_wallet,
        value=0.05,
        body=body
    )

    return result
```

---

## 12. Game logic — Lucky Drop

Game logic gần như giữ nguyên so với bản BSC.

### 12.1 Tạo drop

User chọn:

- Pool amount.
- Mine digit từ 0 đến 9.

Điều kiện:

- Amount >= minimum.
- User balance >= amount.

Flow:

1. Trừ số dư người tạo:

```text
balance -= amount
```

2. Tạo transaction:

```text
type = game_send
amount = -amount
```

3. Tính fee:

```text
fee = amount * fee_rate
real_pool = amount - fee
```

4. Tạo game:

```text
creator_id = user_id
amount = amount
mine_digit = mine_digit
slots = 5
remaining = real_pool
status = open
```

5. Ghi fee cho admin:

```text
type = admin_fee
amount = fee
```

6. Broadcast cho user khác.

Pseudo:

```python
def create_drop(user_id, amount, mine_digit):
    if amount < MIN_DEPOSIT:
        return error("Amount too small")

    user = get_user(user_id)
    if user.balance < amount:
        return error("Insufficient balance")

    fee_rate = get_fee_rate()
    fee = amount * fee_rate
    remaining = amount - fee

    update_balance(user_id, -amount)
    create_tx(user_id, "game_send", -amount)

    game_id = create_game(
        creator_id=user_id,
        amount=amount,
        mine_digit=mine_digit,
        remaining=remaining
    )

    for admin in ADMIN_IDS:
        create_tx(admin, "admin_fee", fee)

    return game_id
```

---

### 12.2 Tham gia drop

Điều kiện:

- Game tồn tại.
- Game đang open.
- User không phải creator.
- User chưa tham gia.
- Game chưa full.
- User balance >= `game.amount * 1.2`.

Tại sao cần `1.2x`?

Vì nếu user trúng mine, user phải trả penalty bằng:

```text
penalty = game.amount * 1.2
```

---

### 12.3 Tính tiền nhận được

Pool thật sau fee:

```text
real_pool = amount * (1 - fee_rate)
```

Nếu còn nhiều slot:

```text
received = random(min_take, max_take)
```

Nếu là slot cuối:

```text
received = remaining
```

Trong code hiện tại:

```text
max_take = remaining * 0.7
min_take = max(0.000001, remaining / 100)
```

Sau đó update:

```text
game.remaining -= received
```

---

### 12.4 Xác định mine

Có hai cách thiết kế.

#### Cách hiện tại

Không thực sự dùng `mine_digit` để so sánh số cuối. Bot dùng xác suất:

```text
creator_win_rate = 30%
is_mine = random(1, 100) <= creator_win_rate
```

Nghĩa là creator có 30% cơ hội thắng mỗi lượt join.

#### Cách đúng theo “mine digit”

Khi user nhận reward, lấy chữ số cuối hoặc random digit:

```text
draw_digit = random(0, 9)
is_mine = draw_digit == game.mine_digit
```

Xác suất mine tự nhiên là 10%.

Nếu muốn giữ tỷ lệ admin setting, có thể dùng:

```text
is_mine = random(1, 100) <= creator_win_rate
```

và chỉ hiển thị `mine_digit` như yếu tố game.

### Khuyến nghị

Nếu game quảng cáo là “chọn mine digit”, nên dùng logic:

```text
draw_digit = last_digit(displayed_amount) hoặc random digit 0-9
is_mine = draw_digit == mine_digit
```

Nếu muốn owner có lợi nhuận dự đoán được, giữ `creator_win_rate`.

---

### 12.5 Nếu không trúng mine

Flow:

1. Cộng `received` cho user.
2. Tạo transaction:

```text
type = game_recv
amount = received
```

3. Nếu game full thì đóng game.
4. Thông báo user thắng.

---

### 12.6 Nếu trúng mine

Flow:

1. Tính penalty:

```text
penalty = game.amount * 1.2
```

2. Trừ user:

```text
user.balance -= penalty
```

3. Cộng cho creator:

```text
creator.balance += penalty
```

4. Tạo transaction:

```text
user:
type = mine_penalty
amount = -penalty

creator:
type = mine_reward
amount = penalty
```

5. Nếu game full thì đóng game.
6. Thông báo user.
7. Thông báo creator.

---

## 13. Referral logic

### 13.1 Tạo referral link

```text
https://t.me/<bot_username>?start=ref_<user_id>
```

---

### 13.2 User mới vào bằng referral

Flow:

1. Bot đọc argument `ref_<user_id>`.
2. Nếu user mới và referrer khác user:
   - Lưu `referred_by`.
   - Cộng referral bonus cho referrer.
   - Tạo transaction:

```text
type = referral
amount = REFERRAL_BONUS
status = approved
```

---

## 14. Admin panel

Admin có các chức năng:

```text
📊 Statistics
👤 Check User
💰 Adjust Balance
🎁 Drop List
⚙️ Settings
💸 Hot Wallet Status
```

Nếu dùng ví riêng cho từng user, thêm:

```text
💸 Sweep User Wallets
```

---

### 14.1 Statistics

Hiển thị:

- Tổng user.
- Tổng drop.
- Drop đang open.
- Tổng số dư nội bộ.
- Fee đã thu.
- Referral count.
- Referral bonus đã trả.
- Tổng rút thành công.
- Hot wallet TON balance.
- Hot wallet Jetton balance nếu dùng Jetton.

---

### 14.2 Check User

Input:

```text
Telegram user ID
```

Output:

- User ID.
- Username.
- Full name.
- Balance.
- Deposit memo.
- TON wallet nếu có.
- Referred by.
- Referral count.

---

### 14.3 Adjust Balance

Admin nhập:

```text
user_id
amount_delta
```

Nếu `amount_delta > 0`:

```text
balance += amount_delta
```

Nếu `amount_delta < 0`:

```text
balance -= abs(amount_delta)
```

Tạo transaction:

```text
type = admin_adjust
```

---

### 14.4 Drop List

Hiển thị danh sách drop đang mở:

- Game ID.
- Creator.
- Amount.
- Remaining.
- Slots used.
- Slots left.
- Fee.

---

### 14.5 Settings

Admin chỉnh:

```text
fee_rate
creator_win_rate
```

Ví dụ:

```text
fee_rate = 10
creator_win_rate = 30
```

---

### 14.6 Hot Wallet Status

Hiển thị:

- Địa chỉ ví hot wallet.
- Số dư TON native.
- Số dư Jetton nếu có.
- Network.
- Last scanned transaction LT/hash.

---

## 15. TON client module

File `ton_client.py` nên đóng gói toàn bộ tương tác với TON API.

Các function đề xuất:

```python
async def get_wallet_transactions(address: str, limit: int = 50) -> list:
    pass

async def get_ton_balance(address: str) -> float:
    pass

async def get_jetton_balance(owner_address: str, jetton_master: str) -> float:
    pass

async def send_ton(to_address: str, amount: float, comment: str = "") -> dict:
    pass

async def send_jetton(to_address: str, amount: float, comment: str = "") -> dict:
    pass

def decode_transaction_comment(tx: dict) -> str:
    pass

def validate_ton_address(address: str) -> bool:
    pass

def nano_to_ton(value: int) -> float:
    return value / 1_000_000_000

def ton_to_nano(amount: float) -> int:
    return int(amount * 1_000_000_000)
```

---

## 16. ton_wallet.py

Nếu dùng mô hình ví riêng cho từng user, file này xử lý:

- Tạo mnemonic.
- Derive ví TON.
- Lấy public/private key.
- Build wallet contract.
- Sign transaction.

Function đề xuất:

```python
def derive_user_wallet(master_mnemonic: str, user_id: int) -> dict:
    return {
        "address": "...",
        "private_key": "...",
        "public_key": "..."
    }

def get_or_create_user_wallet(user_id: int) -> str:
    pass
```

Nếu dùng mô hình hot wallet + memo, file này có thể chỉ cần:

```python
def make_deposit_memo(user_id: int) -> str:
    return f"LD_{user_id}"
```

---

## 17. Withdraw executor

File `withdraw_executor.py` phụ trách rút tiền.

### Native TON:

```python
async def send_asset(to_address: str, amount: float) -> dict:
    return await send_ton(to_address, amount, comment="LuckyDrop withdrawal")
```

### Jetton:

```python
async def send_asset(to_address: str, amount: float) -> dict:
    return await send_jetton(to_address, amount, comment="LuckyDrop withdrawal")
```

Output chuẩn:

```python
{
    "success": True,
    "tx_hash": "..."
}
```

Hoặc:

```python
{
    "success": False,
    "error": "..."
}
```

---

## 18. User message state machine

Bot dùng state trong `ctx.bot_data`.

### 18.1 Create Drop states

```text
create_drop_amount
create_drop_custom_amount
create_drop_digit
```

Flow:

1. User chọn Create Drop.
2. Bot hỏi amount.
3. User chọn preset hoặc nhập custom.
4. Bot hỏi mine digit.
5. Bot tạo game.

---

### 18.2 Withdraw states

```text
withdraw_amount
withdraw_wallet
```

Flow:

1. User chọn Withdraw.
2. Bot hỏi amount.
3. Validate amount.
4. Bot hỏi ví TON.
5. Validate address.
6. Gọi withdraw executor.

---

### 18.3 Admin states

```text
admin_check_user
admin_adjust_user_id
admin_adjust_amount
admin_set_fee
admin_set_win_rate
```

---

## 19. Inline callback logic

Các callback chính:

```text
refresh_drops
join_<game_id>
lock_<game_id>
adm_...
```

### `join_<game_id>`

1. Parse game ID.
2. Kiểm tra game.
3. Gọi `_do_join_drop`.
4. Refresh danh sách drop.

### `lock_<game_id>`

User không đủ tiền.

Bot trả alert:

```text
Need 12 TON — short by 3 TON
```

---

## 20. Định dạng số tiền

Nếu dùng TON:

```python
def fmt_asset(amount):
    return f"{amount:.4f} TON"
```

Nếu dùng USDT Jetton:

```python
def fmt_asset(amount):
    return f"{amount:.2f} USDT"
```

Nên dùng cấu hình:

```python
ASSET_SYMBOL = "TON" hoặc "USDT"
ASSET_DECIMALS = 9 hoặc 6
```

---

## 21. Bảo mật

### 21.1 Không hardcode private key

Không được để trong source code:

```python
BOT_TOKEN = "..."
TON_HOT_WALLET_PRIVATE_KEY = "..."
TON_HOT_WALLET_MNEMONIC = "..."
```

Phải dùng `.env`.

---

### 21.2 Không commit `.env`

Thêm `.gitignore`:

```gitignore
.env
*.db
__pycache__/
```

---

### 21.3 Hot wallet risk

Hot wallet có quyền gửi toàn bộ tiền thật.

Cần:

- Chạy bot trên server riêng.
- Chỉ admin tin cậy có quyền truy cập.
- Giới hạn số dư hot wallet nếu cần.
- Backup mnemonic/private key offline.
- Theo dõi transaction bất thường.

---

### 21.4 Validate withdrawal address

Trước khi rút:

- Check address đúng chuẩn TON.
- Không cho rút về địa chỉ rỗng.
- Nếu dùng Jetton, đảm bảo address có thể nhận Jetton.

---

### 21.5 Idempotency

Mọi transaction on-chain phải được chống xử lý trùng:

```text
processed_tx_hashes
```

Không cộng tiền nếu tx hash đã tồn tại.

---

## 22. Lỗi cần xử lý

### 22.1 Deposit thiếu memo

Nếu user gửi vào hot wallet nhưng không có memo:

- Không thể tự động xác định user.
- Ghi vào bảng hoặc log `unmatched_deposits`.
- Admin tra cứu và credit thủ công.

Schema gợi ý:

```sql
CREATE TABLE IF NOT EXISTS unmatched_deposits (
    tx_hash     TEXT PRIMARY KEY,
    amount      REAL NOT NULL,
    sender      TEXT,
    comment     TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    resolved    INTEGER DEFAULT 0
);
```

---

### 22.2 Deposit memo sai

Nếu comment không match user nào:

- Lưu unmatched.
- Admin xử lý.

---

### 22.3 API downtime

Nếu TON API lỗi:

- Không xóa watchlist.
- Log lỗi.
- Retry vòng sau.

---

### 22.4 Withdraw fail

Nếu rút thất bại:

- Hoàn tiền user.
- Mark tx `rejected`.
- Lưu error trong note.
- Thông báo user.

---

### 22.5 Hot wallet thiếu tiền

Nếu ledger nội bộ có đủ nhưng hot wallet thiếu tiền thật:

- Withdraw fail.
- Hoàn tiền user.
- Admin cần kiểm tra treasury.

---

### 22.6 Hot wallet thiếu gas

Với TON, ví cần TON để trả phí giao dịch.

Nếu dùng Jetton:

- Hot wallet vẫn cần TON native để gửi Jetton transfer.
- Nếu thiếu TON gas, rút Jetton sẽ fail.

---

## 23. Luồng tổng quát

### 23.1 Nạp tiền

```text
User bấm Deposit
    ↓
Bot tạo/lấy deposit memo
    ↓
Bot hiển thị TON_HOT_WALLET + memo
    ↓
User gửi TON/Jetton có comment
    ↓
Deposit monitor scan transaction mới
    ↓
Decode comment
    ↓
Match memo với user
    ↓
Kiểm tra tx chưa xử lý
    ↓
Cộng balance
    ↓
Tạo transaction deposit
    ↓
Mark processed
    ↓
Notify user
```

---

### 23.2 Rút tiền

```text
User bấm Withdraw
    ↓
Bot hỏi amount
    ↓
Bot hỏi TON wallet
    ↓
Validate balance + address
    ↓
Trừ balance
    ↓
Tạo tx pending
    ↓
Send TON/Jetton từ hot wallet
    ↓
Nếu thành công:
        tx approved + save chain hash
        notify user
Nếu thất bại:
        refund balance
        tx rejected
        notify user
```

---

### 23.3 Tạo drop

```text
User bấm Create Drop
    ↓
Chọn amount
    ↓
Chọn mine digit
    ↓
Check balance
    ↓
Trừ balance creator
    ↓
Tính fee
    ↓
Tạo game open
    ↓
Ghi admin fee
    ↓
Broadcast drop
```

---

### 23.4 Join drop

```text
User bấm Join Drop
    ↓
Bot hiển thị drop list
    ↓
User chọn drop
    ↓
Check đủ balance >= 1.2x amount
    ↓
Random reward
    ↓
Random mine result
    ↓
Nếu safe:
        cộng reward cho user
Nếu mine:
        trừ penalty user
        cộng penalty creator
    ↓
Lưu game member
    ↓
Nếu full thì close game
    ↓
Notify user/creator
```

---

## 24. Dependencies đề xuất

Nếu dùng Python:

```txt
python-telegram-bot[job-queue]>=20.0
python-dotenv>=1.0.0
aiohttp>=3.9.0
tonsdk>=1.0.13
pytonlib>=0.0.63
```

Nếu dùng Toncenter API đơn giản, có thể chỉ cần:

```txt
python-telegram-bot[job-queue]>=20.0
python-dotenv>=1.0.0
aiohttp>=3.9.0
tonsdk>=1.0.13
```

---

## 25. Mapping từ bản BSC hiện tại sang bản TON

| Bản hiện tại BSC | Bản mới TON |
|---|---|
| `USDT_WALLET` | `TON_HOT_WALLET` |
| `WITHDRAW_PRIVATE_KEY` | `TON_HOT_WALLET_MNEMONIC` hoặc private key |
| `BSC_RPC_URL` | `TON_API_BASE` / Toncenter / TonAPI |
| `ETHERSCAN_API` | `TON_API_KEY` |
| `USDT_CONTRACT` | `JETTON_MASTER_ADDRESS` nếu dùng Jetton |
| `hd_wallet.py` derive ETH address | `ton_wallet.py` tạo memo hoặc derive TON wallet |
| `deposit_monitor.py` scan Etherscan tokentx | scan TON transactions / Jetton events |
| `withdraw_executor.py` web3 transfer USDT | send TON transfer hoặc Jetton transfer |
| BEP20 address `0x...` | TON address `EQ...`, `UQ...` |
| `processed_tx_hashes` | giữ nguyên |
| `deposit_watchlist` | thêm memo / since_lt |
| Sweep HD wallets | không cần nếu dùng hot wallet + memo |

---

## 26. Khuyến nghị triển khai thực tế

Nên triển khai theo thứ tự:

1. Chuyển config sang TON.
2. Thêm `ton_client.py`.
3. Đổi database:
   - Thêm `deposit_memo`.
   - Thêm `chain_tx_hash`.
   - Thêm `asset`.
4. Đổi `/deposit`:
   - Hiển thị hot wallet + memo.
5. Đổi `deposit_monitor.py`:
   - Scan TON transaction.
   - Decode comment.
   - Credit user.
6. Đổi `/withdraw`:
   - Validate TON address.
7. Đổi `withdraw_executor.py`:
   - Gửi TON hoặc Jetton.
8. Giữ nguyên game logic.
9. Giữ nguyên admin logic, thêm Hot Wallet Status.
10. Test trên TON testnet trước mainnet.

---

## 27. Test cases cần có

### Deposit

- Nạp đúng memo.
- Nạp thiếu memo.
- Nạp sai memo.
- Nạp dưới minimum.
- Một user nạp nhiều lần.
- Cùng một tx không bị cộng trùng.
- TON API lỗi tạm thời.

### Withdraw

- Rút hợp lệ.
- Rút dưới minimum.
- Rút quá balance.
- Ví TON sai định dạng.
- Hot wallet thiếu tiền.
- Hot wallet thiếu gas.
- TON API lỗi.
- Send transaction thành công nhưng callback chậm.

### Game

- Tạo drop thiếu balance.
- Tạo drop amount nhỏ hơn min.
- Join drop của chính mình.
- Join drop 2 lần.
- Join khi không đủ 1.2x.
- Drop full thì tự đóng.
- Safe result cộng tiền đúng.
- Mine result trừ/cộng đúng.
- Fee admin đúng.

### Admin

- Non-admin không truy cập được.
- Check user đúng.
- Adjust balance đúng.
- Settings lưu đúng.
- Statistics đúng.

---

## 28. Kết luận

Phiên bản TON của LuckyDrop Mine Bot nên giữ nguyên phần game, referral, admin và ledger nội bộ. Phần cần thay đổi chính là lớp blockchain:

```text
BSC / USDT BEP20
    ↓
TON Wallet / TON native hoặc USDT Jetton
```

Thiết kế khuyến nghị là:

```text
Hot wallet chung + deposit memo riêng cho từng user
```

Mô hình này đơn giản, dễ vận hành, không cần sweep ví con và phù hợp nhất với Telegram bot chạy trên TON.