# TonYield Deployment Guide

## 1. Supabase database

1. Open Supabase Dashboard -> SQL Editor.
2. Paste and run the full contents of `supabase_unified.sql`.
3. Confirm Realtime includes:
   - `users`
   - `investments`
   - `transactions`

## 2. Supabase Edge Functions

Install/login/link:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
```

Set secrets:

```bash
supabase secrets set ADMIN_MNEMONIC="word1 word2 ... word24"
supabase secrets set TON_NETWORK=testnet
supabase secrets set TON_API_KEY="<TONCENTER_API_KEY>"
supabase secrets set WEBHOOK_SECRET="<RANDOM_SECRET>"
supabase secrets set TELEGRAM_BOT_TOKEN="<BOT_TOKEN>"
```

Deploy functions:

```bash
supabase functions deploy tick-profits --no-verify-jwt
supabase functions deploy credit-referral --no-verify-jwt
supabase functions deploy telegram-webhook --no-verify-jwt
supabase functions deploy process-withdrawal --no-verify-jwt
```

## 3. Supabase webhooks and cron

Database webhook for automatic withdraw:

- Table: `transactions`
- Event: `INSERT`
- URL: `https://<PROJECT_REF>.supabase.co/functions/v1/process-withdrawal`
- Header: `x-webhook-secret: <WEBHOOK_SECRET>`

Telegram referral webhook:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook\"}"
```

Profit cron can call:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/tick-profits
```

Schedule it every minute in Supabase Cron or another trusted scheduler.

## 4. Frontend config

Update `src/utils/config.js`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- fallback `ADMIN_WALLET`
- fallback `TON_NETWORK`
- fallback `ADMIN_IDS`

Then set admin settings inside the app Admin Panel:

- Admin wallet testnet
- Admin wallet mainnet
- Admin Telegram IDs
- Bot username
- Referral percent
- Minimum withdraw
- TON network

For mainnet, also update Supabase secret:

```bash
supabase secrets set TON_NETWORK=mainnet
```

and redeploy `process-withdrawal` if you changed wallet behavior:

```bash
supabase functions deploy process-withdrawal --no-verify-jwt
```

## 5. Git and Vercel

Commit and push:

```bash
git add .
git commit -m "Sync webhook websocket referral database admin"
git branch -M main
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main
```

Vercel:

- Import the GitHub repo.
- Framework preset: `Vite`.
- Install command: `npm install`.
- Build command: `npm run build`.
- Output directory: `dist`.

After deploy, update `public/tonconnect-manifest.json` and `src/main.jsx` manifest URL if your production domain changed.

## 6. Smoke test

1. Open the app in Telegram WebApp.
2. Connect wallet on the selected network.
3. Deposit a small amount.
4. Confirm `transactions`, `investments`, and `users.total_deposit` update.
5. Check invited referrer receives a `referral` transaction every deposit.
6. Activate an investment and wait for `tick-profits`.
7. Submit withdraw and confirm database webhook moves it from `pending` to `processing/completed`.
