/**
 * credit-referral - Supabase Edge Function
 *
 * Legacy endpoint called after completed deposits.
 * Referral reward is now a fixed admin_config.referral_reward_ton amount,
 * credited once when the invitee has unlocked withdrawals.
 *
 * Idempotency is handled by the credit_referral_reward RPC using invitee id.
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
  if (!deposit_tx_id) {
    return json({ ok: false, error: 'Missing deposit_tx_id' }, 400)
  }

  try {
    const { data: depositTx } = await supabase
      .from('transactions')
      .select('id, user_id, type, status, amount')
      .eq('id', deposit_tx_id)
      .eq('user_id', user_id)
      .eq('type', 'deposit')
      .eq('status', 'completed')
      .maybeSingle()

    if (!depositTx || Math.abs(Number(depositTx.amount)) !== Number(deposit_amount)) {
      return json({ ok: false, error: 'Deposit transaction not verified' }, 403)
    }

    const now = Date.now()
    const { data: credited, error: rpcErr } = await supabase.rpc('credit_referral_reward', {
      p_invitee_user_id: Number(user_id),
      p_now: now,
    })
    if (rpcErr) throw rpcErr

    console.log(`[credit-referral] deposit=${deposit_tx_id} user=${user_id} credited=${Boolean(credited)}`)

    return json({
      ok: true,
      credited: Boolean(credited),
      deposit_volume: deposit_amount,
      new_friend: false,
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
