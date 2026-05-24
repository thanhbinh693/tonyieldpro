/**
 * Edge Function: process-withdrawal
 *
 * Handles TonYield withdrawal payouts. Safe properties:
 * - claims pending rows with compare-and-set before sending
 * - never retries rows marked sent/completed
 * - refunds user balance if failure happens before broadcast
 * - marks sent immediately after broadcast so admin retry never waits on confirmation
 * - pending retries are explicit admin actions
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TonClient, WalletContractV4, internal } from 'npm:@ton/ton'
import { mnemonicToWalletKey } from 'npm:@ton/crypto'
import { Address } from 'npm:@ton/core'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_KEY') || ''
const ADMIN_MNEMONIC = Deno.env.get('ADMIN_MNEMONIC') || ''
const TON_NETWORK = Deno.env.get('TON_NETWORK') || 'testnet'
const TON_API_KEY = Deno.env.get('TON_API_KEY') || ''
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') || ''

const SEQNO_TIMEOUT_MS = 7_000
const SEND_TIMEOUT_MS = 10_000
const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

type SupabaseClient = ReturnType<typeof createClient>
type WithdrawTx = {
  id: string
  user_id: number
  type: string
  amount: number | string
  status: string
  to_wallet: string
}

class ProcessorTimeoutError extends Error {}
class RetryableProcessorError extends Error {}
class SubmittedUnknownError extends Error {}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405)

  if (!SUPABASE_SERVICE_KEY) return json({ ok: false, error: 'Missing service role key' }, 500)
  if (!ADMIN_MNEMONIC.trim()) return json({ ok: false, error: 'Missing ADMIN_MNEMONIC' }, 500)

  if (!isAuthorizedProcessorRequest(req)) {
    return json({ ok: false, error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const payload = await req.json()

    const tx = payload?.record as WithdrawTx | undefined
    const force = Boolean(payload?.force)
    if (!isProcessableWithdraw(tx, force)) {
      return json({ ok: true, skipped: true })
    }

    return await processWithdrawal(supabase, tx, force)
  } catch (err) {
    console.error('[process-withdrawal]', err)
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

async function processWithdrawal(supabase: SupabaseClient, tx: WithdrawTx, force = false) {
  let transferSubmitted = false

  let claimQuery = supabase
    .from('transactions')
    .update({
      status: 'processing',
      fail_reason: 'Preparing TON transfer',
      updated_at: new Date().toISOString(),
    })
    .eq('id', tx.id)
    .eq('type', 'withdraw')
  claimQuery = force ? claimQuery.in('status', ['pending', 'processing']) : claimQuery.eq('status', 'pending')
  const claim = await claimQuery.select('id', { count: 'exact', head: true })

  if (claim.error) throw claim.error
  if (!claim.count) return json({ ok: true, skipped: true, reason: 'already claimed' })

  try {
    const network = await getActiveNetwork(supabase)
    const toWallet = parseToFriendly(String(tx.to_wallet || ''), network)
    if (!toWallet) {
      await failAndRefund(supabase, tx, `Invalid wallet address: "${tx.to_wallet}"`)
      return json({ ok: false, error: 'Invalid wallet' }, 400)
    }

    const amount = Number(tx.amount)
    if (!amount || amount <= 0) {
      await failAndRefund(supabase, tx, `Invalid withdrawal amount: "${tx.amount}"`)
      return json({ ok: false, error: 'Invalid amount' }, 400)
    }

    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('status')
      .eq('id', tx.user_id)
      .maybeSingle()
    if (userErr) throw userErr
    if (!userRow) {
      await failAndRefund(supabase, tx, `User ${tx.user_id} not found`)
      return json({ ok: false, error: 'User not found' }, 404)
    }
    if (userRow.status === 'banned') {
      await failAndRefund(supabase, tx, 'User is banned')
      return json({ ok: false, error: 'User banned' }, 403)
    }

    const words = ADMIN_MNEMONIC.trim().split(/\s+/)
    const keyPair = await mnemonicToWalletKey(words)
    const ton = new TonClient({ endpoint: getEndpoint(network), ...(TON_API_KEY ? { apiKey: TON_API_KEY } : {}) })
    const contract = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
    const wallet = ton.open(contract)

    const seqno = await withTimeout(wallet.getSeqno(), SEQNO_TIMEOUT_MS, 'TON seqno request timed out')
    await supabase.from('transactions').update({
      status: 'processing',
      fail_reason: 'Submitting transfer to TON network',
      updated_at: new Date().toISOString(),
    }).eq('id', tx.id)

    try {
      await withTimeout(
        wallet.sendTransfer({
          secretKey: keyPair.secretKey,
          seqno,
          messages: [internal({
            to: Address.parse(toWallet),
            value: BigInt(Math.round(amount * 1e9)),
            body: `TonYield ${tx.id}`,
            bounce: false,
          })],
          sendMode: 3,
        }),
        SEND_TIMEOUT_MS,
        'TON transfer submit timed out',
      )
      transferSubmitted = true
    } catch (err) {
      if (err instanceof ProcessorTimeoutError) {
        throw new SubmittedUnknownError(err.message)
      }
      throw new RetryableProcessorError(err instanceof Error ? err.message : String(err))
    }

    await markSent(supabase, tx, amount, 'Submitted to TON network')
    return json({ ok: true, status: 'sent' })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[processWithdrawal]', tx.id, reason)

    if (transferSubmitted || err instanceof SubmittedUnknownError) {
      await markSent(supabase, tx, Number(tx.amount), `Submit timed out; check TON network before retrying: ${reason}`)
      return json({ ok: true, status: 'sent', warning: reason })
    }

    if (err instanceof ProcessorTimeoutError || err instanceof RetryableProcessorError) {
      await resetToPending(supabase, tx, reason)
      return json({ ok: false, retryable: true, error: reason }, 503)
    } else {
      await failAndRefund(supabase, tx, reason)
    }

    return json({ ok: false, error: reason }, 500)
  }
}

async function markSent(supabase: SupabaseClient, tx: WithdrawTx, amount: number, reason: string) {
  await supabase.from('transactions').update({
    status: 'sent',
    fail_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq('id', tx.id)

  const { data: userRow } = await supabase
    .from('users')
    .select('total_withdraw')
    .eq('id', tx.user_id)
    .maybeSingle()

  await supabase.from('users').update({
    total_withdraw: (Number(userRow?.total_withdraw) || 0) + amount,
    updated_at: new Date().toISOString(),
  }).eq('id', tx.user_id)
}

async function resetToPending(supabase: SupabaseClient, tx: WithdrawTx, reason: string) {
  await supabase.from('transactions').update({
    status: 'pending',
    fail_reason: `Retryable: ${reason}`,
    updated_at: new Date().toISOString(),
  }).eq('id', tx.id)
}

async function failAndRefund(supabase: SupabaseClient, tx: WithdrawTx, reason: string) {
  await supabase.from('transactions').update({
    status: 'failed',
    fail_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq('id', tx.id)

  const { data: userRow } = await supabase
    .from('users')
    .select('balance')
    .eq('id', tx.user_id)
    .maybeSingle()

  if (userRow) {
    await supabase.from('users').update({
      balance: (Number(userRow.balance) || 0) + Number(tx.amount),
      updated_at: new Date().toISOString(),
    }).eq('id', tx.user_id)
  }
}

async function getActiveNetwork(supabase: SupabaseClient) {
  const { data } = await supabase
    .from('admin_config')
    .select('ton_network')
    .eq('id', 1)
    .maybeSingle()
  if (data?.ton_network === 'mainnet') return 'mainnet'
  return TON_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
}

function getEndpoint(network: string) {
  return network === 'mainnet'
    ? 'https://toncenter.com/api/v2/jsonRPC'
    : 'https://testnet.toncenter.com/api/v2/jsonRPC'
}

function parseToFriendly(raw: string, network: string) {
  try {
    return Address.parse(raw.trim()).toString({
      bounceable: false,
      urlSafe: true,
      testOnly: network !== 'mainnet',
    })
  } catch {
    return null
  }
}

function isProcessableWithdraw(tx: WithdrawTx | undefined, force = false): tx is WithdrawTx {
  return !!tx && tx.type === 'withdraw' && (tx.status === 'pending' || (force && tx.status === 'processing'))
}

function isAuthorizedProcessorRequest(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const apikey = req.headers.get('apikey') || ''
  const headerSecret = req.headers.get('x-webhook-secret') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()

  if (bearer && bearer === SUPABASE_SERVICE_KEY) return true
  if (apikey && apikey === SUPABASE_SERVICE_KEY) return true
  if (WEBHOOK_SECRET && headerSecret === WEBHOOK_SECRET) return true
  return !WEBHOOK_SECRET && !headerSecret
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ProcessorTimeoutError(message)), ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors })
}
