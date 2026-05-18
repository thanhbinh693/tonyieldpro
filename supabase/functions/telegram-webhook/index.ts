/**
 * telegram-webhook — Supabase Edge Function
 * ─────────────────────────────────────────────────────────────────────────────
 * Nhận webhook từ Telegram Bot API.
 * Xử lý lệnh /start với referral param: https://t.me/your_bot?start=REF123
 *
 * Flow:
 *   User B click link → Telegram gửi update { message.text: "/start REF123" }
 *   → webhook nhận → parse start_param → lưu DB: B được mời bởi A
 *
 * Setup:
 *   1. Deploy: supabase functions deploy telegram-webhook --no-verify-jwt
 *   2. Set webhook: POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *        { url: "https://<PROJECT>.supabase.co/functions/v1/telegram-webhook" }
 *   3. Thêm TELEGRAM_BOT_TOKEN vào Supabase → Settings → Edge Functions → Secrets
 *
 * Env vars cần có:
 *   SUPABASE_URL              (auto)
 *   SUPABASE_SERVICE_ROLE_KEY (auto)
 *   TELEGRAM_BOT_TOKEN        (set manually in Supabase secrets)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: { id: number; type: string }
  text?: string
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

// ─── Helper: send Telegram message ───────────────────────────────────────────

async function sendMessage(chatId: number, text: string, parseMode = 'HTML') {
  if (!BOT_TOKEN) return
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    })
  } catch (e) {
    console.warn('[sendMessage]', e)
  }
}

// ─── Helper: upsert user vào DB ───────────────────────────────────────────────

async function ensureUser(tgUser: TelegramUser) {
  const id = tgUser.id
  await supabase.from('users').upsert(
    {
      id,
      referral_code: String(id),
      username:   tgUser.username   || '',
      first_name: tgUser.first_name || '',
    },
    { onConflict: 'id', ignoreDuplicates: true }
  )
}

// ─── Helper: lưu referral relationship ───────────────────────────────────────
// Chỉ set referred_by 1 lần. Commission được credit khi user deposit (xem credit-referral function).

async function saveReferral(userId: number, referredByCode: string): Promise<boolean> {
  // Không tự refer
  if (String(userId) === String(referredByCode)) return false

  // Kiểm tra referrer có tồn tại không
  const { data: referrer } = await supabase
    .from('users')
    .select('id, referred_by, referrals, referral_friends')
    .eq('referral_code', referredByCode)
    .maybeSingle()
  if (!referrer) return false

  // Kiểm tra user chưa được refer
  const { data: existing } = await supabase
    .from('users')
    .select('referred_by')
    .eq('id', userId)
    .maybeSingle()

  if (existing?.referred_by && existing.referred_by !== '') {
    console.log(`[referral] user ${userId} already referred by ${existing.referred_by}, skip`)
    return false
  }

  await supabase
    .from('users')
    .update({
      referred_by: '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', referrer.id)
    .eq('referred_by', String(userId))

  // Ghi referred_by
  const { error } = await supabase
    .from('users')
    .update({
      referred_by: referredByCode,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    console.error('[saveReferral] update error', error)
    return false
  }

  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by', referredByCode)
    .neq('id', referrer.id)
    .neq('referral_code', referrer.referred_by || '__none__')

  await supabase
    .from('users')
    .update({
      referral_friends: count || 0,
      referrals: count || 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', referrer.id)

  console.log(`[referral] saved: user ${userId} referred by code ${referredByCode}`)
  return true
}

// ─── Handle /start command ────────────────────────────────────────────────────

async function handleStart(message: TelegramMessage, startParam: string) {
  const tgUser = message.from!
  const userId = tgUser.id

  // 1. Đảm bảo user tồn tại trong DB
  await ensureUser(tgUser)

  // 2. Nếu có start_param hợp lệ (referral code = Telegram ID dạng số)
  const isValidRef = /^\d{5,15}$/.test(startParam)
  let wasReferred = false

  if (isValidRef) {
    wasReferred = await saveReferral(userId, startParam)
  }

  // 3. Gửi welcome message (optional — bỏ nếu không muốn bot reply)
  // Uncomment để bot gửi welcome khi user bắt đầu
  /*
  const welcomeText = wasReferred
    ? `👋 <b>Chào mừng bạn đến TONYield!</b>\n\nBạn được mời bởi một người bạn. Hãy mở app và bắt đầu đầu tư! 🚀`
    : `👋 <b>Chào mừng đến TONYield!</b>\n\nNhấn nút bên dưới để mở app và bắt đầu kiếm lời từ TON! 💎`
  await sendMessage(message.chat.id, welcomeText)
  */

  return { userId, wasReferred }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Chỉ nhận POST từ Telegram
  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 }) // Telegram health check
  }

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  try {
    const message = update.message
    if (!message || !message.from) {
      // Telegram gửi nhiều loại update (callback_query, etc.) — bỏ qua
      return new Response('OK', { status: 200 })
    }

    const text = message.text || ''

    // Xử lý lệnh /start [param]
    if (text.startsWith('/start')) {
      const parts = text.trim().split(/\s+/)
      const startParam = parts[1] || '' // REF123 hoặc empty
      const result = await handleStart(message, startParam)
      console.log('[webhook] /start handled', result)
    }

    // Có thể thêm handlers khác ở đây: /help, /balance, /ref, v.v.

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[telegram-webhook] error', err)
    // Phải trả 200 để Telegram không retry vô hạn
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
