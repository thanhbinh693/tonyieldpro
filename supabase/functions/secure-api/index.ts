import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') || ''
const BOT_TOKEN = normalizeBotToken(Deno.env.get('TELEGRAM_BOT_TOKEN') || '')
const INIT_DATA_MAX_AGE_SECONDS = Number(Deno.env.get('TELEGRAM_INITDATA_MAX_AGE_SECONDS') || 604800)
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
      case 'activate_investment':
        return await activateInvestment(userId, payload)
      case 'admin_update_user':
        return await adminUpdateUser(userId, payload)
      case 'admin_delete_user':
        return await adminDeleteUser(userId, payload)
      case 'admin_retry_withdrawal':
        return await adminRetryWithdrawal(userId, payload)
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
    return json({ ok: false, error: formatError(err) }, 500)
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

    if (/^[EUk0][Qg][A-Za-z0-9_-]{46}=?$/.test(walletAddress)) {
      await supabase.from('users').update({
        wallet_addr: walletAddress,
        updated_at: new Date().toISOString(),
      }).eq('id', userId)
    }
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

  const now = Date.now()
  const txId = safeId(payload.tx_id, `tx-wd-${userId}-${now}-${crypto.randomUUID().slice(0, 8)}`)

  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_user_id: userId,
    p_amount: amount,
    p_wallet: wallet,
    p_tx_id: txId,
    p_now: now,
  })
  if (error) {
    const msg = formatError(error)
    if (/minimum|invalid amount|invalid wallet/i.test(msg)) return json({ ok: false, error: msg }, 400)
    if (/insufficient/i.test(msg)) return json({ ok: false, error: 'Insufficient balance' }, 400)
    if (/restricted|banned|referrals/i.test(msg)) return json({ ok: false, error: msg }, 403)
    if (/not found/i.test(msg)) return json({ ok: false, error: msg }, 404)

    const fallback = await submitWithdrawFallback(userId, amount, wallet, txId, now)
    startWithdrawalProcessor(userId, amount, wallet, txId, now)
    return json({ ok: true, ...fallback, fallback: true, auto_process: true })
  }
  const saved = data?.[0] || {}

  startWithdrawalProcessor(userId, amount, wallet, txId, now)
  return json({ ok: true, tx_id: txId, balance: Number(saved.balance), created_at: Number(saved.created_at || now), auto_process: true })
}

function startWithdrawalProcessor(userId: number, amount: number, wallet: string, txId: string, now: number) {
  const request = triggerWithdrawalProcessor({
    id: txId,
    user_id: userId,
    type: 'withdraw',
    label: `Withdrawal -> ${wallet.slice(0, 8)}...`,
    amount,
    status: 'pending',
    to_wallet: wallet,
    created_at: now,
    updated_at: new Date().toISOString(),
  }).then((result) => {
    if (!result.ok) console.error('[startWithdrawalProcessor]', txId, result.error || result.body)
  }).catch((err) => {
    console.error('[startWithdrawalProcessor]', txId, err)
  })

  waitUntil(request)
}

async function submitWithdrawFallback(userId: number, amount: number, wallet: string, txId: string, now: number) {
  const { data: cfg, error: cfgErr } = await supabase
    .from('admin_config')
    .select('min_withdraw, withdraw_referral_gate_enabled, withdraw_min_referrals')
    .eq('id', 1)
    .maybeSingle()
  if (cfgErr) throw cfgErr

  const minWithdraw = Number(cfg?.min_withdraw) || 5
  if (amount < minWithdraw) throw new Error(`Amount below minimum (${minWithdraw} TON)`)

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, status, balance, referrals, referral_friends')
    .eq('id', userId)
    .maybeSingle()
  if (userErr) throw userErr
  if (!userRow) throw new Error('User not found')
  if (userRow.status === 'banned') throw new Error('Account restricted')

  const userRefs = Math.max(Number(userRow.referrals) || 0, Number(userRow.referral_friends) || 0)
  const minRefs = Math.max(0, Number(cfg?.withdraw_min_referrals) || 0)
  if (cfg?.withdraw_referral_gate_enabled && userRefs <= minRefs) {
    throw new Error(`Withdrawal requires more than ${minRefs} referrals`)
  }

  const currentBalance = Number(userRow.balance) || 0
  if (currentBalance < amount) throw new Error('Insufficient balance')
  const nextBalance = Number((currentBalance - amount).toFixed(6))

  const { data: updatedUser, error: updateErr } = await supabase
    .from('users')
    .update({
      balance: nextBalance,
      wallet_addr: wallet,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .gte('balance', amount)
    .select('balance')
    .maybeSingle()
  if (updateErr) throw updateErr
  if (!updatedUser) throw new Error('Insufficient balance')

  const { error: insertErr } = await supabase.from('transactions').insert({
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

  if (insertErr) {
    await supabase.from('users').update({
      balance: currentBalance,
      updated_at: new Date().toISOString(),
    }).eq('id', userId)
    throw insertErr
  }

  return { tx_id: txId, balance: Number(updatedUser.balance), created_at: now }
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

async function adminRetryWithdrawal(adminId: number, payload: Record<string, unknown>) {
  await requireAdmin(adminId)
  const txId = String(payload.tx_id || '').trim()
  if (!txId) return json({ ok: false, error: 'Missing withdrawal id' }, 400)

  const { data: tx, error: txErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', txId)
    .eq('type', 'withdraw')
    .maybeSingle()
  if (txErr) throw txErr
  if (!tx) return json({ ok: false, error: 'Withdrawal not found' }, 404)
  if (!['pending', 'processing'].includes(String(tx.status))) {
    return json({ ok: false, error: `Only pending or processing withdrawals can be retried (current: ${tx.status})` }, 400)
  }

  const { data: cfg } = await supabase
    .from('admin_config')
    .select('withdrawal_webhook_url, withdrawal_webhook_secret')
    .eq('id', 1)
    .maybeSingle()

  const result = await triggerWithdrawalProcessor(tx, cfg, true)
  const latest = await getWithdrawalTx(txId)
  const body = result.body as Record<string, unknown> | null

  if (!result.ok && !body?.retryable) {
    return json({ ok: false, error: result.error || 'Withdrawal processor failed' }, 502)
  }

  return json({ ok: true, processor: result.body || null, tx: latest })
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

async function triggerWithdrawalProcessor(tx: Record<string, unknown>, cfg?: Record<string, unknown> | null, force = false) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/process-withdrawal`
  const secret = String(WEBHOOK_SECRET || cfg?.withdrawal_webhook_secret || '').trim()

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        ...(secret ? { 'x-webhook-secret': secret } : {}),
      },
      body: JSON.stringify({
        type: 'INSERT',
        table: 'transactions',
        schema: 'public',
        record: tx,
        force,
      }),
    })
    const text = await res.text().catch(() => '')
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }

    if (!res.ok) {
      console.error('[triggerWithdrawalProcessor]', res.status, body)
      return { ok: false, status: res.status, error: typeof body === 'string' ? body : JSON.stringify(body), body }
    }

    return { ok: true, status: res.status, body }
  } catch (err) {
    console.error('[triggerWithdrawalProcessor]', err)
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err), body: null }
  }
}

async function getWithdrawalTx(txId: string) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', txId)
    .eq('type', 'withdraw')
    .maybeSingle()
  if (error) throw error
  return data || null
}

function waitUntil(promise: Promise<unknown>) {
  try {
    const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime
    runtime?.waitUntil?.(promise)
  } catch {
    // Best-effort background processor call.
  }
}

async function verifyTelegramInitData(initData: string, botToken: string): Promise<{ ok: boolean; user?: TelegramUser; error?: string }> {
  if (!initData) return { ok: false, error: 'Missing Telegram initData' }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash') || ''
  params.delete('hash')
  const authDate = Number(params.get('auth_date') || 0)
  if (!hash || !authDate) return { ok: false, error: 'Invalid initData' }
  if (INIT_DATA_MAX_AGE_SECONDS > 0 && Math.abs(Date.now() / 1000 - authDate) > INIT_DATA_MAX_AGE_SECONDS) {
    return { ok: false, error: 'Expired initData. Close and reopen the Mini App, then retry.' }
  }

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

function formatError(error: unknown) {
  if (!error) return 'Unknown error'
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'details', 'hint', 'code']) {
      if (typeof record[key] === 'string' && record[key]) return String(record[key])
    }
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors })
}

type TelegramUser = {
  id: number
  first_name?: string
  username?: string
}
