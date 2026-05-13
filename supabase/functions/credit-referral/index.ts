/**
 * credit-referral - Supabase Edge Function
 *
 * Called after every completed deposit. It credits the referrer by
 * admin_config.referral_rate percent of that deposit.
 *
 * Idempotency is based on deposit_tx_id: the same deposit cannot credit twice.
 * referral_friends counts unique invitees, while referral_commission and
 * referral_deposit_volume grow on every deposit made by invited users.
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
    return json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  const { user_id, deposit_amount, deposit_tx_id } = body
  if (!user_id || !deposit_amount || deposit_amount <= 0) {
    return json({ ok: false, error: 'Missing user_id or deposit_amount' }, 400)
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('referred_by, username, first_name')
      .eq('id', user_id)
      .maybeSingle()

    if (!user?.referred_by) {
      return json({ ok: true, credited: false, reason: 'no referrer' })
    }

    const { data: referrer } = await supabase
      .from('users')
      .select('id, balance, referral_friends, referral_commission, referral_deposit_volume')
      .eq('referral_code', user.referred_by)
      .maybeSingle()

    if (!referrer || Number(referrer.id) === Number(user_id)) {
      return json({ ok: true, credited: false, reason: 'referrer not found' })
    }

    const { data: cfg } = await supabase
      .from('admin_config')
      .select('referral_rate')
      .eq('id', 1)
      .maybeSingle()

    const rate = Number(cfg?.referral_rate) || 5
    const commission = +(deposit_amount * (rate / 100)).toFixed(6)
    if (commission <= 0) {
      return json({ ok: true, credited: false, reason: 'commission = 0' })
    }

    const safeDepositTxId = deposit_tx_id || `${user_id}-${Date.now()}`
    const refTxId = `ref-${referrer.id}-${user_id}-${safeDepositTxId}`

    const { data: existingTx } = await supabase
      .from('transactions')
      .select('id')
      .eq('id', refTxId)
      .maybeSingle()

    if (existingTx) {
      return json({ ok: true, credited: false, reason: 'already credited' })
    }

    const { count: previousReferralCredits } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', referrer.id)
      .eq('type', 'referral')
      .ilike('id', `ref-${referrer.id}-${user_id}-%`)

    const now = Date.now()
    const inviteeName = user.username || user.first_name || String(user_id)
    const isNewFriend = (previousReferralCredits || 0) === 0

    const { error: updateErr } = await supabase
      .from('users')
      .update({
        balance: +((Number(referrer.balance) || 0) + commission).toFixed(6),
        referral_friends: (Number(referrer.referral_friends) || 0) + (isNewFriend ? 1 : 0),
        referral_commission: +((Number(referrer.referral_commission) || 0) + commission).toFixed(6),
        referral_deposit_volume: +((Number(referrer.referral_deposit_volume) || 0) + deposit_amount).toFixed(6),
        updated_at: new Date().toISOString(),
      })
      .eq('id', referrer.id)

    if (updateErr) throw updateErr

    const { error: txErr } = await supabase.from('transactions').insert({
      id: refTxId,
      user_id: referrer.id,
      type: 'referral',
      label: `Referral - @${inviteeName} deposit ${deposit_amount} TON`,
      amount: commission,
      status: 'completed',
      invoice_id: safeDepositTxId,
      created_at: now,
    })

    if (txErr) throw txErr

    console.log(`[credit-referral] deposit=${safeDepositTxId} user=${user_id} referrer=${referrer.id} +${commission} TON`)

    return json({
      ok: true,
      credited: true,
      referrer_id: referrer.id,
      commission,
      deposit_volume: deposit_amount,
      new_friend: isNewFriend,
    })
  } catch (err) {
    console.error('[credit-referral]', err)
    return json({ ok: false, error: String(err) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
