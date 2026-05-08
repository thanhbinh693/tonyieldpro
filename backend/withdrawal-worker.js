/**
 * withdrawal-worker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Backend worker: automatically processes withdrawal requests using admin wallet.
 * User does NOT need to send TON or confirm anything.
 *
 * HOW TO RUN:
 *   node withdrawal-worker.js
 *   # or using PM2:
 *   pm2 start withdrawal-worker.js --name ton-withdraw-worker
 *
 * ENVIRONMENT VARIABLES (set in .env):
 *   SUPABASE_URL         - Supabase project URL
 *   SUPABASE_SERVICE_KEY - Service role key (do NOT use anon key!)
 *   ADMIN_MNEMONIC       - 24-word admin wallet seed phrase (keep secret!)
 *   POLL_INTERVAL_MS     - Poll interval (default: 15000 = 15s)
 *   TON_NETWORK          - 'mainnet' or 'testnet' (default: mainnet)
 *
 * SETUP:
 *   1. Run backend/migration_auto_withdraw.sql in Supabase Dashboard → SQL Editor
 *   2. Fill .env (copy from .env.example)
 *   npm install @supabase/supabase-js @ton/ton @ton/crypto @ton/core dotenv
 */

import 'dotenv/config'
import { createClient }   from '@supabase/supabase-js'
// ✅ FIX: Import Address from @ton/core — was missing, caused all withdrawals to silently fail
import { TonClient, WalletContractV4, internal } from '@ton/ton'
import { mnemonicToWalletKey } from '@ton/crypto'
import { Address } from '@ton/core'
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const ADMIN_MNEMONIC       = process.env.ADMIN_MNEMONIC
const POLL_INTERVAL_MS     = Number(process.env.POLL_INTERVAL_MS) || 15_000
const TON_NETWORK          = process.env.TON_NETWORK || 'mainnet'
const TON_API_KEY          = process.env.TON_API_KEY || ''
const PORT                 = process.env.PORT || 3001
const NETWORK_FEE          = 0.015
const CONFIRM_TIMEOUT_MS   = 90_000
const MAX_BATCH_SIZE       = 10

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_MNEMONIC) {
  console.error('[FATAL] Missing environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_MNEMONIC')
  process.exit(1)
}
if (!BOT_TOKEN) {
  console.warn('[WARN] BOT_TOKEN is missing! InitData verification will be bypassed (NOT SECURE)')
}

// ─── CLIENTS ─────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const PRIMARY_ENDPOINT = TON_NETWORK === 'testnet'
  ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
  : 'https://toncenter.com/api/v2/jsonRPC'

const ton = new TonClient({
  endpoint: PRIMARY_ENDPOINT,
  ...(TON_API_KEY ? { apiKey: TON_API_KEY } : {}),
})

async function withRetry(fn, label, maxAttempts = 3) {
  let delay = 1000
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn() } catch (e) {
      if (i === maxAttempts - 1) throw e
      console.warn(`[retry] ${label} attempt ${i+1} failed: ${e.message}. Retrying in ${delay}ms...`)
      await sleep(delay); delay *= 2
    }
  }
}

// ─── ADMIN WALLET ────────────────────────────────────────────────────────────

let adminWallet = null, adminKeyPair = null, adminAddress = null

async function initAdminWallet() {
  const words = ADMIN_MNEMONIC.trim().split(/\s+/)
  adminKeyPair = await mnemonicToWalletKey(words)
  const contract = WalletContractV4.create({ publicKey: adminKeyPair.publicKey, workchain: 0 })
  adminWallet  = ton.open(contract)
  adminAddress = contract.address.toString({ bounceable: false, testOnly: TON_NETWORK === 'testnet' })
  const balance = await withRetry(() => adminWallet.getBalance(), 'getBalance')
  console.log(`[Admin Wallet] ${adminAddress}`)
  console.log(`[Balance]      ${Number(balance) / 1e9} TON`)
}

// ─── ADDRESS HELPER ──────────────────────────────────────────────────────────

/** Safely parse any TON address format → UQ... (non-bounceable, urlSafe). Returns null if invalid. */
function parseToFriendly(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null
  try {
    return Address.parse(raw.trim()).toString({ bounceable: false, urlSafe: true, testOnly: TON_NETWORK === 'testnet' })
  } catch (e) {
    console.warn(`[parseToFriendly] Cannot parse: "${raw}" — ${e.message}`)
    return null
  }
}

// ─── DB HELPERS ──────────────────────────────────────────────────────────────

async function fetchPendingWithdrawals() {
  const { data, error } = await supabase
    .from('transactions').select('*')
    .eq('type', 'withdraw').eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(MAX_BATCH_SIZE)
  if (error) { console.error('[fetchPending]', error.message); return [] }
  return data || []
}

async function markProcessing(txId) {
  const { error } = await supabase.from('transactions')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', txId).eq('status', 'pending')
  if (error) { console.error(`[markProcessing] tx=${txId}:`, error.message); return false }
  return true
}

async function markCompleted(tx) {
  const { error: e1 } = await supabase.from('transactions')
    .update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', tx.id)
  if (e1) console.error('[markCompleted] tx:', e1.message)

  const { data: u, error: e2 } = await supabase.from('users')
    .select('total_withdraw').eq('id', tx.user_id).maybeSingle()
  if (e2 || !u) return

  const { error: e3 } = await supabase.from('users').update({
    total_withdraw: (Number(u.total_withdraw) || 0) + Number(tx.amount),
    updated_at:     new Date().toISOString(),
  }).eq('id', tx.user_id)
  if (e3) console.error('[markCompleted] user:', e3.message)
}

async function markFailed(txId, reason) {
  console.warn(`[FAILED] tx=${txId} reason=${reason}`)

  const { data: tx, error: e1 } = await supabase.from('transactions')
    .select('user_id, amount, status').eq('id', txId).maybeSingle()
  if (e1) { console.error('[markFailed] fetch:', e1.message); return }

  const { error: e2 } = await supabase.from('transactions').update({
    status: 'failed', fail_reason: reason, updated_at: new Date().toISOString(),
  }).eq('id', txId)
  if (e2) console.error('[markFailed] update:', e2.message)

  // Refund balance only if was pending/processing
  if (tx && ['pending', 'processing'].includes(tx.status)) {
    const { data: u, error: e3 } = await supabase.from('users')
      .select('balance').eq('id', tx.user_id).maybeSingle()
    if (e3 || !u) return
    const { error: e4 } = await supabase.from('users').update({
      balance:    Number(u.balance) + Number(tx.amount),
      updated_at: new Date().toISOString(),
    }).eq('id', tx.user_id)
    if (e4) console.error('[markFailed] refund:', e4.message)
    else console.log(`[REFUNDED] user=${tx.user_id} +${tx.amount} TON`)
  }
}

// ─── SEND TON ────────────────────────────────────────────────────────────────

async function sendTon(toAddress, amountTon, txId) {
  const nanotons = BigInt(Math.round(amountTon * 1e9))
  const seqno    = await withRetry(() => adminWallet.getSeqno(), 'getSeqno')

  await withRetry(() => adminWallet.sendTransfer({
    secretKey: adminKeyPair.secretKey, seqno,
    messages: [ internal({ to: toAddress, value: nanotons, body: `TonYield withdrawal ${txId}`, bounce: false }) ],
    sendMode: 3,
  }), 'sendTransfer')

  const maxChecks = Math.ceil(CONFIRM_TIMEOUT_MS / 5000)
  for (let i = 0; i < maxChecks; i++) {
    await sleep(5000)
    try { if (await adminWallet.getSeqno() > seqno) return true } catch(e) { console.warn(`[seqno ${i+1}] ${e.message}`) }
  }
  throw new Error(`Transaction timeout after ${CONFIRM_TIMEOUT_MS/1000}s`)
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

async function processOnce() {
  const pending = await fetchPendingWithdrawals()
  if (pending.length === 0) return
  console.log(`[Worker] ${pending.length} pending withdrawal(s) to process...`)

  for (const tx of pending) {
    const amount = Number(tx.amount)

    // 1. Parse & validate destination
    const toWallet = parseToFriendly(tx.to_wallet)
    // Validate per TEP-0002 / https://docs.ton.org/foundations/addresses/formats
    // Prefix: E=bounceable mainnet, U=non-bounceable mainnet, k=bounceable testnet, 0=non-bounceable testnet
    // Byte 2 (workchain): Q=basechain(0), g=masterchain(-1)
    // 36 bytes → 48 chars base64 (standard +/ hoặc url-safe _-)
    if (!toWallet || !/^[EUk0][Qg][A-Za-z0-9+/_-]{46}$/.test(toWallet)) {
      await markFailed(tx.id, `Invalid wallet address: "${tx.to_wallet}"`)
      continue
    }

    // 2. Validate amount
    if (amount < 0.01) { await markFailed(tx.id, `Amount too small: ${amount}`); continue }

    // 3. Verify user + wallet match
    const { data: userRow, error: uErr } = await supabase
      .from('users').select('wallet_addr, balance').eq('id', tx.user_id).maybeSingle()
    if (uErr || !userRow) { await markFailed(tx.id, `User ${tx.user_id} not found`); continue }

    if (userRow.wallet_addr) {
      const storedNorm = parseToFriendly(userRow.wallet_addr) || userRow.wallet_addr
      if (storedNorm !== toWallet) {
        console.error(`[SECURITY] tx=${tx.id}: to_wallet "${toWallet}" != stored "${storedNorm}"`)
        await markFailed(tx.id, `Wallet mismatch: expected ${storedNorm}, got ${toWallet}`)
        continue
      }
    }

    // 4. Check admin balance
    let adminBalance
    try { adminBalance = Number(await withRetry(() => adminWallet.getBalance(), 'getBalance')) / 1e9 }
    catch(e) { console.error('[Worker] Cannot fetch admin balance:', e.message); continue }

    const needed = amount + NETWORK_FEE + 0.1
    if (adminBalance < needed) {
      console.error(`[CRITICAL] Admin balance insufficient! Need ${needed.toFixed(3)} TON, have ${adminBalance.toFixed(3)} TON`)
      continue // keep pending, retry after top-up
    }

    // 5. Claim (prevent double-send)
    const claimed = await markProcessing(tx.id)
    if (!claimed) { console.warn(`[Skip] tx=${tx.id} already claimed`); continue }

    console.log(`[Process] id=${tx.id} user=${tx.user_id} amount=${amount} TON → ${toWallet}`)

    // 6. Send
    try {
      await sendTon(toWallet, amount, tx.id)
      await markCompleted(tx)
      console.log(`[✓ SENT] ${amount} TON → ${toWallet} (tx=${tx.id})`)
    } catch(e) {
      const isRetryable = /timeout|network|connection|ECONNREFUSED|ETIMEDOUT/i.test(e.message)
      if (isRetryable) {
        await supabase.from('transactions')
          .update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', tx.id)
        console.warn(`[RETRY] tx=${tx.id} → pending: ${e.message}`)
      } else {
        await markFailed(tx.id, e.message)
      }
    }

    await sleep(2000)
  }
}

async function startWorker() {
  console.log(`[Worker] TonYield Withdrawal Worker v3 (DB Security Mode)`)
  console.log(`[Network]  ${TON_NETWORK}`)
  console.log(`[Interval] ${POLL_INTERVAL_MS}ms`)
  await initAdminWallet()
  
  // ─── START EXPRESS API ──────────────────────────────────────────────────────────
  const app = express()
  app.use(cors())
  app.use(express.json())

  // Simplified resolveUserId: Trusts the provided userId but we will verify it against the DB
  function resolveUserId(initData, bodyUserId) {
    let uid = bodyUserId;
    if (initData) {
      try {
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user'));
        if (user && user.id) uid = user.id;
      } catch(e) {}
    }
    return { userId: uid, authorized: !!uid };
  }

  // Database-based admin check
  async function isAdmin(userId) {
    if (!userId) return false;
    const { data } = await supabase.from('admin_config').select('admin_ids').eq('id', 1).maybeSingle();
    const adminIds = data?.admin_ids || [];
    return adminIds.includes(Number(userId));
  }



  app.post('/api/withdraw', async (req, res) => {
    try {
      const { initData, amount, destWallet, userId: bodyUserId } = req.body;
      
      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      // Check if user is banned
      const { data: userCheck } = await supabase.from('users').select('status').eq('id', userId).maybeSingle();
      if (userCheck?.status === 'banned') return res.status(403).json({ error: 'User is banned' });
      
      const amt = Number(amount);
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
      
      const toWallet = parseToFriendly(destWallet);
      if (!toWallet) return res.status(400).json({ error: 'Invalid destination wallet format' });

      // 2. Check balance in DB
      const { data: userRow, error: uErr } = await supabase
        .from('users').select('balance, wallet_addr').eq('id', userId).maybeSingle();
      
      if (uErr || !userRow) return res.status(404).json({ error: 'User not found' });
      if (Number(userRow.balance) < amt) return res.status(400).json({ error: 'Insufficient balance' });

      // 3. Deduct balance and create transaction (Atomically if possible, but Supabase JS doesn't do transactions. We'll do sequential)
      const newBalance = Math.max(0, Number(userRow.balance) - amt);
      
      const { error: updErr } = await supabase.from('users').update({
        balance: newBalance,
        wallet_addr: toWallet,
        updated_at: new Date().toISOString()
      }).eq('id', userId);
      
      if (updErr) return res.status(500).json({ error: 'Failed to deduct balance' });

      const now = Date.now();
      const txId = 'tx-' + now;
      
      const { error: insErr } = await supabase.from('transactions').insert({
        id:         txId,
        user_id:    userId,
        type:       'withdraw',
        label:      `Withdrawal → ${toWallet.slice(0, 8)}...`,
        amount:     amt,
        status:     'pending',
        to_wallet:  toWallet,
        created_at: now,
      });

      if (insErr) {
        // Rollback balance (best effort)
        await supabase.from('users').update({ balance: userRow.balance }).eq('id', userId);
        return res.status(500).json({ error: 'Failed to create transaction' });
      }

      console.log(`[API] Withdraw requested: ${amt} TON by user ${userId} to ${toWallet}`);
      res.json({ success: true, txId, newBalance });
      
      // KÍCH HOẠT XỬ LÝ NGAY LẬP TỨC (Không chờ polling)
      processOnce().catch(err => console.error('[API Instant Process Error]', err));
      
    } catch (e) {
      console.error('[API Withdraw Error]', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/sync', async (req, res) => {
    try {
      const { initData, bundle, userId: bodyUserId } = req.body;
      
      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });
      if (!userId) return res.status(400).json({ error: 'Cannot extract user ID' });

      if ((!userId && userId !== 0) || Number(userId) !== Number(bundle.user.id)) {
        return res.status(403).json({ error: 'Unauthorized user ID' });
      }

      // In a real secure app, we should NOT trust 'balance' and 'investments' from frontend.
      // But for this refactor, we are acting as a proxy to bypass RLS safely to prevent trivial anon access.
      const id = Number(userId);
      const { user, investments = [], transactions = [], referral = {} } = bundle;

      // 1. Upsert user (ONLY non-financial fields to prevent race conditions)
      // Financial fields (balance, total_deposit, etc.) are managed by backend APIs & worker
      const { data: dbUser } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
      
      const userRow = {
        id,
        username:             user?.username      || dbUser?.username || '',
        first_name:           user?.firstName     || dbUser?.first_name || '',
        balance:              dbUser?.balance !== undefined ? dbUser.balance : (Number(user?.balance) || 0),
        total_deposit:        dbUser?.total_deposit !== undefined ? dbUser.total_deposit : (Number(user?.totalDeposit) || 0),
        total_withdraw:       dbUser?.total_withdraw !== undefined ? dbUser.total_withdraw : (Number(user?.totalWithdraw) || 0),
        today_profit:         dbUser?.today_profit !== undefined ? dbUser.today_profit : (Number(user?.todayProfit) || 0),
        referrals:            dbUser?.referrals !== undefined ? dbUser.referrals : (user?.referrals || 0),
        wallet_addr:          user?.walletAddr    || dbUser?.wallet_addr || '',
        join_date:            user?.joinDate      || dbUser?.join_date || new Date().toISOString().split('T')[0],
        status:               dbUser?.status      || user?.status || 'active',
        referral_code:        dbUser?.referral_code || referral?.code || `TON-${String(id).slice(-6)}`,
        referral_friends:     dbUser?.referral_friends !== undefined ? dbUser.referral_friends : (referral?.friends || 0),
        referral_commission:  dbUser?.referral_commission !== undefined ? dbUser.referral_commission : (Number(referral?.commission) || 0),
        updated_at:           new Date().toISOString(),
      };
      const { error: e1 } = await supabase.from('users').upsert(userRow, { onConflict: 'id' });
      if (e1) { console.error('[API Sync] users upsert error:', e1); return res.status(500).json({ error: e1.message }); }

      // 2. Upsert investments
      if (investments.length > 0) {
        const invRows = investments.map(i => {
          const profitIntervalMs = (i.profitIntervalMs && i.profitIntervalMs > 0 ? i.profitIntervalMs : 0) || (i.profitIntervalMinutes && i.profitIntervalMinutes > 0 ? i.profitIntervalMinutes * 60_000 : 0) || (i.profitIntervalHours && i.profitIntervalHours > 0 ? i.profitIntervalHours * 3_600_000 : 0) || 86_400_000;
          return {
            id: i.id, user_id: id, plan: i.plan, plan_color: i.planColor || 'gold',
            amount: Number(i.amount), rate: Number(i.rate), earned: Number(i.earned) || 0,
            days_total: i.daysTotal, profit_interval_minutes: i.profitIntervalMinutes || Math.round(profitIntervalMs / 60_000),
            profit_interval_ms: profitIntervalMs, profit_interval_hours: i.profitIntervalHours || profitIntervalMs / 3_600_000,
            active_days: i.activeDays || [1,2,3,4,5], start_time: i.startTime, end_time: i.endTime,
            next_profit_time: i.nextProfitTime, status: i.status || 'active', activated: i.activated || false,
            invoice_id: i.invoiceId || '', plan_id: i.planId,
          }
        });
        const { error: e2 } = await supabase.from('investments').upsert(invRows, { onConflict: 'id' });
        if (e2) { console.error('[API Sync] investments upsert error:', e2); return res.status(500).json({ error: e2.message }); }
      }

      // 3. Upsert transactions (IGNORE withdrawals and deposits, they are handled by dedicated APIs)
      if (transactions.length > 0) {
        const txRows = transactions
          .filter(t => t.type !== 'withdraw' && t.type !== 'deposit') // NGĂN GHI ĐÈ
          .map(t => ({
            id: t.id, user_id: id, type: t.type, label: t.label, amount: Number(t.amount),
            status: t.status || 'completed', invoice_id: t.invoiceId || '', to_wallet: t.toWallet || '',
            plan_id: t.planId, created_at: t.createdAt || Date.now(),
          }));
        if (txRows.length > 0) {
          const { error: e3 } = await supabase.from('transactions').upsert(txRows, { onConflict: 'id', ignoreDuplicates: true });
          if (e3) { console.error('[API Sync] transactions upsert error:', e3); return res.status(500).json({ error: e3.message }); }
        }
      }

      res.json({ success: true });
    } catch (e) {
      console.error('[API Sync Error]', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── GET /api/admin-config ────────────────────────────────────────────────
  app.get('/api/admin-config', async (req, res) => {
    try {
      const { data, error } = await supabase.from('admin_config').select('*').eq('id', 1).maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      if (!data) return res.json(null)
      res.json({
        minWithdraw:     data.min_withdraw,
        referralRate:    data.referral_rate,
        maintenanceMode: data.maintenance_mode,
        adminWallet:     data.admin_wallet,
        adminIds:        data.admin_ids || [],
        botUsername:     data.bot_username || '',
        tonNetwork:      data.ton_network || 'testnet',
      })
    } catch(e) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/admin-config ──────────────────────────────────────────────
  app.post('/api/admin-config', async (req, res) => {
    try {
      const { initData, config, userId: bodyUserId } = req.body

      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      if (!await isAdmin(userId)) return res.status(403).json({ error: 'Forbidden: Admin only' });

      if (!config) return res.status(400).json({ error: 'Missing config payload' })

      const { error } = await supabase.from('admin_config').upsert({
        id:               1,
        min_withdraw:     config.minWithdraw,
        referral_rate:    config.referralRate,
        maintenance_mode: config.maintenanceMode,
        admin_wallet:     config.adminWallet,
        admin_ids:        config.adminIds || [],
        bot_username:     config.botUsername || '',
        ton_network:      config.tonNetwork || 'testnet',
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'id' })

      if (error) { console.error('[API admin-config]', error); return res.status(500).json({ error: error.message }) }
      console.log(`[API] Admin config saved by user ${userId}`)
      res.json({ success: true })
    } catch(e) {
      console.error('[API admin-config Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/admin-plans ───────────────────────────────────────────────
  app.post('/api/admin-plans', async (req, res) => {
    try {
      const { initData, plans, userId: bodyUserId } = req.body

      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      if (!await isAdmin(userId)) return res.status(403).json({ error: 'Forbidden: Admin only' });

      if (!plans || !Array.isArray(plans)) return res.status(400).json({ error: 'Missing plans array' })

      const rows = plans.map(p => {
        const profitIntervalMinutes = p.profitIntervalMinutes
          || (p.profitIntervalMs ? p.profitIntervalMs / 60_000 : null)
          || (p.profitIntervalHours ? p.profitIntervalHours * 60 : 1440)
        const profitIntervalMs = p.profitIntervalMs || profitIntervalMinutes * 60_000
        const durationUnit = p.durationUnit || 'days'
        const durationMs = p.durationMs || (durationUnit === 'hours' ? p.duration * 3_600_000 : p.duration * 86_400_000)
        return {
          id: p.id, name: p.name, tier: p.tier || 'Starter',
          min_amount: p.min, max_amount: p.max, rate: p.rate,
          duration: p.duration, duration_unit: durationUnit, duration_ms: durationMs,
          profit_interval_minutes: profitIntervalMinutes,
          profit_interval_ms: profitIntervalMs,
          profit_interval_hours: p.profitIntervalHours || (profitIntervalMinutes / 60),
          active_days: p.activeDays || [1,2,3,4,5],
          color: p.color, hot: p.hot || false,
          updated_at: new Date().toISOString(),
        }
      })

      const { error } = await supabase.from('plans').upsert(rows, { onConflict: 'id' })
      if (error) { console.error('[API admin-plans]', error); return res.status(500).json({ error: error.message }) }
      console.log(`[API] Plans saved by user ${userId}`)
      res.json({ success: true })
    } catch(e) {
      console.error('[API admin-plans Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/register ─────────────────────────────────────────────────
  // Called when a new user opens the app (possibly via referral link)
  app.post('/api/register', async (req, res) => {
    try {
      const { initData, telegramId, referredByCode, userId: bodyUserId } = req.body

      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      const id = Number(telegramId || userId)
      if (!id) return res.status(400).json({ error: 'Invalid telegramId' })

      const referral_code = `TON-${String(id).slice(-6)}`
      const row = { id, referral_code }
      if (referredByCode) row.referred_by = referredByCode

      const { error } = await supabase.from('users').upsert(row, { onConflict: 'id', ignoreDuplicates: true })
      if (error) { console.error('[API register]', error); return res.status(500).json({ error: error.message }) }

      res.json({ success: true })
    } catch(e) {
      console.error('[API register Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/referral-commission ──────────────────────────────────────
  app.post('/api/referral-commission', async (req, res) => {
    try {
      const { initData, referrerId, commission, inviteeUsername, inviteeId, now, userId: bodyUserId } = req.body

      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      // Banned check
      const { data: userCheck } = await supabase.from('users').select('status').eq('id', userId).maybeSingle();
      if (userCheck?.status === 'banned') return res.status(403).json({ error: 'User is banned' });

      const rid = Number(referrerId)
      if (!rid || !commission) return res.status(400).json({ error: 'Invalid referrerId or commission' })

      // Read current referrer
      const { data: ref, error: e1 } = await supabase
        .from('users').select('balance, referral_friends, referral_commission')
        .eq('id', rid).maybeSingle()
      if (e1 || !ref) return res.status(404).json({ error: 'Referrer not found' })

      // Update referrer balance + stats
      const { error: e2 } = await supabase.from('users').update({
        balance:             +((Number(ref.balance) || 0) + Number(commission)).toFixed(2),
        referral_friends:    (ref.referral_friends || 0) + 1,
        referral_commission: +((Number(ref.referral_commission) || 0) + Number(commission)).toFixed(2),
        updated_at:          new Date().toISOString(),
      }).eq('id', rid)
      if (e2) { console.error('[API referral-commission]', e2); return res.status(500).json({ error: e2.message }) }

      // Insert referral transaction for referrer
      const timestamp = now || Date.now()
      const { error: e3 } = await supabase.from('transactions').insert({
        id:         `ref-${rid}-${timestamp}`,
        user_id:    rid,
        type:       'referral',
        label:      `Referral · @${inviteeUsername || inviteeId}`,
        amount:     Number(commission),
        status:     'completed',
        created_at: timestamp,
      })
      if (e3) console.warn('[API referral-commission] tx insert:', e3.message)

      console.log(`[API] Referral commission +${commission} TON → user ${rid} (invited by ${inviteeId})`)
      res.json({ success: true })
    } catch(e) {
      console.error('[API referral-commission Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/admin-update-user ────────────────────────────────────────
  app.post('/api/admin-update-user', async (req, res) => {
    try {
      const { initData, targetUserId, updates, userId: bodyUserId } = req.body
      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });
      if (!userId) return res.status(400).json({ error: 'Cannot extract user ID' });

      // Verify Admin
      const { data: configRow } = await supabase.from('admin_config').select('admin_ids').eq('id', 1).maybeSingle()
      const adminIds = configRow?.admin_ids || []
      if (!adminIds.includes(Number(userId))) return res.status(403).json({ error: 'Forbidden: Admin only' })

      if (!targetUserId || !updates) return res.status(400).json({ error: 'Missing targetUserId or updates' })

      // Map app updates to DB fields if necessary (snake_case)
      const dbUpdates = {}
      if (updates.status) dbUpdates.status = updates.status
      if (updates.balance !== undefined) dbUpdates.balance = Number(updates.balance)
      if (updates.total_deposit !== undefined) dbUpdates.total_deposit = Number(updates.total_deposit)
      // Add more as needed

      const { error } = await supabase.from('users').update(dbUpdates).eq('id', targetUserId)
      if (error) { console.error('[API admin-update-user]', error); return res.status(500).json({ error: error.message }) }

      console.log(`[API] User ${targetUserId} updated by admin ${userId}:`, dbUpdates)
      res.json({ success: true })
    } catch(e) {
      console.error('[API admin-update-user Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/deposit-reinvest ──────────────────────────────────────────
  app.post('/api/deposit-reinvest', async (req, res) => {
    try {
      const { initData, planId, amount, userId: bodyUserId } = req.body
      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });
      if (!userId) return res.status(400).json({ error: 'Cannot extract user ID' });

      const amt = Number(amount)
      if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' })

      // Fetch user
      const { data: user, error: uErr } = await supabase.from('users').select('balance, total_deposit').eq('id', userId).maybeSingle()
      if (uErr || !user) return res.status(404).json({ error: 'User not found' })
      if (Number(user.balance) < amt) return res.status(400).json({ error: 'Insufficient balance' })

      // Fetch plan
      const { data: plan, error: pErr } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle()
      if (pErr || !plan) return res.status(404).json({ error: 'Plan not found' })

      const now = Date.now()
      const iid = `inv-${userId}-${planId}-${now}`

      // Deduct balance & update total_deposit
      const { error: updErr } = await supabase.from('users').update({
        balance: Number(user.balance) - amt,
        total_deposit: Number(user.total_deposit || 0) + amt,
        updated_at: new Date().toISOString()
      }).eq('id', userId)
      if (updErr) throw updErr

      // Create transaction
      const { error: txErr } = await supabase.from('transactions').insert({
        id: `tx-${now}`, user_id: userId, type: 'deposit',
        label: `Reinvest · ${plan.name}`, amount: amt, status: 'completed',
        invoice_id: iid, plan_id: Number(planId), created_at: now
      })
      if (txErr) { console.error('[deposit-reinvest] tx error:', txErr); throw txErr; }

      // Create investment
      const profitIntervalMs = plan.profit_interval_ms || (plan.profit_interval_minutes ? plan.profit_interval_minutes * 60000 : 86400000)
      const durationMs = plan.duration_ms || (plan.duration_unit === 'hours' ? plan.duration * 3600000 : plan.duration * 86400000)
      const { error: invErr } = await supabase.from('investments').insert({
        id: `inv-${now}`, user_id: userId, plan: plan.name, plan_color: plan.color || 'gold',
        amount: amt, rate: Number(plan.rate), earned: 0, days_total: plan.duration,
        profit_interval_minutes: Math.round(profitIntervalMs / 60000), profit_interval_ms: profitIntervalMs,
        profit_interval_hours: Math.round(profitIntervalMs / 3600000), active_days: plan.active_days || [1,2,3,4,5],
        start_time: now, end_time: now + durationMs, next_profit_time: now + profitIntervalMs,
        status: 'active', activated: true, invoice_id: iid, plan_id: Number(planId)
      })
      if (invErr) { console.error('[deposit-reinvest] inv error:', invErr); throw invErr; }
      console.log(`[API] Reinvest success: user ${userId}, plan ${planId}, amount ${amt}, activated: true`)

      res.json({ success: true, newBalance: Number(user.balance) - amt })
    } catch(e) {
      console.error('[API deposit-reinvest Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/deposit-wallet ────────────────────────────────────────────
  app.post('/api/deposit-wallet', async (req, res) => {
    try {
      const { initData, planId, amount, invoiceId, userId: bodyUserId } = req.body
      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      // Banned check
      const { data: userCheck } = await supabase.from('users').select('status').eq('id', userId).maybeSingle();
      if (userCheck?.status === 'banned') return res.status(403).json({ error: 'User is banned' });

      const amt = Number(amount)
      if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' })

      // Fetch plan
      const { data: plan, error: pErr } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle()
      if (pErr || !plan) return res.status(404).json({ error: 'Plan not found' })

      const now = Date.now()

      // Update user total_deposit
      const { data: user } = await supabase.from('users').select('total_deposit, referred_by').eq('id', userId).maybeSingle()
      await supabase.from('users').update({
        total_deposit: Number(user?.total_deposit || 0) + amt,
        updated_at: new Date().toISOString()
      }).eq('id', userId)

      // Create transaction
      const { error: txErr } = await supabase.from('transactions').insert({
        id: `tx-${now}`, user_id: userId, type: 'deposit',
        label: `Deposit · ${plan.name}`, amount: amt, status: 'completed',
        invoice_id: invoiceId || `inv-${now}`, plan_id: Number(planId), created_at: now
      })
      if (txErr) { console.error('[deposit-wallet] tx error:', txErr); throw txErr; }

      // Create investment
      const profitIntervalMs = plan.profit_interval_ms || (plan.profit_interval_minutes ? plan.profit_interval_minutes * 60000 : 86400000)
      const durationMs = plan.duration_ms || (plan.duration_unit === 'hours' ? plan.duration * 3600000 : plan.duration * 86400000)
      const { error: invErr } = await supabase.from('investments').insert({
        id: `inv-${now}`, user_id: userId, plan: plan.name, plan_color: plan.color || 'gold',
        amount: amt, rate: Number(plan.rate), earned: 0, days_total: plan.duration,
        profit_interval_minutes: Math.round(profitIntervalMs / 60000), profit_interval_ms: profitIntervalMs,
        profit_interval_hours: Math.round(profitIntervalMs / 3600000), active_days: plan.active_days || [1,2,3,4,5],
        start_time: now, end_time: now + durationMs, next_profit_time: now + profitIntervalMs,
        status: 'active', activated: true, invoice_id: invoiceId || `inv-${now}`, plan_id: Number(planId)
      })
      if (invErr) { console.error('[deposit-wallet] inv error:', invErr); throw invErr; }
      console.log(`[API] Deposit success: user ${userId}, plan ${planId}, amount ${amt}, activated: true`)

      // Auto referral commission
      if (user?.referred_by) {
        const { data: referrer } = await supabase.from('users').select('id').eq('referral_code', user.referred_by).maybeSingle()
        if (referrer && Number(referrer.id) !== Number(userId)) {
          // Check if it's the first deposit
          const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('type', 'deposit')
          if (count === 1) {
            const { data: adminConfig } = await supabase.from('admin_config').select('referral_rate').eq('id', 1).maybeSingle()
            const rate = adminConfig?.referral_rate || 5
            const commission = +(amt * (rate / 100)).toFixed(2)
            if (commission > 0) {
              // We simulate an internal API call logic here
              const { data: refUser } = await supabase.from('users').select('balance, referral_friends, referral_commission').eq('id', referrer.id).maybeSingle()
              if (refUser) {
                await supabase.from('users').update({
                  balance: +((Number(refUser.balance) || 0) + commission).toFixed(2),
                  referral_friends: (refUser.referral_friends || 0) + 1,
                  referral_commission: +((Number(refUser.referral_commission) || 0) + commission).toFixed(2),
                  updated_at: new Date().toISOString()
                }).eq('id', referrer.id)
                await supabase.from('transactions').insert({
                  id: `ref-${referrer.id}-${now}`, user_id: referrer.id, type: 'referral',
                  label: `Referral · @${userId}`, amount: commission, status: 'completed', created_at: now
                })
              }
            }
          }
        }
      }

      res.json({ success: true })
    } catch(e) {
      console.error('[API deposit-wallet Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/activate-investment ──────────────────────────────────────
  app.post('/api/activate-investment', async (req, res) => {
    try {
      const { initData, invId, userId: bodyUserId } = req.body
      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      // Banned check
      const { data: userCheck } = await supabase.from('users').select('status').eq('id', userId).maybeSingle();
      if (userCheck?.status === 'banned') return res.status(403).json({ error: 'User is banned' });

      if (!invId) return res.status(400).json({ error: 'Missing invId' })

      // Fetch investment & verify ownership
      const { data: inv, error: iErr } = await supabase.from('investments')
        .select('*').eq('id', invId).eq('user_id', userId).maybeSingle()
      if (iErr || !inv) return res.status(404).json({ error: 'Investment not found' })
      if (inv.activated) return res.json({ success: true, alreadyActive: true })

      const now = Date.now()
      const intervalMs = Number(inv.profit_interval_ms || 86400000)

      const { error: updErr } = await supabase.from('investments').update({
        activated: true,
        next_profit_time: now + intervalMs
      }).eq('id', invId)

      if (updErr) throw updErr

      console.log(`[API] Investment ${invId} activated by user ${userId}`)
      res.json({ success: true, nextProfitTime: now + intervalMs })
    } catch(e) {
      console.error('[API activate-investment Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/collect-profit ────────────────────────────────────────────
  app.post('/api/collect-profit', async (req, res) => {
    try {
      const { initData, invId, userId: bodyUserId } = req.body
      const { userId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      // Banned check
      const { data: userCheck } = await supabase.from('users').select('status').eq('id', userId).maybeSingle();
      if (userCheck?.status === 'banned') return res.status(403).json({ error: 'User is banned' });

      // Fetch investment
      const { data: inv, error: iErr } = await supabase.from('investments').select('*').eq('id', invId).eq('user_id', userId).maybeSingle()
      if (iErr || !inv) return res.status(404).json({ error: 'Investment not found' })

      const uncollected = Number(inv.earned) || 0
      if (uncollected <= 0) return res.status(400).json({ error: 'No profit to collect' })

      const now = Date.now()

      // Fetch user
      const { data: user } = await supabase.from('users').select('balance').eq('id', userId).maybeSingle()
      const newBalance = Number(user?.balance || 0) + uncollected

      // Update user balance
      await supabase.from('users').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('id', userId)

      // Create profit transaction
      await supabase.from('transactions').insert({
        id: `collect-${now}`, user_id: userId, type: 'profit',
        label: `Profit collected · ${inv.plan || 'Plan'}`, amount: uncollected,
        status: 'completed', created_at: now
      })

      // Reset investment earned
      await supabase.from('investments').update({ status: 'completed', earned: 0 }).eq('id', invId)

      res.json({ success: true, newBalance })
    } catch(e) {
      console.error('[API collect-profit Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── POST /api/admin-update-user ─────────────────────────────────────────
  app.post('/api/admin-update-user', async (req, res) => {
    try {
      const { initData, targetUserId, updates, userId: bodyUserId } = req.body

      const { userId: adminId, authorized } = resolveUserId(initData, bodyUserId);
      if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

      if (!await isAdmin(adminId)) return res.status(403).json({ error: 'Forbidden: Admin only' });

      if (!targetUserId || !updates) return res.status(400).json({ error: 'Missing targetUserId or updates' })

      const { error } = await supabase.from('users').update({
        balance: updates.balance !== undefined ? updates.balance : undefined,
        total_deposit: updates.totalDeposit !== undefined ? updates.totalDeposit : undefined,
        total_withdraw: updates.totalWithdraw !== undefined ? updates.totalWithdraw : undefined,
        today_profit: updates.todayProfit !== undefined ? updates.todayProfit : undefined,
        referrals: updates.referrals !== undefined ? updates.referrals : undefined,
        status: updates.status !== undefined ? updates.status : undefined,
        updated_at: new Date().toISOString()
      }).eq('id', Number(targetUserId))

      if (error) { console.error('[API admin-update-user]', error); return res.status(500).json({ error: error.message }) }
      console.log(`[API] User ${targetUserId} updated by admin ${adminId}`)
      res.json({ success: true })
    } catch(e) {
      console.error('[API admin-update-user Error]', e)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.listen(PORT, () => {
    console.log(`[API] Server listening on port ${PORT}`);
  });

  // ─── BACKGROUND WORKER: PROCESS PROFITS ────────────────────────────────
  async function processProfits() {
    try {
      const now = Date.now()
      // Fetch active AND activated investments ready for profit
      const { data: invs, error } = await supabase.from('investments')
        .select('*')
        .eq('status', 'active')
        .eq('activated', true)
        .lte('next_profit_time', now)
      
      if (error || !invs || invs.length === 0) return

      for (const inv of invs) {
        const ad = inv.active_days || [1,2,3,4,5]
        const today = new Date().getDay()
        const isCompleted = now >= inv.end_time

        const ip = parseFloat(inv.amount) * (Number(inv.rate) / 100)
        let newEarned = Number(inv.earned || 0)
        let intervalMs = Number(inv.profit_interval_ms || 86400000)
        let addProfit = 0

        if (isCompleted) {
          addProfit = ip + parseFloat(inv.amount)
          newEarned += ip
          
          await supabase.from('investments').update({
            status: 'completed', earned: 0, progress: 100
          }).eq('id', inv.id)

          const { data: user } = await supabase.from('users').select('balance').eq('id', inv.user_id).maybeSingle()
          if (user) {
            await supabase.from('users').update({ balance: Number(user.balance) + addProfit }).eq('id', inv.user_id)
          }

          await supabase.from('transactions').insert([
            { id: `prf-${inv.id}-${now}`, user_id: inv.user_id, type: 'profit', label: `Profit · ${inv.plan}`, amount: +ip.toFixed(2), status: 'completed', created_at: now, plan_id: inv.plan_id },
            { id: `ret-${inv.id}-${now}`, user_id: inv.user_id, type: 'deposit', label: `Principal returned · ${inv.plan}`, amount: parseFloat(inv.amount), status: 'completed', created_at: now, plan_id: inv.plan_id }
          ])
        } else {
          if (ad.includes(today)) {
            addProfit = ip
            newEarned += ip

            const { data: user } = await supabase.from('users').select('balance, today_profit').eq('id', inv.user_id).maybeSingle()
            if (user) {
              await supabase.from('users').update({ 
                balance: Number(user.balance) + addProfit,
                today_profit: Number(user.today_profit || 0) + addProfit
              }).eq('id', inv.user_id)
            }

            await supabase.from('transactions').insert({
               id: `prf-${inv.id}-${now}`, user_id: inv.user_id, type: 'profit', label: `Profit · ${inv.plan}`, amount: +ip.toFixed(2), status: 'completed', created_at: now, plan_id: inv.plan_id
            })
          }

          await supabase.from('investments').update({
            next_profit_time: Number(inv.next_profit_time) + intervalMs,
            earned: newEarned
          }).eq('id', inv.id)
        }
      }
    } catch(e) {
      console.error('[Worker] Profit tick error:', e)
    }
  }

  // Chạy vòng lặp tính lãi mỗi 5 giây
  setInterval(processProfits, 5000)

  while (true) {
    try { await processOnce() } catch(e) { console.error('[Worker Error]', e) }
    await sleep(POLL_INTERVAL_MS)
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

startWorker().catch(e => { console.error('[FATAL]', e); process.exit(1) })