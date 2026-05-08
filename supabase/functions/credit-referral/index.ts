/**
 * credit-referral — Supabase Edge Function
 * ─────────────────────────────────────────────────────────────────────────────
 * Được gọi server-side khi user deposit lần đầu.
 * Kiểm tra user có referred_by không → credit commission cho referrer.
 *
 * Tách ra Edge Function riêng để:
 *   1. Chạy với SERVICE_ROLE (đủ quyền đọc/ghi bất kỳ user)
 *   2. Atomic — không thể bị client can thiệp
 *   3. Idempotent — lần deposit thứ 2+ không credit lại
 *
 * Request body:
 *   { user_id: number, deposit_amount: number, deposit_tx_id: string }
 *
 * Deploy:
 *   supabase functions deploy credit-referral --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  let body: { user_id: number; deposit_amount: number; deposit_tx_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { user_id, deposit_amount, deposit_tx_id } = body
  if (!user_id || !deposit_amount) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing user_id or deposit_amount' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // ── 1. Check user có referred_by không ──────────────────────────────────
    const { data: user } = await supabase
      .from('users')
      .select('referred_by, username, first_name')
      .eq('id', user_id)
      .maybeSingle()

    if (!user?.referred_by || user.referred_by === '') {
      return new Response(JSON.stringify({ ok: true, credited: false, reason: 'no referrer' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── 2. Chỉ credit lần deposit đầu tiên ──────────────────────────────────
    const { count: depositCount } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .eq('type', 'deposit')

    if ((depositCount || 0) > 1) {
      // Đã deposit trước rồi (count > 1 vì tx hiện tại đã được insert trước khi gọi hàm này)
      return new Response(JSON.stringify({ ok: true, credited: false, reason: 'not first deposit' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── 3. Tìm referrer theo referral_code ──────────────────────────────────
    const { data: referrer } = await supabase
      .from('users')
      .select('id, balance, referral_friends, referral_commission')
      .eq('referral_code', user.referred_by)
      .maybeSingle()

    if (!referrer || Number(referrer.id) === Number(user_id)) {
      return new Response(JSON.stringify({ ok: true, credited: false, reason: 'referrer not found' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── 4. Lấy referral_rate từ admin_config ─────────────────────────────────
    const { data: cfg } = await supabase
      .from('admin_config')
      .select('referral_rate')
      .eq('id', 1)
      .maybeSingle()

    const rate = Number(cfg?.referral_rate) || 5
    const commission = +(deposit_amount * (rate / 100)).toFixed(6)

    if (commission <= 0) {
      return new Response(JSON.stringify({ ok: true, credited: false, reason: 'commission = 0' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── 5. Idempotency check — tránh double credit ────────────────────────────
    const refTxId = `ref-${referrer.id}-${user_id}-${deposit_tx_id || Date.now()}`
    const { data: existingTx } = await supabase
      .from('transactions')
      .select('id')
      .eq('id', refTxId)
      .maybeSingle()

    if (existingTx) {
      return new Response(JSON.stringify({ ok: true, credited: false, reason: 'already credited' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── 6. Credit commission cho referrer ────────────────────────────────────
    const now = Date.now()
    const inviteeName = user.username || user.first_name || String(user_id)

    const newBalance    = +((Number(referrer.balance) || 0) + commission).toFixed(6)
    const newFriends    = (referrer.referral_friends || 0) + 1
    const newCommission = +((Number(referrer.referral_commission) || 0) + commission).toFixed(6)

    // Update referrer atomically
    const { error: updateErr } = await supabase
      .from('users')
      .update({
        balance:             newBalance,
        referral_friends:    newFriends,
        referral_commission: newCommission,
        updated_at:          new Date().toISOString(),
      })
      .eq('id', referrer.id)

    if (updateErr) throw updateErr

    // Insert referral transaction
    await supabase.from('transactions').insert({
      id:         refTxId,
      user_id:    referrer.id,
      type:       'referral',
      label:      `Referral · @${inviteeName}`,
      amount:     commission,
      status:     'completed',
      created_at: now,
    })

    console.log(`[credit-referral] user ${user_id} → referrer ${referrer.id}: +${commission} TON`)

    return new Response(
      JSON.stringify({ ok: true, credited: true, referrer_id: referrer.id, commission }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[credit-referral]', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
