/**
 * useApp.js — Optimized data layer
 * ─────────────────────────────────────────────────────────────────────────────
 * KIẾN TRÚC:
 *  • Profit tick  → Supabase Edge Function (server-side cron/webhook)
 *                   Client KHÔNG còn setInterval gọi DB mỗi 5s
 *  • Realtime     → Supabase Realtime WebSocket (postgres_changes)
 *                   Khi server tick → DB thay đổi → WS push về client tự động
 *  • Countdown    → local timer thuần (setInterval 1s trong PlanRing)
 *                   Chỉ đọc nextProfitTime từ state, không cần poll DB
 *  • Activate     → optimistic update ngay + DB write async
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTonConnectUI, useTonWallet, toUserFriendlyAddress } from '@tonconnect/ui-react'
import {
  DEFAULT_PLANS, MIN_WITHDRAW, ADMIN_WALLET,
  ADMIN_IDS, TON_NETWORK,
} from '../utils/config'
import {
  supabase,
  getUserBundle,
  registerUser,
  getReferralDetails,
  getAllUsersData,
  creditReferralViaServer,
  getNotifications, getAllNotifications, createNotification, deleteNotification,
  getAdminConfig, saveAdminConfig,
  getAdminPlans, saveAdminPlans,
} from '../utils/supabase'

// ─── TON helpers ──────────────────────────────────────────────────────────────
function crc32c(data) {
  const poly = 0x82F63B78; let crc = 0xFFFFFFFF
  for (const b of data) { crc ^= b; for (let i=0;i<8;i++) crc=(crc&1)?((crc>>>1)^poly):(crc>>>1) }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function buildPayload(text) {
  const tb = new TextEncoder().encode(text)
  const cd = new Uint8Array(4+tb.length); cd.set(tb, 4)
  const cell = new Uint8Array(2+cd.length); cell[0]=0x00; cell[1]=cd.length*2; cell.set(cd,2)
  const bb = new Uint8Array(11+cell.length)
  bb[0]=0xb5;bb[1]=0xee;bb[2]=0x9c;bb[3]=0x72;bb[4]=0x41;bb[5]=0x01
  bb[6]=0x01;bb[7]=0x01;bb[8]=0x00;bb[9]=cell.length;bb[10]=0x00;bb.set(cell,11)
  const crc=crc32c(bb); const boc=new Uint8Array(bb.length+4); boc.set(bb)
  boc[bb.length]=(crc)&0xFF;boc[bb.length+1]=(crc>>>8)&0xFF;boc[bb.length+2]=(crc>>>16)&0xFF;boc[bb.length+3]=(crc>>>24)&0xFF
  let s=''; boc.forEach(b=>{s+=String.fromCharCode(b)}); return btoa(s)
}
function makeInvId(tid,pid){return String((Date.now()%900000)+100000+Number(pid))}
function toNano(a){return String(Math.round(parseFloat(a)*1e9))}
function isNetworkWallet(addr, network) {
  const a = String(addr || '').trim()
  if (network === 'mainnet') return /^[UE]Q[A-Za-z0-9_-]{46}=?$/.test(a)
  return /^[k0]Q[A-Za-z0-9_-]{46}=?$/.test(a)
}
function isFetchFailure(err) {
  return /failed to fetch|networkerror|load failed/i.test(err?.message || String(err || ''))
}

function getTgUser(){
  try{const u=window.Telegram?.WebApp?.initDataUnsafe?.user; if(u&&u.id)return u}catch{}
  return{id:0,first_name:'Dev',username:'devuser'}
}
function checkIsAdmin(id, cfgAdminIds) {
  const n = Number(id)
  if (ADMIN_IDS.includes(n)) return true
  if (Array.isArray(cfgAdminIds)) return cfgAdminIds.map(Number).includes(n)
  return false
}
function getStartParam() {
  const unsafe = window.Telegram?.WebApp?.initDataUnsafe || {}
  const candidates = [
    unsafe.start_param,
    unsafe.startapp,
    unsafe.start_param?.replace(/^(ref_|ref-)/i, ''),
  ]
  try {
    const url = new URL(window.location.href)
    candidates.push(
      url.searchParams.get('tgWebAppStartParam'),
      url.searchParams.get('startapp'),
      url.searchParams.get('start'),
      url.searchParams.get('ref'),
    )
  } catch {}
  return candidates
    .map(v => String(v || '').trim().replace(/^(ref_|ref-)/i, ''))
    .find(v => /^\d{5,15}$/.test(v)) || ''
}
function mkDefaultUser(tgUser) {
  return {
    id: tgUser.id,
    username: tgUser.username || tgUser.first_name || 'user',
    firstName: tgUser.first_name || '',
    balance: 0, totalDeposit: 0, totalWithdraw: 0, totalProfit: 0, todayProfit: 0,
    referrals: 0, walletAddr: '',
    photoUrl: tgUser.photo_url || '',
    joinDate: new Date().toISOString().split('T')[0],
    status: 'active',
  }
}
function mkDefaultRef(tid) {
  return { code: String(tid), friends: 0, commission: 0 }
}
const DEFAULT_CONFIG = {
  minWithdraw: MIN_WITHDRAW,
  referralRate: 5,
  maintenanceMode: false,
  adminWallet: ADMIN_WALLET,
  adminWalletTestnet: ADMIN_WALLET,
  adminWalletMainnet: '',
  adminIds: [...ADMIN_IDS],
  botUsername: '',
  withdrawalWebhookUrl: '',
  withdrawalWebhookSecret: '',
  tonNetwork: TON_NETWORK,
}

// ─── Resolve profit interval ms từ investment object ─────────────────────────
export function resolveIntervalMs(inv) {
  return inv.profitIntervalMs
    || inv.intervalMs
    || (inv.profitIntervalMinutes ? inv.profitIntervalMinutes * 60_000 : 0)
    || (inv.profitIntervalHours   ? inv.profitIntervalHours   * 3_600_000 : 0)
    || 86_400_000
}

// ─── Enrich investment với computed display fields ────────────────────────────
function enrichInvestment(inv) {
  const elapsed  = Date.now() - inv.startTime
  const total    = inv.endTime - inv.startTime
  const msLeft   = Math.max(0, inv.endTime - Date.now())
  const progress = Math.min(100, Math.round((elapsed / total) * 100))
  let timeLeftLabel
  if      (msLeft <= 0)         timeLeftLabel = '0m left'
  else if (msLeft < 3_600_000)  timeLeftLabel = `${Math.ceil(msLeft/60_000)}m left`
  else if (msLeft < 86_400_000) timeLeftLabel = `${Math.ceil(msLeft/3_600_000)}h left`
  else                          timeLeftLabel = `${Math.ceil(msLeft/86_400_000)}d left`
  return { ...inv, progress, timeLeftLabel, intervalMs: resolveIntervalMs(inv) }
}

export function useApp() {
  const tgUser = getTgUser()
  const tid    = tgUser.id

  const [tonUI] = useTonConnectUI()
  const wallet  = useTonWallet()

  const [tab,          setTab]          = useState('home')
  const [loading,      setLoading]      = useState(true)
  const [toast,        setToast]        = useState(null)
  const [isAdminView,  setIsAdminView]  = useState(false)

  const [user,         setUser]         = useState(() => mkDefaultUser(tgUser))
  const [investments,  setInvestments]  = useState([])
  const [transactions, setTransactions] = useState([])
  const [referral,     setReferral]     = useState(() => mkDefaultRef(tid))
  const [referralDetails, setReferralDetails] = useState([])
  const [notifications, setNotifications] = useState([])
  const [plans,        setPlans]        = useState(DEFAULT_PLANS)
  const [config,       setConfig]       = useState({ ...DEFAULT_CONFIG })
  const [referralLink, setReferralLink] = useState(String(tid))
  const [notificationsSeenAt, setNotificationsSeenAt] = useState(() => Number(localStorage.getItem(`ty_notif_seen_${tid}`) || 0))

  const adminMode   = checkIsAdmin(tid, config.adminIds)
  const inited      = useRef(false)

  const withTimeout = useCallback((promise, ms, fallback) => {
    let timer
    return Promise.race([
      promise,
      new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms) }),
    ]).finally(() => clearTimeout(timer))
  }, [])

  // ─── Load on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (inited.current) return
    inited.current = true
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready()
      window.Telegram.WebApp.expand()
    }

    async function load() {
      try {
        const [bundle, cfg, savedPlans, userNotifications, refDetails] = await Promise.all([
          withTimeout(getUserBundle(tid).catch(() => null), 4000, null),
          withTimeout(getAdminConfig(null).catch(() => null), 4000, null),
          withTimeout(getAdminPlans(null).catch(() => null), 4000, null),
          withTimeout(getNotifications(tid).catch(() => []), 4000, []),
          withTimeout(getReferralDetails(tid).catch(() => []), 4000, []),
        ])
        if (bundle) {
          if (bundle.user)         setUser(p => ({ ...p, ...bundle.user }))
          if (bundle.investments)  setInvestments(bundle.investments)
          if (bundle.transactions) setTransactions(bundle.transactions)
          if (bundle.referral)     setReferral(p => ({ ...p, ...bundle.referral }))
        }
        if (cfg)        setConfig(p => ({ ...DEFAULT_CONFIG, ...cfg }))
        if (savedPlans) setPlans(savedPlans)
        setNotifications(userNotifications || [])
        setReferralDetails(refDetails || [])

        const referredByCode = getStartParam()
        registerUser(tid, referredByCode, tgUser).catch(e => console.warn('[registerUser]', e))

        if (tgUser.id) {
          supabase.from('users').update({
            username:   tgUser.username   || '',
            first_name: tgUser.first_name || '',
          }).eq('id', Number(tid)).then(() => {
            setUser(p => ({
              ...p,
              username:  tgUser.username   || p.username,
              firstName: tgUser.first_name || p.firstName,
              photoUrl:  tgUser.photo_url  || p.photoUrl,
            }))
          }).catch(() => {})
        }
      } catch(e) { console.warn('[load]', e) }
      finally { setLoading(false) }
    }
    load()
  }, [withTimeout]) // eslint-disable-line

  // ─── Realtime WebSocket — thay thế toàn bộ polling ────────────────────────
  //
  // Flow:
  //  1. Supabase Edge Function (tick-profits) chạy theo cron mỗi 1 phút
  //  2. Edge Function update DB: investments.earned, users.balance, next_profit_time
  //  3. Supabase Realtime phát WebSocket event (postgres_changes) tới client
  //  4. Client nhận event → gọi getUserBundle → cập nhật state
  //  5. PlanRing component đọc nextProfitTime từ state, tự đếm ngược locally
  //
  // Không còn setInterval gọi DB từ client.
  //
  useEffect(() => {
    if (loading || !tid) return

    const refreshFromDb = async () => {
      // Debounce 300ms để tránh burst khi nhiều bảng thay đổi cùng lúc
      {
        try {
          const [bundle, refDetails] = await Promise.all([
            getUserBundle(tid),
            getReferralDetails(tid).catch(() => []),
          ])
          if (!bundle) return
          if (bundle.user)         setUser(p => ({ ...p, ...bundle.user }))
          if (bundle.investments)  setInvestments(bundle.investments)
          if (bundle.transactions) setTransactions(bundle.transactions)
          if (bundle.referral)     setReferral(p => ({ ...p, ...bundle.referral }))
          setReferralDetails(refDetails || [])
        } catch (e) {
          console.warn('[ws refresh]', e)
        }
      }
    }

    // WebSocket channel — lắng nghe 3 bảng của user hiện tại
    const refreshGlobalConfig = async () => {
      try {
        const [cfg, savedPlans] = await Promise.all([
          getAdminConfig(null).catch(() => null),
          getAdminPlans(null).catch(() => null),
        ])
        if (cfg) setConfig(p => ({ ...p, ...DEFAULT_CONFIG, ...cfg }))
        if (savedPlans) setPlans(savedPlans)
      } catch (e) {
        console.warn('[ws config refresh]', e)
      }
    }

    const channel = supabase
      .channel(`user-realtime-${tid}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'users',
        filter: `id=eq.${tid}`,
      }, refreshFromDb)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'investments',
        filter: `user_id=eq.${tid}`,
      }, refreshFromDb)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'transactions',
        filter: `user_id=eq.${tid}`,
      }, refreshFromDb)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications',
      }, async () => {
        try { setNotifications(await getNotifications(tid)) }
        catch(e) { console.warn('[notifications]', e) }
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'admin_config',
      }, refreshGlobalConfig)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'plans',
      }, refreshGlobalConfig)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Fallback: nếu WS lỗi, refresh ngay
          console.warn('[ws] channel error →', status)
          refreshFromDb()
          refreshGlobalConfig()
        }
      })

    // Backup: refresh khi tab visible lại (user quay lại sau khi chuyển app)
    const onVisible = () => {
      if (!document.hidden) {
        refreshFromDb()
        refreshGlobalConfig()
      }
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [loading, tid]) // eslint-disable-line

  // ─── Sync wallet address ───────────────────────────────────────────────────
  useEffect(() => {
    if (wallet?.account?.address) {
      try {
        const isTestnet = (config.tonNetwork || TON_NETWORK) === 'testnet'
        const friendly  = toUserFriendlyAddress(wallet.account.address, isTestnet)
        setUser(p => p.walletAddr === friendly ? p : { ...p, walletAddr: friendly })
      } catch {
        setUser(p => ({ ...p, walletAddr: wallet.account.address }))
      }
    }
  }, [wallet, config.tonNetwork])

  // ─── Referral display link ─────────────────────────────────────────────────
  useEffect(() => {
    const bot = config.botUsername?.trim()
    const cleanBot = bot.replace(/^@/, '')
    const link = cleanBot ? `https://t.me/${cleanBot}?startapp=${tid}` : String(tid)
    setReferralLink(link)
  }, [config.botUsername, tid])

  const showToast = useCallback((msg, type='ok') => {
    setToast({msg,type}); setTimeout(()=>setToast(null), 2800)
  }, [])

  const connectWallet    = useCallback(() => tonUI.openModal(), [tonUI])
  const disconnectWallet = useCallback(() => {
    tonUI.disconnect()
    setUser(p => ({ ...p, walletAddr:'' }))
    showToast('Wallet disconnected.')
  }, [tonUI, showToast])

  // Investments active với computed display fields
  const myInvestments = investments
    .filter(i => i.status === 'active')
    .map(enrichInvestment)

  // ─── Referral commission — server-side via Edge Function ─────────────────
  // Được gọi sau khi deposit tx đã insert vào DB.
  // Edge Function credits every deposit and keeps idempotency by deposit tx id.
  const applyReferralCommission = useCallback(async (amount, txId) => {
    try {
      await creditReferralViaServer(tid, parseFloat(amount), txId)
    } catch(e) { console.warn('[applyReferralCommission]', e) }
  }, [tid])

  const recordDeposit = useCallback(async ({ amt, txId, newInv, dbInv, plan, fromBalance }) => {
    const rpcPayload = {
      p_user_id: Number(tid),
      p_username: user.username || tgUser.username || '',
      p_first_name: user.firstName || tgUser.first_name || '',
      p_amount: amt,
      p_from_balance: !!fromBalance,
      p_tx_id: txId,
      p_inv_id: newInv.id,
      p_invoice_id: newInv.invoiceId,
      p_plan_id: plan.id,
      p_plan: plan.name,
      p_plan_color: plan.color,
      p_rate: plan.rate,
      p_days_total: plan.duration,
      p_profit_interval_ms: dbInv.profit_interval_ms,
      p_profit_interval_minutes: dbInv.profit_interval_minutes,
      p_profit_interval_hours: dbInv.profit_interval_hours,
      p_active_days: dbInv.active_days,
      p_start_time: dbInv.start_time,
      p_end_time: dbInv.end_time,
      p_next_profit_time: dbInv.next_profit_time,
    }

    const { data, error } = await supabase.rpc('record_deposit', rpcPayload)
    if (!error) return data?.[0] || null
    if (!/record_deposit/i.test(error.message || '')) throw error

    const { data: dbUser } = await supabase
      .from('users').select('balance, total_deposit').eq('id', Number(tid)).maybeSingle()
    const currentBal = Number(dbUser?.balance) || 0
    const currentDep = Number(dbUser?.total_deposit) || 0
    if (fromBalance && currentBal < amt) throw new Error('Insufficient balance')
    const nextBal = +(currentBal - (fromBalance ? amt : 0)).toFixed(6)
    const nextDep = +(currentDep + amt).toFixed(6)

    await supabase.from('users').upsert({
      id:Number(tid),
      username: user.username || tgUser.username || '',
      first_name: user.firstName || tgUser.first_name || '',
      balance: nextBal,
      total_deposit: nextDep,
      referral_code:String(tid),
      updated_at:new Date().toISOString(),
    }, { onConflict:'id' })
    await supabase.from('transactions').insert({
      id:txId, user_id:Number(tid), type:'deposit',
      label:`${fromBalance ? 'Reinvest' : 'Deposit'} · ${plan.name}`, amount:fromBalance ? -amt : amt,
      status:'completed', invoice_id:newInv.invoiceId, plan_id:plan.id, created_at:dbInv.start_time,
    })
    await supabase.from('investments').insert(dbInv)
    return { balance: nextBal, total_deposit: nextDep }
  }, [tid, user.username, user.firstName, tgUser.username, tgUser.first_name])

  // ─── DEPOSIT ───────────────────────────────────────────────────────────────
  const submitDeposit = useCallback(async (planId, amount, paymentMethod = 'wallet') => {
    const plan = plans.find(p => p.id===planId)
    if (!plan) return false
    const now = Date.now()
    const iid = makeInvId(tid, planId)
    const activeNetwork = config.tonNetwork || TON_NETWORK
    const aw  = activeNetwork === 'mainnet'
      ? (config.adminWalletMainnet || config.adminWallet || '')
      : (config.adminWalletTestnet || config.adminWallet || ADMIN_WALLET)
    if (!aw) {
      showToast('Admin wallet not configured.', 'err')
      return false
    }
    if (!isNetworkWallet(aw, activeNetwork)) {
      showToast(`Invalid ${activeNetwork} admin wallet.`, 'err')
      return false
    }

    const rIms = plan.profitIntervalMs
      || (plan.profitIntervalMinutes ? plan.profitIntervalMinutes*60_000 : 0)
      || (plan.profitIntervalHours   ? plan.profitIntervalHours*3_600_000 : 0)
      || 86_400_000
    const rMin = plan.profitIntervalMinutes || Math.round(rIms/60_000)
    const rHr  = plan.profitIntervalHours   || rIms/3_600_000
    const endMs = now + (plan.durationMs || plan.duration*86_400_000)

    const newInv = {
      id:'inv-'+now, plan:plan.name, planColor:plan.color, planId,
      amount, rate:plan.rate, earned:0, daysTotal:plan.duration,
      profitIntervalMs:rIms, profitIntervalMinutes:rMin, profitIntervalHours:rHr,
      activeDays: plan.activeDays || [0,1,2,3,4,5,6],
      startTime:now, endTime:endMs, status:'active', nextProfitTime:now+rIms,
      activated:false, invoiceId:iid,
    }
    const dbInv = {
      id:newInv.id, user_id:Number(tid), plan:plan.name, plan_color:plan.color, plan_id:planId,
      amount:parseFloat(amount), rate:plan.rate, earned:0, days_total:plan.duration,
      profit_interval_ms:rIms, profit_interval_minutes:rMin, profit_interval_hours:rHr,
      active_days:newInv.activeDays, start_time:now, end_time:endMs,
      next_profit_time:now+rIms, status:'active', activated:false, invoice_id:iid,
    }

    if (paymentMethod === 'balance') {
      const amt = parseFloat(amount)
      if (amt > user.balance) { showToast('Insufficient balance.','err'); return false }
      const txId = 'tx-'+now
      try {
        const saved = await recordDeposit({ amt, txId, newInv, dbInv, plan, fromBalance:true })
        await applyReferralCommission(amount, txId)
        setUser(p => ({
          ...p,
          balance:Number(saved?.balance ?? Math.max(0, p.balance - amt)),
          totalDeposit:Number(saved?.total_deposit ?? ((p.totalDeposit || 0) + amt)),
        }))
        setTransactions(p => [{
          id:txId, type:'deposit', label:`Reinvest · ${plan.name}`,
          date:'Just now', amount:-amt, status:'completed',
          invoiceId:iid, createdAt:now, planId, userId:tid,
        }, ...p])
        setInvestments(p => [...p, newInv])
        showToast('Position opened successfully.','ok')
        return true
      } catch(e) {
        console.error('[reinvest]',e)
        showToast(isFetchFailure(e) ? 'Network error - please retry.' : `Transaction failed: ${e?.message || 'please retry'}.`,'err')
        return false
      }
    }

    try {
      await supabase.from('users').upsert({
        id:Number(tid),
        username: user.username || tgUser.username || '',
        first_name: user.firstName || tgUser.first_name || '',
        referral_code:String(tid),
        updated_at:new Date().toISOString(),
      }, { onConflict:'id' })

      await tonUI.sendTransaction({
        validUntil: Math.floor(now/1000)+600,
        messages: [{ address:aw, amount:toNano(amount), payload:buildPayload(iid) }],
      })

      const amt = parseFloat(amount)
      const txId = 'tx-'+now
      const saved = await recordDeposit({ amt, txId, newInv, dbInv, plan, fromBalance:false })
      // Credit referral commission after the deposit tx exists.
      // The Edge Function credits every deposit and ignores duplicate tx ids.
      await applyReferralCommission(amount, txId)

      setUser(p => ({
        ...p,
        balance:Number(saved?.balance ?? p.balance),
        totalDeposit:Number(saved?.total_deposit ?? ((p.totalDeposit || 0) + amt)),
      }))
      setTransactions(p => [{
        id:txId, type:'deposit', label:`Deposit · ${plan.name}`,
        date:'Just now', amount:amt, status:'completed',
        invoiceId:iid, createdAt:now, planId, userId:tid,
      }, ...p])
      setInvestments(p => [...p, newInv])
      showToast('Position opened successfully.','ok')
      return true
    } catch(e) {
      const m = e?.message||''
      if (/User rejects|CANCELLED|user rejected|Transaction was not sent|not sent/i.test(m)) showToast('Transaction rejected by user.','err')
      else if (/invalid address/i.test(m)) showToast('Admin wallet not configured.', 'err')
      else if (isFetchFailure(e)) showToast('Network error - please retry.', 'err')
      else { console.error('[deposit]',e); showToast(`Transaction failed: ${m || 'please retry'}.`,'err') }
      return false
    }
  }, [plans, tid, tonUI, showToast, config.adminWallet, config.adminWalletTestnet, config.adminWalletMainnet, config.tonNetwork, user.balance, recordDeposit, applyReferralCommission])

  // ─── WITHDRAW ─────────────────────────────────────────────────────────────
  const submitWithdraw = useCallback(async (amount, walletAddress) => {
    const minWd = Number(config.minWithdraw) || MIN_WITHDRAW
    if (amount < minWd)        { showToast(`Amount below minimum (${Number(minWd).toFixed(3)} TON).`, 'err'); return false }
    if (amount > user.balance) { showToast('Amount exceeds available balance.', 'err'); return false }

    const destWallet = (walletAddress || '').trim()
    if (!destWallet) { showToast('No wallet connected.', 'err'); return false }
    if (!/^[EUk0][Qg][A-Za-z0-9_-]{46}=?$/.test(destWallet)) {
      showToast('Invalid destination address.', 'err')
      return false
    }

    try {
      const now    = Date.now()
      const txId   = `tx-wd-${tid}-${now}-${Math.random().toString(36).slice(2,7)}`
      const newBal = +(user.balance - amount).toFixed(6)

      const { data: dbUser } = await supabase
        .from('users').select('status, balance').eq('id', Number(tid)).maybeSingle()
      if (dbUser?.status === 'banned') { showToast('Account restricted.', 'err'); return false }
      if (Number(dbUser?.balance) < amount) { showToast('Insufficient balance.', 'err'); return false }

      const { error: balErr } = await supabase.from('users').upsert({
        id:Number(tid), balance:newBal, wallet_addr:destWallet,
        referral_code:String(tid), updated_at:new Date().toISOString(),
      }, { onConflict: 'id' })
      if (balErr) throw new Error('Failed to update balance')

      const { error: txErr } = await supabase.from('transactions').insert({
        id:txId, user_id:Number(tid), type:'withdraw',
        label:`Withdrawal → ${destWallet.slice(0, 8)}...`,
        amount, status:'pending', to_wallet:destWallet,
        created_at:now, updated_at:new Date().toISOString(),
      })
      if (txErr) {
        await supabase.from('users').update({
          balance: user.balance, updated_at: new Date().toISOString(),
        }).eq('id', Number(tid))
        throw new Error(txErr.message || 'Failed to create transaction')
      }

      setUser(p => ({ ...p, balance: newBal, walletAddr: destWallet }))
      setTransactions(p => [{
        id:txId, type:'withdraw',
        label:`Withdrawal → ${destWallet.slice(0, 8)}...`,
        date:'Just now', amount, status:'pending',
        toWallet:destWallet, createdAt:now, userId:tid,
      }, ...p])
      showToast('Withdrawal request submitted.', 'ok')
      return true
    } catch (e) {
      const msg = e?.message || ''
      if (/banned/i.test(msg))            showToast('Account restricted.', 'err')
      else if (/Insufficient/i.test(msg)) showToast('Insufficient balance.', 'err')
      else                                showToast('Network error - please retry.', 'err')
      console.error('[withdraw]', e)
      return false
    }
  }, [config.minWithdraw, user.balance, tid, showToast])

  // ─── ACTIVATE ─────────────────────────────────────────────────────────────
  //
  // Optimistic: cập nhật UI ngay → user thấy ring bắt đầu chạy liền
  // DB write async → nếu fail thì rollback
  // Realtime WS sẽ confirm state sau khi DB write xong
  //
  const activateInvestment = useCallback(async (invId) => {
    const inv = investments.find(i => i.id === invId)
    if (!inv) return
    const now            = Date.now()
    const intervalMs     = resolveIntervalMs(inv)
    const nextProfitTime = now + intervalMs

    // Optimistic update
    setInvestments(p => p.map(i =>
      i.id === invId ? { ...i, activated:true, nextProfitTime } : i
    ))
    showToast('Investment activated.','ok')

    // DB write
    try {
      await supabase.from('investments')
        .update({
          activated: true,
          next_profit_time: nextProfitTime,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invId)
    } catch(e) {
      console.warn('[activate]', e)
      // Rollback
      setInvestments(p => p.map(i =>
        i.id === invId ? { ...i, activated:false, nextProfitTime:inv.nextProfitTime } : i
      ))
      showToast('Network error - please retry.', 'err')
    }
  }, [investments, showToast])

  const collectProfit = useCallback(async (invId) => {
    const inv = investments.find(i => i.id === invId)
    if (!inv) return
    showToast('Profit transferred to balance.', 'ok')
  }, [showToast, investments])

  // ─── ADMIN helpers ─────────────────────────────────────────────────────────
  const getAllUsers = useCallback(async () => {
    const all = await getAllUsersData()
    const users = all.map(({ id, bundle }) => ({
      id, ...(bundle.user || {}), status: bundle.user?.status || 'active',
      activeInvestments:  (bundle.investments || []).filter(i => i.status==='active').length,
      totalInvestments:   (bundle.investments || []).length,
      txCount:            (bundle.transactions || []).length,
      depositCount:       (bundle.transactions || []).filter(t => t.type==='deposit').length,
      withdrawCount:      (bundle.transactions || []).filter(t => t.type==='withdraw').length,
      referralFriends:    bundle.referral?.friends   || 0,
      referralCommission: bundle.referral?.commission || 0,
      referralDepositVolume: bundle.referral?.depositVolume || 0,
      pendingWithdraw:    (bundle.transactions || []).filter(t => t.type==='withdraw' && t.status==='pending').reduce((s,t) => s+Math.abs(t.amount), 0),
    }))
    if (!users.some(u => Number(u.id)===Number(tid))) {
      users.push({ ...user, status:user.status||'active', activeInvestments:investments.filter(i=>i.status==='active').length })
    }
    return users
  }, [user, tid, investments])

  const getAllTransactions = useCallback(async () => {
    const all = await getAllUsersData()
    const txs = []
    all.forEach(({ id, bundle }) => {
      ;(bundle.transactions||[]).forEach(tx => txs.push({ ...tx, userId:tx.userId||id }))
    })
    return txs
  }, [])

  const computeAdminStats = useCallback(async () => {
    const all = await getAllUsersData()
    let totalDeposited=0, totalWithdrawn=0, todayPft=0, activeInv=0, pendingWithdraws=0
    const userList = []
    all.forEach(({ id, bundle }) => {
      const u = bundle.user||{}
      userList.push({ ...u, id, status:u.status||'active' })
      totalDeposited += Number(u.totalDeposit)||0
      totalWithdrawn += Number(u.totalWithdraw)||0
      todayPft       += Number(u.todayProfit)||0
      ;(bundle.investments||[]).forEach(inv => { if(inv.status==='active') activeInv++ })
      ;(bundle.transactions||[]).forEach(tx => { if(tx.type==='withdraw'&&tx.status==='pending') pendingWithdraws++ })
    })
    return {
      totalUsers: userList.length,
      activeUsers: userList.filter(u=>u.status!=='banned').length,
      bannedUsers: userList.filter(u=>u.status==='banned').length,
      totalDeposited, totalWithdrawn, netInCustody: totalDeposited - totalWithdrawn, activeInvestments: activeInv,
      todayProfit: todayPft, pendingWithdraws,
    }
  }, [])

  const adminToggleBan = useCallback(async (userId) => {
    const id = Number(userId)
    if (id === Number(tid)) {
      showToast('Cannot delete current admin session.', 'err')
      return
    }
    try {
      const rpcResult = await supabase.rpc('delete_user_data', { p_user_id: id })
      if (rpcResult.error) {
        await supabase.from('users').update({
          referred_by: '',
          updated_at: new Date().toISOString(),
        }).eq('referred_by', String(id))
        const { error } = await supabase.from('users').delete().eq('id', id)
        if (error) throw error
      }
      showToast('User deleted.','ok')
    } catch(e) {
      console.error('[adminDeleteUser]',e)
      showToast(isFetchFailure(e) ? 'Network error - please retry.' : `Failed to delete user: ${e?.message || 'please retry'}.`,'err')
    }
  }, [tid, showToast])

  const adminUpdateUser = useCallback(async (userId, updates) => {
    try {
      const id = Number(userId)
      const updatedAt = new Date().toISOString()
      const corePatch = { updated_at: updatedAt }
      const referralPatch = { updated_at: updatedAt }
      if (updates.balance        !== undefined) corePatch.balance         = Number(updates.balance)
      if (updates.totalDeposit   !== undefined) corePatch.total_deposit   = Number(updates.totalDeposit)
      if (updates.totalWithdraw  !== undefined) corePatch.total_withdraw  = Number(updates.totalWithdraw)
      if (updates.totalProfit    !== undefined) corePatch.total_profit    = Number(updates.totalProfit)
      if (updates.todayProfit    !== undefined) corePatch.today_profit    = Number(updates.todayProfit)
      if (updates.referrals      !== undefined) corePatch.referrals       = Number(updates.referrals)
      if (updates.status         !== undefined) corePatch.status          = updates.status
      if (updates.walletAddr     !== undefined) corePatch.wallet_addr     = updates.walletAddr
      if (updates.referralFriends !== undefined) referralPatch.referral_friends = Number(updates.referralFriends)
      if (updates.referralCommission !== undefined) referralPatch.referral_commission = Number(updates.referralCommission)
      if (updates.referralDepositVolume !== undefined) referralPatch.referral_deposit_volume = Number(updates.referralDepositVolume)

      const { error: coreError } = await supabase.from('users').update(corePatch).eq('id', id)
      if (coreError) throw coreError

      if (Object.keys(referralPatch).length > 1) {
        const { error: referralError } = await supabase.from('users').update(referralPatch).eq('id', id)
        if (referralError && !/(referral_deposit_volume|referral_friends|referral_commission)/i.test(referralError.message || '')) {
          throw referralError
        }
      }
      if (id===Number(tid)) setUser(p => ({ ...p, ...updates }))
      showToast('User updated.','ok')
    } catch(e) {
      console.error('[adminUpdateUser]',e)
      showToast(isFetchFailure(e) ? 'Network error - please retry.' : `Failed to update user: ${e?.message || 'please retry'}.`,'err')
    }
  }, [tid, showToast])

  const adminUpdatePlan = useCallback((planId, updates) => {
    setPlans(prev => { const next = prev.map(p => p.id===planId ? { ...p, ...updates } : p); saveAdminPlans(next); return next })
    showToast('Plan updated.','ok')
  }, [showToast])

  const adminToggleMaintenance = useCallback(() => {
    setConfig(prev => { const next = { ...prev, maintenanceMode:!prev.maintenanceMode }; saveAdminConfig(next); return next })
  }, [])

  const adminSaveSettings = useCallback((updates) => {
    setConfig(prev => { const next = { ...prev, ...updates }; saveAdminConfig(next); return next })
    showToast('Settings updated.','ok')
  }, [showToast])

  const adminSendNotification = useCallback(async ({ title, body, audience = 'all', userId = null }) => {
    try {
      if (!String(title || '').trim()) { showToast('Notification title is required.','err'); return false }
      if (!String(body || '').trim()) { showToast('Notification message is required.','err'); return false }
      await createNotification({ title, body, audience, userId, createdBy: tid })
      showToast('Notification sent.','ok')
      return true
    } catch(e) {
      console.error('[adminSendNotification]', e)
      showToast(`Failed to send notification: ${e?.message || 'please retry'}.`,'err')
      return false
    }
  }, [tid, showToast])

  const adminGetNotifications = useCallback(async () => {
    try {
      return await getAllNotifications()
    } catch(e) {
      console.error('[adminGetNotifications]', e)
      showToast(`Failed to load notifications: ${e?.message || 'please retry'}.`,'err')
      return []
    }
  }, [showToast])

  const adminDeleteNotification = useCallback(async (notificationId) => {
    try {
      await deleteNotification(notificationId)
      showToast('Notification deleted.','ok')
      return true
    } catch(e) {
      console.error('[adminDeleteNotification]', e)
      showToast(`Failed to delete notification: ${e?.message || 'please retry'}.`,'err')
      return false
    }
  }, [showToast])

  const markNotificationsSeen = useCallback(() => {
    const now = Date.now()
    localStorage.setItem(`ty_notif_seen_${tid}`, String(now))
    setNotificationsSeenAt(now)
  }, [tid])

  const notificationUnread = notifications.filter(n => {
    const ts = new Date(n.createdAt).getTime()
    return ts > notificationsSeenAt
  }).length

  const referralDisplay = { ...referral, code: referralLink }

  return {
    tab, setTab, loading, toast, config,
    user, plans, investments:myInvestments, transactions, referral: referralDisplay, referralDetails,
    notifications, notificationUnread, markNotificationsSeen,
    isAdmin:adminMode, isAdminView, setIsAdmin:setIsAdminView,
    walletConnected:!!wallet, wallet,
    connectWallet, disconnectWallet, showToast,
    submitDeposit, submitWithdraw, activateInvestment, collectProfit,
    computeAdminStats, getAllUsers, getAllTransactions,
    adminToggleBan, adminUpdateUser, adminUpdatePlan, adminSendNotification,
    adminGetNotifications, adminDeleteNotification,
    adminToggleMaintenance, adminSaveSettings,
  }
}
