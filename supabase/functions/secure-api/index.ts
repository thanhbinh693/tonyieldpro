import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-telegram-init-data',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405)

  if (!BOT_TOKEN) return json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN secret' }, 500)

  const initData = req.headers.get('x-telegram-init-data') || ''
  const verified = await verifyTelegramInitData(initData, BOT_TOKEN)
  if (!verified.ok || !verified.user?.id) {
    return json({ ok: false, error: verified.error || 'Unauthorized' }, 401)
  }

  let body: { action?: string; payload?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  const userId = Number(verified.user.id)
  const payload = body.payload || {}

  try {
    switch (body.action) {
      case 'register_user':
        return await registerUser(userId, verified.user, payload)
      case 'record_deposit':
        return await recordDeposit(userId, verified.user, payload)
      case 'submit_withdraw':
        return await submitWithdraw(userId, payload)
      case 'activate_investment':
        return await activateInvestment(userId, payload)
      case 'admin_update_user':
        return await adminUpdateUser(userId, payload)
      case 'admin_delete_user':
        return await adminDeleteUser(userId, payload)
      case 'admin_save_config':
        return await adminSaveConfig(userId, payload)
      case 'admin_save_plans':
        return await adminSavePlans(userId, payload)
      case 'admin_create_notification':
        return await adminCreateNotification(userId, payload)
      case 'admin_delete_notification':
        return await adminDeleteNotification(userId, payload)
      default:
        return json({ ok: false, error: 'Unknown action' }, 400)
    }
  } catch (err) {
    console.error('[secure-api]', body.action, err)
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

async function registerUser(userId: number, tgUser: TelegramUser, payload: Record<string, unknown>) {
  const referredByCode = String(payload.referred_by_code || '').replace(/^(ref_|ref-)/i, '')
  const cleanRef = /^\d{5,15}$/.test(referredByCode) ? referredByCode : ''
  const { error } = await supabase.rpc('register_referral_user', {
    p_user_id: userId,
    p_username: tgUser.username || '',
    p_first_name: tgUser.first_name || '',
    p_referred_by_code: cleanRef,
  })
  if (error) throw error
  return json({ ok: true })
}

async function recordDeposit(userId: number, tgUser: TelegramUser, payload: Record<string, unknown>) {
  const amount = Number(payload.amount)
  const planId = Number(payload.plan_id)
  const fromBalance = Boolean(payload.from_balance)
  if (!amount || amount <= 0 || !planId) return json({ ok: false, error: 'Invalid deposit' }, 400)

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle()
  if (planErr) throw planErr
  if (!plan) return json({ ok: false, error: 'Plan not found' }, 404)
  if (amount < Number(plan.min_amount) || (plan.max_amount !== null && amount > Number(plan.max_amount))) {
    return json({ ok: false, error: 'Amount outside plan range' }, 400)
  }

  const now = Date.now()
  const durationMs = Number(plan.duration_ms) || (Number(plan.duration) * (plan.duration_unit === 'hours' ? 3_600_000 : 86_400_000))
  const intervalMs = Number(plan.profit_interval_ms)
    || (Number(plan.profit_interval_minutes) ? Number(plan.profit_interval_minutes) * 60_000 : 0)
    || (Number(plan.profit_interval_hours) ? Number(plan.profit_interval_hours) * 3_600_000 : 0)
    || 86_400_000
  const intervalMinutes = Number(plan.profit_interval_minutes) || Math.round(intervalMs / 60_000)
  const intervalHours = Number(plan.profit_interval_hours) || intervalMs / 3_600_000
  const invId = safeId(payload.inv_id, `inv-${now}`)
  const txId = safeId(payload.tx_id, `tx-${now}`)
  const invoiceId = safeId(payload.invoice_id, String((now % 900000) + 100000))

  const { data, error } = await supabase.rpc('record_deposit', {
    p_user_id: userId,
    p_username: tgUser.username || '',
    p_first_name: tgUser.first_name || '',
    p_amount: amount,
    p_from_balance: fromBalance,
    p_tx_id: txId,
    p_inv_id: invId,
    p_invoice_id: invoiceId,
    p_plan_id: planId,
    p_plan: plan.name,
    p_plan_color: plan.color,
    p_rate: Number(plan.rate),
    p_days_total: Number(plan.duration),
    p_profit_interval_ms: intervalMs,
    p_profit_interval_minutes: intervalMinutes,
    p_profit_interval_hours: intervalHours,
    p_active_days: plan.active_days || [1, 2, 3, 4, 5],
    p_start_time: now,
    p_end_time: now + durationMs,
    p_next_profit_time: now + intervalMs,
  })
  if (error) throw error

  await supabase.rpc('credit_referral_commission', {
    p_user_id: userId,
    p_deposit_amount: amount,
    p_deposit_tx_id: txId,
    p_now: now,
  })

  return json({
    ok: true,
    ...(data?.[0] || {}),
    investment: {
      id: invId,
      user_id: userId,
      plan: plan.name,
      plan_color: plan.color,
      plan_id: planId,
      amount,
      rate: Number(plan.rate),
      earned: 0,
      days_total: Number(plan.duration),
      profit_interval_ms: intervalMs,
      profit_interval_minutes: intervalMinutes,
      profit_interval_hours: intervalHours,
      active_days: plan.active_days || [1, 2, 3, 4, 5],
      start_time: now,
      end_time: now + durationMs,
      next_profit_time: now + intervalMs,
      status: 'active',
      activated: false,
      invoice_id: invoiceId,
    },
    tx_id: txId,
    invoice_id: invoiceId,
  })
}

async function submitWithdraw(userId: number, payload: Record<string, unknown>) {
  const amount = Number(payload.amount)
  const wallet = String(payload.wallet_address || '').trim()
  if (!amount || amount <= 0) return json({ ok: false, error: 'Invalid amount' }, 400)
  if (!/^[EUk0][Qg][A-Za-z0-9_-]{46}=?$/.test(wallet)) return json({ ok: false, error: 'Invalid wallet' }, 400)

  const { data: cfg } = await supabase.from('admin_config').select('min_withdraw').eq('id', 1).maybeSingle()
  const minWithdraw = Number(cfg?.min_withdraw) || 5
  if (amount < minWithdraw) return json({ ok: false, error: `Amount below minimum (${minWithdraw} TON)` }, 400)

  const { data: user } = await supabase.from('users').select('status, balance').eq('id', userId).maybeSingle()
  if (!user) return json({ ok: false, error: 'User not found' }, 404)
  if (user.status === 'banned') return json({ ok: false, error: 'Account restricted' }, 403)
  if (Number(user.balance) < amount) return json({ ok: false, error: 'Insufficient balance' }, 400)

  const now = Date.now()
  const txId = safeId(payload.tx_id, `tx-wd-${userId}-${now}-${crypto.randomUUID().slice(0, 8)}`)
  const nextBalance = +((Number(user.balance) || 0) - amount).toFixed(6)

  const { error: userErr } = await supabase.from('users').update({
    balance: nextBalance,
    wallet_addr: wallet,
    updated_at: new Date().toISOString(),
  }).eq('id', userId)
  if (userErr) throw userErr

  const { error: txErr } = await supabase.from('transactions').insert({
    id: txId,
    user_id: userId,
    type: 'withdraw',
    label: `Withdrawal -> ${wallet.slice(0, 8)}...`,
    amount,
    status: 'pending',
    to_wallet: wallet,
    created_at: now,
    updated_at: new Date().toISOString(),
  })
  if (txErr) {
    await supabase.from('users').update({ balance: user.balance, updated_at: new Date().toISOString() }).eq('id', userId)
    throw txErr
  }

  return json({ ok: true, tx_id: txId, balance: nextBalance, created_at: now })
}

async function activateInvestment(userId: number, payload: Record<string, unknown>) {
  const invId = String(payload.investment_id || '')
  if (!invId) return json({ ok: false, error: 'Missing investment_id' }, 400)

  const { data: inv } = await supabase
    .from('investments')
    .select('id, user_id, profit_interval_ms, profit_interval_minutes, profit_interval_hours')
    .eq('id', invId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!inv) return json({ ok: false, error: 'Investment not found' }, 404)

  const intervalMs = Number(inv.profit_interval_ms)
    || (Number(inv.profit_interval_minutes) ? Number(inv.profit_interval_minutes) * 60_000 : 0)
    || (Number(inv.profit_interval_hours) ? Number(inv.profit_interval_hours) * 3_600_000 : 0)
    || 86_400_000
  const nextProfitTime = Date.now() + intervalMs

  const { error } = await supabase.from('investments').update({
    activated: true,
    next_profit_time: nextProfitTime,
    updated_at: new Date().toISOString(),
  }).eq('id', invId).eq('user_id', userId)
  if (error) throw error
  return json({ ok: true, next_profit_time: nextProfitTime })
}

async function adminUpdateUser(adminId: number, payload: Record<string, unknown>) {
  await requireAdmin(adminId)
  const userId = Number(payload.user_id)
  const patch = payload.patch as Record<string, unknown>
  if (!userId || !patch || typeof patch !== 'object') return json({ ok: false, error: 'Invalid user update' }, 400)
  const { error } = await supabase.from('users').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', userId)
  if (error) throw error
  return json({ ok: true })
}

async function adminDeleteUser(adminId: number, payload: Record<string, unknown>) {
  await requireAdmin(adminId)
  const userId = Number(payload.user_id)
  if (!userId || userId === adminId) return json({ ok: false, error: 'Invalid user_id' }, 400)
  const { error } = await supabase.rpc('delete_user_data', { p_user_id: userId })
  if (error) throw error
  return json({ ok: true })
}

async function adminSaveConfig(adminId: number, payload: Record<string, unknown>) {
  await requireAdmin(adminId)
  const row = payload.row as Record<string, unknown>
  if (!row || typeof row !== 'object') return json({ ok: false, error: 'Invalid config' }, 400)
  const { error } = await supabase.from('admin_config').upsert({ ...row, id: 1, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) throw error
  return json({ ok: true })
}

async function adminSavePlans(adminId: number, payload: Record<string, unknown>) {
  await requireAdmin(adminId)
  const rows = payload.rows as Record<string, unknown>[]
  if (!Array.isArray(rows)) return json({ ok: false, error: 'Invalid plans' }, 400)
  const { error } = await supabase.from('plans').upsert(rows, { onConflict: 'id' })
  if (error) throw error
  return json({ ok: true })
}

async function adminCreateNotification(adminId: number, payload: Record<string, unknown>) {
  await requireAdmin(adminId)
  const title = String(payload.title || '').trim()
  const body = String(payload.body || '').trim()
  const audience = payload.audience === 'user' ? 'user' : 'all'
  const userId = audience === 'user' ? Number(payload.user_id) : null
  if (!title || !body) return json({ ok: false, error: 'Missing notification content' }, 400)
  const { data, error } = await supabase.from('notifications').insert({
    title,
    body,
    audience,
    user_id: userId,
    created_by: adminId,
  }).select('*').single()
  if (error) throw error
  return json({ ok: true, notification: data })
}

async function adminDeleteNotification(adminId: number, payload: Record<string, unknown>) {
  await requireAdmin(adminId)
  const id = Number(payload.notification_id)
  if (!id) return json({ ok: false, error: 'Missing notification_id' }, 400)
  const { error } = await supabase.from('notifications').delete().eq('id', id)
  if (error) throw error
  return json({ ok: true })
}

async function requireAdmin(userId: number) {
  const { data } = await supabase.from('admin_config').select('admin_ids').eq('id', 1).maybeSingle()
  const ids = Array.isArray(data?.admin_ids) ? data.admin_ids.map(Number) : []
  if (!ids.includes(Number(userId))) throw new Error('Admin only')
}

async function verifyTelegramInitData(initData: string, botToken: string): Promise<{ ok: boolean; user?: TelegramUser; error?: string }> {
  if (!initData) return { ok: false, error: 'Missing Telegram initData' }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash') || ''
  params.delete('hash')
  const authDate = Number(params.get('auth_date') || 0)
  if (!hash || !authDate) return { ok: false, error: 'Invalid initData' }
  if (Math.abs(Date.now() / 1000 - authDate) > 86400) return { ok: false, error: 'Expired initData' }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secret = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken)
  const sig = await hmacSha256(secret, dataCheckString)
  if (toHex(sig) !== hash) return { ok: false, error: 'Bad Telegram signature' }

  const userRaw = params.get('user')
  if (!userRaw) return { ok: false, error: 'Missing Telegram user' }
  return { ok: true, user: JSON.parse(userRaw) }
}

async function hmacSha256(key: Uint8Array, data: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data)))
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeId(value: unknown, fallback: string) {
  const s = String(value || '').trim()
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(s) ? s : fallback
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors })
}

type TelegramUser = {
  id: number
  first_name?: string
  username?: string
}
