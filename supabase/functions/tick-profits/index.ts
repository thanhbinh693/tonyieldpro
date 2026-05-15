/**
 * tick-profits — Supabase Edge Function
 * ─────────────────────────────────────────────────────────────────────────────
 * Chạy mỗi N phút qua Supabase Cron (pg_cron) HOẶC được gọi qua HTTP webhook.
 * Client KHÔNG CÒN tự tick profit — tất cả logic profit được xử lý server-side.
 *
 * Deploy:
 *   supabase functions deploy tick-profits --no-verify-jwt
 *
 * Cron (Supabase Dashboard → Database → Extensions → pg_cron):
 *   SELECT cron.schedule('tick-profits', '* * * * *',
 *     $$SELECT net.http_post(
 *       url:='https://<PROJECT>.supabase.co/functions/v1/tick-profits',
 *       headers:='{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb
 *     )$$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  // Allow GET (cron) or POST (webhook)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const now = Date.now()
  const nowDay = new Date().getDay() // 0=Sun … 6=Sat

  try {
    // ── 1. Lấy tất cả investments đang active + đã activate + đến hạn tick ──
    const { data: dueInvestments, error } = await supabase
      .from('investments')
      .select('*')
      .eq('status', 'active')
      .eq('activated', true)
      .lte('next_profit_time', now)

    if (error) throw error
    if (!dueInvestments || dueInvestments.length === 0) {
      return new Response(JSON.stringify({ processed: 0, skipped: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let processed = 0
    let skipped = 0

    for (const inv of dueInvestments) {
      const intervalMs = inv.profit_interval_ms
        || (inv.profit_interval_minutes ? inv.profit_interval_minutes * 60_000 : 0)
        || (inv.profit_interval_hours   ? inv.profit_interval_hours   * 3_600_000 : 0)
        || 86_400_000

      const activeDays: number[] = inv.active_days || [1, 2, 3, 4, 5]
      const isActiveDay = activeDays.includes(nowDay)

      // ── Inactive day: advance timer không credit profit ──────────────────
      if (!isActiveDay) {
        const { error: skipErr } = await supabase
          .from('investments')
          .update({
            next_profit_time: inv.next_profit_time + intervalMs,
            updated_at: new Date().toISOString(),
          })
          .eq('id', inv.id)
          .eq('next_profit_time', inv.next_profit_time) // CAS guard

        if (!skipErr) skipped++
        continue
      }

      const ip = +(parseFloat(inv.amount) * (inv.rate / 100)).toFixed(6)
      const iid = inv.invoice_id || String(Number(String(inv.id).replace(/\D/g, '').slice(-9)) % 900000 + 100000)

      // ── Plan completed ────────────────────────────────────────────────────
      if (now >= inv.end_time) {
        const totalProfit = +((Number(inv.earned) || 0) + ip).toFixed(6)
        const principal   = parseFloat(inv.amount)
        const txIdPrf     = `prf-${iid}-${now}`

        const { data: ok } = await supabase.rpc('credit_profit', {
          p_user_id:       inv.user_id,
          p_investment_id: inv.id,
          p_profit:        totalProfit,
          p_new_earned:    0,
          p_next_time:     now,
          p_old_next_time: inv.next_profit_time,
          p_tx_id:         txIdPrf,
          p_tx_label:      `Profit · ${inv.plan}`,
          p_now:           now,
        })

        if (ok) {
          await Promise.all([
            supabase.from('investments')
              .update({ status: 'completed', earned: 0, updated_at: new Date().toISOString() })
              .eq('id', inv.id),
            (async () => {
              const { data: userRow, error: userErr } = await supabase
                .from('users')
                .select('balance')
                .eq('id', inv.user_id)
                .single()
              if (userErr) throw userErr
              const nextBalance = +((Number(userRow?.balance) || 0) + principal).toFixed(6)
              const { error: balErr } = await supabase
                .from('users')
                .update({ balance: nextBalance, updated_at: new Date().toISOString() })
                .eq('id', inv.user_id)
              if (balErr) throw balErr
            })(),
            supabase.from('transactions')
              .upsert({
                id: `ret-${iid}-${now}`,
                user_id:    inv.user_id,
                type:       'deposit',
                label:      `Principal returned · ${inv.plan}`,
                amount:     principal,
                status:     'completed',
                invoice_id: iid,
                plan_id:    inv.plan_id,
                created_at: now,
              }, { onConflict: 'id', ignoreDuplicates: true }),
          ])
          processed++
        }
        continue
      }

      // ── Normal tick ────────────────────────────────────────────────────────
      const newEarned = +((Number(inv.earned) || 0) + ip).toFixed(6)
      const txId      = `prf-${iid}-${now}`

      const { data: ok } = await supabase.rpc('credit_profit', {
        p_user_id:       inv.user_id,
        p_investment_id: inv.id,
        p_profit:        +ip.toFixed(6),
        p_new_earned:    newEarned,
        p_next_time:     inv.next_profit_time + intervalMs,
        p_old_next_time: inv.next_profit_time,
        p_tx_id:         txId,
        p_tx_label:      `Profit · ${inv.plan}`,
        p_now:           now,
      })

      if (ok) processed++
    }

    return new Response(JSON.stringify({ processed, skipped, total: dueInvestments.length }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[tick-profits]', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
