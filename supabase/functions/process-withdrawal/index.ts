/**
 * Edge Function: process-withdrawal
 * ─────────────────────────────────────────────────────────────────
 * Được gọi TỰ ĐỘNG bởi Supabase Database Webhook ngay khi có
 * một transaction withdraw mới với status = 'pending'.
 *
 * KHÔNG cần VPS, KHÔNG có vòng lặp poll — event-driven hoàn toàn.
 *
 * Deploy:
 *   supabase functions deploy process-withdrawal
 *
 * Secrets cần set:
 *   supabase secrets set ADMIN_MNEMONIC="word1 word2 ..."
 *   supabase secrets set TON_NETWORK=testnet
 *   supabase secrets set TON_API_KEY=your_key   (optional)
 *   supabase secrets set WEBHOOK_SECRET=your_secret
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TonClient, WalletContractV4, internal } from 'npm:@ton/ton'
import { mnemonicToWalletKey } from 'npm:@ton/crypto'
import { Address } from 'npm:@ton/core'

// ─── ENV ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_KEY') || ''
const ADMIN_MNEMONIC       = Deno.env.get('ADMIN_MNEMONIC')!
const TON_NETWORK          = Deno.env.get('TON_NETWORK') || 'testnet'
const TON_API_KEY          = Deno.env.get('TON_API_KEY') || ''
const WEBHOOK_SECRET       = Deno.env.get('WEBHOOK_SECRET') || ''

const NETWORK_FEE    = 0.015
const CONFIRM_TIMEOUT = 90_000   // 90s chờ seqno tăng
const ENDPOINT = TON_NETWORK === 'mainnet'
  ? 'https://toncenter.com/api/v2/jsonRPC'
  : 'https://testnet.toncenter.com/api/v2/jsonRPC'

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('[process-withdrawal] Missing SUPABASE_SERVICE_ROLE_KEY secret')
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function parseToFriendly(raw: string): string | null {
  try {
    return Address.parse(raw.trim()).toString({
      bounceable: false,
      urlSafe: true,
      testOnly: TON_NETWORK === 'testnet',
    })
  } catch {
    return null
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }

  // ── Xác thực webhook secret ─────────────────────────────────────────────
  if (WEBHOOK_SECRET) {
    const authHeader = req.headers.get('x-webhook-secret') || ''
    if (authHeader !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
    }
  }

  try {
    // ── Đọc payload từ Database Webhook ──────────────────────────────────
    // Supabase Webhook gửi: { type: 'INSERT', table: 'transactions', record: {...} }
    const payload = await req.json()
    const tx = payload?.record

    if (!tx || tx.type !== 'withdraw' || tx.status !== 'pending') {
      // Không phải withdraw pending → bỏ qua (webhook có thể fire cho nhiều event)
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: cors })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── 1. Claim transaction (tránh double-send nếu webhook fire 2 lần) ──
    const { error: claimErr, count } = await supabase
      .from('transactions')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', tx.id)
      .eq('status', 'pending')  // CAS: chỉ update nếu vẫn còn pending
      .select('id', { count: 'exact', head: true })

    if (claimErr || count === 0) {
      // Đã được xử lý bởi lần gọi khác → skip
      console.log(`[Skip] tx=${tx.id} already claimed or error`)
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: cors })
    }

    const amount   = Number(tx.amount)
    const toWallet = parseToFriendly(tx.to_wallet)

    // ── 2. Validate địa chỉ ────────────────────────────────────────────
    if (!toWallet) {
      await markFailed(supabase, tx, `Invalid wallet address: "${tx.to_wallet}"`)
      return new Response(JSON.stringify({ error: 'Invalid wallet' }), { status: 400, headers: cors })
    }

    // ── 3. Verify user còn tồn tại & wallet khớp ──────────────────────
    const { data: userRow } = await supabase
      .from('users')
      .select('balance, wallet_addr, status')
      .eq('id', tx.user_id)
      .maybeSingle()

    if (!userRow) {
      await markFailed(supabase, tx, `User ${tx.user_id} not found`)
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: cors })
    }

    if (userRow.status === 'banned') {
      await markFailed(supabase, tx, 'User is banned')
      return new Response(JSON.stringify({ error: 'User banned' }), { status: 403, headers: cors })
    }

    // Security: wallet trong tx phải khớp wallet đã lưu
    if (userRow.wallet_addr) {
      const storedNorm = parseToFriendly(userRow.wallet_addr) || userRow.wallet_addr
      if (storedNorm !== toWallet) {
        await markFailed(supabase, tx, `Wallet mismatch: stored=${storedNorm}, requested=${toWallet}`)
        return new Response(JSON.stringify({ error: 'Wallet mismatch' }), { status: 400, headers: cors })
      }
    }

    // ── 4. Khởi tạo admin wallet ───────────────────────────────────────
    const keyPair  = await mnemonicToWalletKey(ADMIN_MNEMONIC.trim().split(/\s+/))
    const ton      = new TonClient({ endpoint: ENDPOINT, ...(TON_API_KEY ? { apiKey: TON_API_KEY } : {}) })
    const contract = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
    const wallet   = ton.open(contract)

    // ── 5. Kiểm tra balance admin ──────────────────────────────────────
    const adminBal = Number(await wallet.getBalance()) / 1e9
    const needed   = amount + NETWORK_FEE + 0.05

    if (adminBal < needed) {
      // Không đủ tiền → đẩy lại pending để retry sau
      await supabase.from('transactions').update({
        status: 'pending',
        fail_reason: `Admin balance insufficient (have ${adminBal.toFixed(3)}, need ${needed.toFixed(3)})`,
        updated_at: new Date().toISOString(),
      }).eq('id', tx.id)

      console.error(`[CRITICAL] Admin balance low! Have ${adminBal} TON, need ${needed} TON`)
      return new Response(JSON.stringify({ error: 'Admin balance insufficient' }), { status: 503, headers: cors })
    }

    // ── 6. Gửi TON ────────────────────────────────────────────────────
    const seqno = await wallet.getSeqno()
    await wallet.sendTransfer({
      secretKey: keyPair.secretKey,
      seqno,
      messages: [internal({
        to:     Address.parse(toWallet),
        value:  BigInt(Math.round(amount * 1e9)),
        body:   `TonYield ${tx.id}`,
        bounce: false,
      })],
      sendMode: 3,
    })

    console.log(`[Sent] ${amount} TON → ${toWallet} (tx=${tx.id})`)

    // ── 7. Chờ xác nhận seqno tăng (tối đa 90s) ──────────────────────
    const checks   = Math.ceil(CONFIRM_TIMEOUT / 5000)
    let confirmed  = false

    for (let i = 0; i < checks; i++) {
      await sleep(5000)
      try {
        if (await wallet.getSeqno() > seqno) { confirmed = true; break }
      } catch { /* retry */ }
    }

    // ── 8. Update status ──────────────────────────────────────────────
    if (confirmed) {
      await supabase.from('transactions').update({
        status: 'completed',
        fail_reason: null,
        updated_at: new Date().toISOString(),
      }).eq('id', tx.id)

      // Cộng total_withdraw
      const { data: u } = await supabase.from('users')
        .select('total_withdraw').eq('id', tx.user_id).maybeSingle()
      await supabase.from('users').update({
        total_withdraw: (Number(u?.total_withdraw) || 0) + amount,
        updated_at: new Date().toISOString(),
      }).eq('id', tx.user_id)

      console.log(`[✓ Confirmed] tx=${tx.id}`)
      return new Response(JSON.stringify({ ok: true, confirmed: true }), { headers: cors })

    } else {
      // Đã gửi nhưng chưa confirm trong 90s — tiền vẫn đang trên đường
      // Đánh dấu sent thay vì pending để tránh gửi lại
      await supabase.from('transactions').update({
        status: 'sent',
        fail_reason: 'Sent but awaiting blockchain confirmation',
        updated_at: new Date().toISOString(),
      }).eq('id', tx.id)

      console.warn(`[Sent, unconfirmed] tx=${tx.id} — seqno not increased within 90s`)
      return new Response(JSON.stringify({ ok: true, confirmed: false, note: 'Transaction sent, awaiting confirmation' }), { headers: cors })
    }

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[process-withdrawal]', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: cors })
  }
})

// ─── MARK FAILED + REFUND ─────────────────────────────────────────────────────
async function markFailed(supabase: ReturnType<typeof createClient>, tx: Record<string, unknown>, reason: string) {
  console.error(`[Failed] tx=${tx.id} reason=${reason}`)

  await supabase.from('transactions').update({
    status: 'failed',
    fail_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq('id', tx.id)

  // Hoàn tiền về balance user
  const { data: u } = await supabase.from('users')
    .select('balance').eq('id', tx.user_id).maybeSingle()

  if (u) {
    await supabase.from('users').update({
      balance:    Number(u.balance) + Number(tx.amount),
      updated_at: new Date().toISOString(),
    }).eq('id', tx.user_id)
    console.log(`[Refunded] user=${tx.user_id} +${tx.amount} TON`)
  }
}
