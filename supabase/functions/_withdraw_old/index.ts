// Supabase Edge Function: withdraw
// Deploy: supabase functions deploy withdraw
// Set secrets: supabase secrets set ADMIN_MNEMONIC="word1 word2 ..." TON_NETWORK=testnet TON_API_KEY=xxx

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TonClient, WalletContractV4, internal } from 'npm:@ton/ton'
import { mnemonicToWalletKey } from 'npm:@ton/crypto'
import { Address } from 'npm:@ton/core'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_KEY')!
const ADMIN_MNEMONIC       = Deno.env.get('ADMIN_MNEMONIC')!
const TON_NETWORK          = Deno.env.get('TON_NETWORK') || 'testnet'
const TON_API_KEY          = Deno.env.get('TON_API_KEY') || ''
const NETWORK_FEE          = 0.015

const ENDPOINT = TON_NETWORK === 'mainnet'
  ? 'https://toncenter.com/api/v2/jsonRPC'
  : 'https://testnet.toncenter.com/api/v2/jsonRPC'

// Validate TON user-friendly address — TEP-0002
// E=bounceable mainnet | U=non-bounceable mainnet | k=bounceable testnet | 0=non-bounceable testnet
// Byte 2 (workchain): Q=basechain(0) | g=masterchain(-1)
function isValidTonAddress(addr: string): boolean {
  return /^[EUk0][Qg][A-Za-z0-9+/_-]{46}$/.test(addr)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }})
  }

  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

  try {
    const { amount, toWallet, userId } = await req.json()

    // ── 1. Validate input ─────────────────────────────────────────────────────
    if (!amount || Number(amount) < 0.01)
      return new Response(JSON.stringify({ error: 'Amount too small' }), { status: 400, headers: cors })

    if (!toWallet || !isValidTonAddress(String(toWallet)))
      return new Response(JSON.stringify({ error: 'Invalid wallet address' }), { status: 400, headers: cors })

    if (!userId)
      return new Response(JSON.stringify({ error: 'Missing userId' }), { status: 400, headers: cors })

    const amt = Number(amount)
    const uid = Number(userId)

    // ── 2. Verify user balance ────────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: user, error: userErr } = await supabase
      .from('users').select('balance').eq('id', uid).maybeSingle()

    if (userErr || !user)
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: cors })

    if (Number(user.balance) < amt)
      return new Response(JSON.stringify({ error: 'Insufficient balance' }), { status: 400, headers: cors })

    // ── 3. Init admin wallet ──────────────────────────────────────────────────
    const keyPair  = await mnemonicToWalletKey(ADMIN_MNEMONIC.trim().split(/\s+/))
    const ton      = new TonClient({ endpoint: ENDPOINT, ...(TON_API_KEY ? { apiKey: TON_API_KEY } : {}) })
    const contract = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
    const wallet   = ton.open(contract)

    // ── 4. Check admin balance ────────────────────────────────────────────────
    const adminBal = Number(await wallet.getBalance()) / 1e9
    if (adminBal < amt + NETWORK_FEE + 0.05)
      return new Response(JSON.stringify({ error: 'Service unavailable. Please try later.' }), { status: 503, headers: cors })

    // ── 5. Deduct user balance trước khi gửi (tránh double-spend) ────────────
    const newBalance = +(Number(user.balance) - amt).toFixed(6)
    const txId = `tx-${uid}-${Date.now()}`

    const { error: deductErr } = await supabase.from('users').update({
      balance:     newBalance,
      wallet_addr: toWallet,
      updated_at:  new Date().toISOString(),
    }).eq('id', uid)

    if (deductErr) {
      console.error('[deduct]', deductErr)
      return new Response(JSON.stringify({ error: 'Failed to update balance' }), { status: 500, headers: cors })
    }

    // Ghi transaction processing
    await supabase.from('transactions').insert({
      id:         txId,
      user_id:    uid,
      type:       'withdraw',
      label:      `Withdrawal → ${toWallet.slice(0, 8)}...`,
      amount:     amt,
      status:     'processing',
      to_wallet:  toWallet,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    // ── 6. Gửi TON ───────────────────────────────────────────────────────────
    const seqno = await wallet.getSeqno()
    await wallet.sendTransfer({
      secretKey: keyPair.secretKey,
      seqno,
      messages: [internal({
        to:     Address.parse(toWallet),
        value:  BigInt(Math.round(amt * 1e9)),
        body:   `TonYield ${txId}`,
        bounce: false,
      })],
      sendMode: 3,
    })

    // ── 7. Poll confirm seqno (tối đa 60s) ───────────────────────────────────
    let confirmed = false
    for (let i = 0; i < 12; i++) {
      await sleep(5000)
      try { if (await wallet.getSeqno() > seqno) { confirmed = true; break } } catch (_) { /* retry */ }
    }

    // ── 8. Update status ──────────────────────────────────────────────────────
    if (confirmed) {
      await supabase.from('transactions').update({
        status: 'completed', updated_at: new Date().toISOString(),
      }).eq('id', txId)

      await supabase.from('users').update({
        total_withdraw: supabase.rpc('increment_withdraw', { user_id: uid, amount: amt }),
        updated_at: new Date().toISOString(),
      }).eq('id', uid)

      return new Response(JSON.stringify({ ok: true, txId }), { status: 200, headers: cors })
    } else {
      // Giao dịch đã gửi nhưng chưa confirm trong 60s — vẫn tính là thành công
      // (seqno sẽ tăng sau, tiền vẫn đến ví user)
      await supabase.from('transactions').update({
        status: 'pending', fail_reason: 'Awaiting blockchain confirmation',
        updated_at: new Date().toISOString(),
      }).eq('id', txId)

      return new Response(JSON.stringify({ ok: true, txId, note: 'Transaction sent, awaiting confirmation' }), { status: 200, headers: cors })
    }

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[withdraw]', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: cors })
  }
})
