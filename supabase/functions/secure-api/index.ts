import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TONCENTER_API_KEY = Deno.env.get('TONCENTER_API_KEY') || ''
const BOT_TOKEN = normalizeBotToken(Deno.env.get('TELEGRAM_BOT_TOKEN') || '')
const MINI_APP_URL = normalizeUrl(
  Deno.env.get('MINI_APP_URL')
    || Deno.env.get('WEBAPP_URL')
    || Deno.env.get('APP_URL')
    || Deno.env.get('PUBLIC_APP_URL')
    || '',
)

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
      case 'update_wallet':
        return await updateWallet(userId, verified.user, payload)
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
      case 'admin_test_bot_message':
        return await adminTestBotMessage(userId)
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

  const { data: existingDeposit, error: existingDepositErr } = await supabase
    .from('transactions')
    .select('id')
    .eq('type', 'deposit')
    .eq('status', 'completed')
    .eq('invoice_id', invoiceId)
    .maybeSingle()
  if (existingDepositErr) throw existingDepositErr
  if (existingDeposit) return json({ ok: false, error: 'Deposit invoice already used' }, 409)

  if (!fromBalance) {
    const walletAddress = String(payload.wallet_address || '').trim()
    if (!/^[EUk0][Qg][A-Za-z0-9_-]{46}=?$/.test(walletAddress)) {
      return json({ ok: false, error: 'Invalid source wallet' }, 400)
    }

    const { data: cfg, error: cfgErr } = await supabase
      .from('admin_config')
      .select('admin_wallet, admin_wallet_testnet, admin_wallet_mainnet, ton_network')
      .eq('id', 1)
      .maybeSingle()
    if (cfgErr) throw cfgErr

    const network = cfg?.ton_network === 'mainnet' ? 'mainnet' : 'testnet'
    const adminWallet = network === 'mainnet'
      ? String(cfg?.admin_wallet_mainnet || cfg?.admin_wallet || '').trim()
      : String(cfg?.admin_wallet_testnet || cfg?.admin_wallet || '').trim()
    if (!adminWallet) return json({ ok: false, error: 'Admin wallet not configured' }, 500)

    const verified = await verifyTonDeposit({
      adminWallet,
      sourceWallet: walletAddress,
      amount,
      invoiceId,
      network,
      minUtime: Math.floor((now - 10 * 60_000) / 1000),
    })
    if (!verified.ok) return json({ ok: false, error: verified.error || 'Deposit transaction not verified yet' }, 402)
  }

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

  if (!fromBalance) {
    await supabase.rpc('credit_referral_commission', {
      p_user_id: userId,
      p_deposit_amount: amount,
      p_deposit_tx_id: txId,
      p_now: now,
    })
  }

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

  const { data: user } = await supabase.from('users').select('status, balance, wallet_addr').eq('id', userId).maybeSingle()
  if (!user) return json({ ok: false, error: 'User not found' }, 404)
  if (user.status === 'banned') return json({ ok: false, error: 'Account restricted' }, 403)
  if (Number(user.balance) < amount) return json({ ok: false, error: 'Insufficient balance' }, 400)
  const linkedWallet = String(user.wallet_addr || '').trim()
  if (!linkedWallet || linkedWallet !== wallet) {
    return json({ ok: false, error: 'Wallet mismatch. Disconnect all devices and connect the linked wallet again.' }, 409)
  }

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

async function updateWallet(userId: number, tgUser: TelegramUser, payload: Record<string, unknown>) {
  const wallet = String(payload.wallet_address || '').trim()
  const expectedWallet = String(payload.expected_wallet || '').trim()
  if (wallet && !/^[EUk0][Qg][A-Za-z0-9_-]{46}=?$/.test(wallet)) {
    return json({ ok: false, error: 'Invalid wallet' }, 400)
  }
  if (expectedWallet && !/^[EUk0][Qg][A-Za-z0-9_-]{46}=?$/.test(expectedWallet)) {
    return json({ ok: false, error: 'Invalid expected wallet' }, 400)
  }

  const nowIso = new Date().toISOString()
  const { error: ensureErr } = await supabase.from('users').upsert({
    id: userId,
    username: tgUser.username || '',
    first_name: tgUser.first_name || '',
    referral_code: String(userId),
    updated_at: nowIso,
  }, { onConflict: 'id' })
  if (ensureErr) throw ensureErr

  if (!wallet) {
    const { data: current, error: currentErr } = await supabase
      .from('users')
      .select('wallet_addr')
      .eq('id', userId)
      .maybeSingle()
    if (currentErr) throw currentErr

    const linkedWallet = String(current?.wallet_addr || '').trim()
    if (linkedWallet && linkedWallet !== expectedWallet) {
      return json({ ok: false, error: 'Wallet changed on another device. Refresh before disconnecting.' }, 409)
    }

    const { data, error } = await supabase
      .from('users')
      .update({ wallet_addr: '', updated_at: nowIso })
      .eq('id', userId)
      .select('wallet_addr')
      .maybeSingle()
    if (error) throw error
    return json({ ok: true, wallet_addr: data?.wallet_addr || '' })
  }

  const { data, error } = await supabase
    .from('users')
    .update({ wallet_addr: wallet, updated_at: nowIso })
    .eq('id', userId)
    .or(`wallet_addr.is.null,wallet_addr.eq.,wallet_addr.eq.${wallet}`)
    .select('wallet_addr')
    .maybeSingle()
  if (error) throw error
  if (!data) {
    return json({ ok: false, error: 'Disconnect wallet on all devices before linking a new wallet' }, 409)
  }

  return json({ ok: true, wallet_addr: data?.wallet_addr || wallet })
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
  if (audience === 'user' && !userId) return json({ ok: false, error: 'Missing user_id' }, 400)
  const { data, error } = await supabase.from('notifications').insert({
    title,
    body,
    audience,
    user_id: userId,
    created_by: adminId,
  }).select('*').single()
  if (error) throw error

  const botDelivery = await sendNotificationToTelegram({ title, body, audience, userId })
  return json({ ok: true, notification: data, bot_delivery: botDelivery })
}

async function adminDeleteNotification(adminId: number, payload: Record<string, unknown>) {
  await requireAdmin(adminId)
  const id = Number(payload.notification_id)
  if (!id) return json({ ok: false, error: 'Missing notification_id' }, 400)
  const { error } = await supabase.from('notifications').delete().eq('id', id)
  if (error) throw error
  return json({ ok: true })
}

async function adminTestBotMessage(adminId: number) {
  await requireAdmin(adminId)
  const { data } = await supabase
    .from('users')
    .select('id, bot_chat_id, bot_started_at, bot_blocked_at')
    .eq('id', adminId)
    .maybeSingle()

  const chatId = Number(data?.bot_chat_id || adminId)
  const replyMarkup = await getMiniAppReplyMarkup()
  const result = await sendTelegramMessage(chatId, 'TONYield bot notification test.', replyMarkup)
  if (result.ok) {
    await supabase.from('users').update({
      bot_chat_id: chatId,
      bot_blocked_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', adminId)
  }
  return json({
    ok: result.ok,
    error: result.ok ? undefined : (result.error || 'Telegram bot message failed'),
    bot_chat_id: chatId,
    bot_started_at: data?.bot_started_at || null,
    bot_blocked_at: data?.bot_blocked_at || null,
    telegram_error: result.error || null,
  }, result.ok ? 200 : 400)
}

async function requireAdmin(userId: number) {
  const { data } = await supabase.from('admin_config').select('admin_ids').eq('id', 1).maybeSingle()
  const ids = Array.isArray(data?.admin_ids) ? data.admin_ids.map(Number) : []
  if (!ids.includes(Number(userId))) throw new Error('Admin only')
}

async function sendNotificationToTelegram(
  notification: { title: string; body: string; audience: 'all' | 'user'; userId: number | null },
) {
  const recipients = await getTelegramRecipients(notification.audience, notification.userId)
  if (recipients.chatIds.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, skipped_no_chat: recipients.skippedNoChat }
  }

  const text = formatTelegramNotification(notification.title, notification.body)
  const replyMarkup = await getMiniAppReplyMarkup()
  let sent = 0
  let failed = 0
  let blocked = 0
  let notFound = 0
  let lastError = ''

  for (const recipient of recipients.chatIds) {
    const result = await sendTelegramMessage(recipient.chatId, text, replyMarkup)
    if (result.ok) {
      sent += 1
    } else {
      failed += 1
      lastError = result.error || lastError
      if (result.blocked) blocked += 1
      if (result.notFound) notFound += 1
      if (result.blocked) {
        await supabase.from('users').update({
          bot_blocked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', recipient.userId)
      }
    }
    await sleep(35)
  }

  return {
    attempted: recipients.chatIds.length,
    sent,
    failed,
    blocked,
    not_found: notFound,
    skipped_no_chat: recipients.skippedNoChat,
    last_error: lastError,
  }
}

async function getTelegramRecipients(audience: 'all' | 'user', userId: number | null): Promise<{
  chatIds: Array<{ userId: number; chatId: number }>
  skippedNoChat: number
}> {
  if (audience === 'user') {
    if (!userId) return { chatIds: [], skippedNoChat: 0 }
    const { data, error } = await supabase
      .from('users')
      .select('id, bot_chat_id')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.warn('[telegram notification recipient]', error)
      return { chatIds: [], skippedNoChat: 1 }
    }
    const chatId = Number(data?.bot_chat_id)
    return chatId ? { chatIds: [{ userId, chatId }], skippedNoChat: 0 } : { chatIds: [], skippedNoChat: 1 }
  }

  const chatIds: Array<{ userId: number; chatId: number }> = []
  let skippedNoChat = 0
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('users')
      .select('id, bot_chat_id')
      .neq('status', 'banned')
      .is('bot_blocked_at', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) {
      console.warn('[telegram notification recipients]', error)
      break
    }

    const page = data || []
    for (const u of page) {
      const chatId = Number(u.bot_chat_id)
      if (chatId) chatIds.push({ userId: Number(u.id), chatId })
      else skippedNoChat += 1
    }
    if (page.length < pageSize) break
  }
  return { chatIds, skippedNoChat }
}

async function sendTelegramMessage(chatId: number, text: string, replyMarkup: Record<string, unknown> | null = null) {
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }
    if (replyMarkup) payload.reply_markup = replyMarkup

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const detail = await res.text()
      console.warn('[telegram sendMessage]', chatId, res.status, detail)
      const notFound = /chat not found/i.test(detail)
      return {
        ok: false,
        blocked: res.status === 403 || /bot was blocked|user is deactivated/i.test(detail),
        notFound,
        error: detail,
      }
    }
    const data = await res.json().catch(() => null)
    return {
      ok: Boolean(data?.ok),
      blocked: false,
      notFound: false,
      error: data?.ok === false ? String(data?.description || 'Telegram returned ok=false') : '',
    }
  } catch (err) {
    console.warn('[telegram sendMessage]', chatId, err)
    return { ok: false, blocked: false, notFound: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function getMiniAppReplyMarkup() {
  const directUrl = MINI_APP_URL || await getTelegramMiniAppLink()
  if (!directUrl) return null

  const button = directUrl.startsWith('https://t.me/')
    ? { text: '🚀 Open mini app', url: directUrl }
    : { text: '🚀 Open mini app', web_app: { url: directUrl } }

  return { inline_keyboard: [[button]] }
}

async function getTelegramMiniAppLink() {
  const { data } = await supabase
    .from('admin_config')
    .select('bot_username')
    .eq('id', 1)
    .maybeSingle()
  const bot = String(data?.bot_username || '').trim().replace(/^@/, '')
  return bot ? `https://t.me/${bot}?startapp=app` : ''
}

function formatTelegramNotification(title: string, body: string) {
  return `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function verifyTonDeposit(params: {
  adminWallet: string
  sourceWallet: string
  amount: number
  invoiceId: string
  network: 'mainnet' | 'testnet'
  minUtime: number
}): Promise<{ ok: boolean; error?: string }> {
  const endpoint = params.network === 'mainnet'
    ? 'https://toncenter.com/api/v2/getTransactions'
    : 'https://testnet.toncenter.com/api/v2/getTransactions'
  const expectedNano = BigInt(Math.round(params.amount * 1e9))
  const toleranceNano = 10_000_000n

  for (let attempt = 0; attempt < 8; attempt++) {
    const url = new URL(endpoint)
    url.searchParams.set('address', params.adminWallet)
    url.searchParams.set('limit', '30')
    url.searchParams.set('archival', 'true')

    const headers: Record<string, string> = {}
    if (TONCENTER_API_KEY) headers['X-API-Key'] = TONCENTER_API_KEY

    try {
      const res = await fetch(url, { headers })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.ok && Array.isArray(body.result)) {
        const found = body.result.some((tx: Record<string, unknown>) => {
          const utime = Number(tx.utime || 0)
          if (utime && utime < params.minUtime) return false

          const msg = (tx.in_msg || {}) as Record<string, unknown>
          const valueNano = BigInt(String(msg.value || '0'))
          if (valueNano + toleranceNano < expectedNano) return false

          return messageContainsInvoice(msg, params.invoiceId)
        })
        if (found) return { ok: true }
      }
    } catch (err) {
      console.warn('[verifyTonDeposit]', err)
    }

    await sleep(1500)
  }

  return { ok: false, error: 'Deposit transaction not found on-chain. Please retry in a few seconds.' }
}

function messageContainsInvoice(msg: Record<string, unknown>, invoiceId: string) {
  const message = String(msg.message || '')
  if (message.includes(invoiceId)) return true

  const msgData = (msg.msg_data || {}) as Record<string, unknown>
  const text = String(msgData.text || '')
  if (text.includes(invoiceId)) return true

  const body = String(msgData.body || '')
  if (body.includes(invoiceId)) return true

  try {
    const decoded = atob(body.replace(/-/g, '+').replace(/_/g, '/'))
    return decoded.includes(invoiceId)
  } catch {
    return false
  }
}

async function verifyTelegramInitData(initData: string, botToken: string): Promise<{ ok: boolean; user?: TelegramUser; error?: string }> {
  if (!initData) return { ok: false, error: 'Missing Telegram initData' }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash') || ''
  params.delete('hash')
  const authDate = Number(params.get('auth_date') || 0)
  if (!hash || !authDate) return { ok: false, error: 'Invalid initData' }
  if (Math.abs(Date.now() / 1000 - authDate) > 86400) return { ok: false, error: 'Expired initData' }

  const buildDataCheckString = (source: URLSearchParams) => [...source.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secret = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken)
  const sig = await hmacSha256(secret, buildDataCheckString(params))

  if (toHex(sig) !== hash) {
    const withoutSignature = new URLSearchParams(params)
    withoutSignature.delete('signature')
    const fallbackSig = await hmacSha256(secret, buildDataCheckString(withoutSignature))
    if (toHex(fallbackSig) !== hash) {
      return { ok: false, error: 'Bad Telegram signature. Check TELEGRAM_BOT_TOKEN matches the Mini App bot, then redeploy secure-api.' }
    }
  }

  const userRaw = params.get('user')
  if (!userRaw) return { ok: false, error: 'Missing Telegram user' }
  try {
    return { ok: true, user: JSON.parse(userRaw) }
  } catch {
    return { ok: false, error: 'Invalid Telegram user payload' }
  }
}

function normalizeBotToken(token: string) {
  return token
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .replace(/^bot(?=\d+:)/i, '')
}

function normalizeUrl(url: string) {
  const clean = url.trim().replace(/^['"]|['"]$/g, '').trim()
  return /^https:\/\//i.test(clean) ? clean : ''
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
