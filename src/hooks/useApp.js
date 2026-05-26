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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  getNotifications, getAllNotifications, createNotification, deleteNotification, testBotNotification,
  getAdminConfig, saveAdminConfig,
  getAdminPlans, saveAdminPlans,
  mineCreateGame, mineJoinGame, mineRevealCell, mineListGames,
} from '../utils/supabase'
import { secureApi } from '../utils/secureApi'

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
function makePublicId(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}
function makeInvId(){return makePublicId()}
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
function deriveReferralFromDetails(details) {
  if (!Array.isArray(details)) return null
  return {
    friends: details.length,
    commission: details.reduce((sum, item) => sum + (Number(item.referralIncome) || 0), 0),
    depositVolume: details.reduce((sum, item) => sum + (Number(item.totalDeposit) || 0), 0),
  }
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
  withdrawReferralGateEnabled: false,
  withdrawMinReferrals: 3,
  maintenanceMode: false,
  adminWallet: ADMIN_WALLET,
  adminWalletTestnet: ADMIN_WALLET,
  adminWalletMainnet: '',
  adminIds: [...ADMIN_IDS],
  botUsername: '',
  withdrawalWebhookUrl: '',
  withdrawalWebhookSecret: '',
  tonNetwork: TON_NETWORK,
  mineEnabled: true,
  mineMinBet: 1,
  mineMaxBet: null,
  mineFeeRate: 5,
  mineCreatorWinRate: 30,
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
  const [referralDetails, setReferralDetails] = useState(null)
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

  const liveWalletAddr = useMemo(() => {
    const raw = wallet?.account?.address || ''
    if (!raw) return ''
    try {
      const isTestnet = (config.tonNetwork || TON_NETWORK) === 'testnet'
      return toUserFriendlyAddress(raw, isTestnet)
    } catch {
      return raw
    }
  }, [wallet?.account?.address, config.tonNetwork])

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
          withTimeout(getReferralDetails(tid).catch(() => null), 4000, null),
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
        if (Array.isArray(refDetails)) {
          setReferralDetails(refDetails)
          const refSummary = deriveReferralFromDetails(refDetails)
          setReferral(p => ({ ...p, ...refSummary }))
        }

        const referredByCode = getStartParam()
        registerUser(tid, referredByCode, tgUser).catch(e => console.warn('[registerUser]', e))

        if (tgUser.id) {
          setUser(p => ({
            ...p,
            username:  tgUser.username   || p.username,
            firstName: tgUser.first_name || p.firstName,
            photoUrl:  tgUser.photo_url  || p.photoUrl,
          }))
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
            getReferralDetails(tid).catch(() => null),
          ])
          if (!bundle) return
          if (bundle.user)         setUser(p => ({ ...p, ...bundle.user }))
          if (bundle.investments)  setInvestments(bundle.investments)
          if (bundle.transactions) setTransactions(bundle.transactions)
          if (bundle.referral)     setReferral(p => ({ ...p, ...bundle.referral }))
          if (Array.isArray(refDetails)) {
            setReferralDetails(refDetails)
            const refSummary = deriveReferralFromDetails(refDetails)
            setReferral(p => ({ ...p, ...refSummary }))
          }
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
    if (liveWalletAddr) {
      setUser(p => p.walletAddr === liveWalletAddr ? p : { ...p, walletAddr: liveWalletAddr })
    }
  }, [liveWalletAddr])

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

  const recordDeposit = useCallback(async ({ amt, txId, newInv, dbInv, plan, fromBalance }) => {
    return secureApi('record_deposit', {
      amount: amt,
      from_balance: !!fromBalance,
      wallet_address: fromBalance ? '' : liveWalletAddr,
      tx_id: txId,
      inv_id: newInv.id,
      invoice_id: newInv.invoiceId,
      plan_id: plan.id,
    })
  }, [liveWalletAddr])

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
      id:makePublicId(), plan:plan.name, planColor:plan.color, planId,
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
      const txId = makePublicId()
      try {
        const saved = await recordDeposit({ amt, txId, newInv, dbInv, plan, fromBalance:true })
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
      await tonUI.sendTransaction({
        validUntil: Math.floor(now/1000)+600,
        messages: [{ address:aw, amount:toNano(amount), payload:buildPayload(iid) }],
      })

      const amt = parseFloat(amount)
      const txId = makePublicId()
      const saved = await recordDeposit({ amt, txId, newInv, dbInv, plan, fromBalance:false })

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
  }, [plans, tid, tonUI, showToast, config.adminWallet, config.adminWalletTestnet, config.adminWalletMainnet, config.tonNetwork, user.balance, recordDeposit])

  // ─── WITHDRAW ─────────────────────────────────────────────────────────────
  const submitWithdraw = useCallback(async (amount, walletAddress) => {
    const minWd = Number(config.minWithdraw) || MIN_WITHDRAW
    const gateEnabled = !!config.withdrawReferralGateEnabled
    const minRefs = Math.max(0, Number(config.withdrawMinReferrals) || 0)
    const userRefs = Math.max(Number(user.referrals) || 0, Number(referral.friends) || 0)
    if (amount < minWd)        { showToast(`Amount below minimum (${Number(minWd).toFixed(3)} TON).`, 'err'); return false }
    if (amount > user.balance) { showToast('Amount exceeds available balance.', 'err'); return false }
    if (gateEnabled && userRefs <= minRefs) {
      const target = minRefs + 1
      const remaining = Math.max(0, target - userRefs)
      showToast(`Invite ${remaining} more user${remaining === 1 ? '' : 's'} to unlock withdrawals.`, 'err')
      return false
    }

    const destWallet = (walletAddress || '').trim()
    if (!destWallet) { showToast('No wallet connected.', 'err'); return false }
    if (!/^[EUk0][Qg][A-Za-z0-9_-]{46}=?$/.test(destWallet)) {
      showToast('Invalid destination address.', 'err')
      return false
    }
    try {
      const now    = Date.now()
      const txId   = makePublicId()
      const newBal = +(user.balance - amount).toFixed(6)

      const saved = await secureApi('submit_withdraw', {
        amount,
        wallet_address: destWallet,
        tx_id: txId,
      })

      setUser(p => ({ ...p, balance: Number(saved.balance ?? newBal), walletAddr: destWallet }))
      setTransactions(p => [{
        id:txId, type:'withdraw',
        label:`Withdrawal → ${destWallet.slice(0, 8)}...`,
        date:'Just now', amount, status:'pending',
        toWallet:destWallet, createdAt:saved.created_at || now, userId:tid,
      }, ...p])
      showToast('Withdrawal request submitted.', 'ok')
      return true
    } catch (e) {
      const msg = e?.message || ''
      if (/banned/i.test(msg))            showToast('Account restricted.', 'err')
      else if (/Insufficient/i.test(msg)) showToast('Insufficient balance.', 'err')
      else if (/referrals/i.test(msg))    showToast(msg, 'err')
      else if (isFetchFailure(e))         showToast('Network error - please retry.', 'err')
      else                                showToast(`Withdrawal failed: ${msg || 'please retry'}.`, 'err')
      console.error('[withdraw]', e)
      return false
    }
  }, [config.minWithdraw, config.withdrawReferralGateEnabled, config.withdrawMinReferrals, user.balance, user.referrals, referral.friends, tid, showToast])

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
      const saved = await secureApi('activate_investment', { investment_id: invId })
      if (saved.next_profit_time) {
        setInvestments(p => p.map(i =>
          i.id === invId ? { ...i, nextProfitTime: saved.next_profit_time } : i
        ))
      }
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
    let userBalanceLiability=0, pendingWithdrawAmount=0, todayYieldReserve=0
    const now = Date.now()
    const todayDow = new Date(now).getDay()
    const tomorrowStart = new Date(now)
    tomorrowStart.setHours(24, 0, 0, 0)
    const endOfToday = tomorrowStart.getTime() - 1
    const userList = []
    all.forEach(({ id, bundle }) => {
      const u = bundle.user||{}
      userList.push({ ...u, id, status:u.status||'active' })
      totalDeposited += Number(u.totalDeposit)||0
      totalWithdrawn += Number(u.totalWithdraw)||0
      todayPft       += Number(u.todayProfit)||0
      userBalanceLiability += Number(u.balance)||0
      ;(bundle.investments||[]).forEach(inv => {
        if(inv.status==='active') {
          activeInv++
          const activeDays = Array.isArray(inv.activeDays) ? inv.activeDays : [1,2,3,4,5]
          if (!activeDays.includes(todayDow)) return
          const amount = Number(inv.amount) || 0
          const rate = Number(inv.rate) || 0
          const intervalMs = resolveIntervalMs(inv)
          const nextProfitTime = Math.max(Number(inv.nextProfitTime) || now, now)
          const reserveEndTime = Math.min(Number(inv.endTime) || nextProfitTime, endOfToday)
          const remainingTicks = intervalMs > 0 && reserveEndTime >= nextProfitTime
            ? Math.floor((reserveEndTime - nextProfitTime) / intervalMs) + 1
            : 0
          todayYieldReserve += amount * (rate / 100) * remainingTicks
        }
      })
      ;(bundle.transactions||[]).forEach(tx => {
        if(tx.type==='withdraw'&&tx.status==='pending') {
          pendingWithdraws++
          pendingWithdrawAmount += Math.abs(Number(tx.amount) || 0)
        }
      })
    })
    const requiredYieldReserve = userBalanceLiability + pendingWithdrawAmount + todayYieldReserve
    return {
      totalUsers: userList.length,
      activeUsers: userList.filter(u=>u.status!=='banned').length,
      bannedUsers: userList.filter(u=>u.status==='banned').length,
      totalDeposited, totalWithdrawn, netInCustody: totalDeposited - totalWithdrawn, activeInvestments: activeInv,
      todayProfit: todayPft, pendingWithdraws,
      userBalanceLiability: +userBalanceLiability.toFixed(6),
      pendingWithdrawAmount: +pendingWithdrawAmount.toFixed(6),
      todayYieldReserve: +todayYieldReserve.toFixed(6),
      requiredYieldReserve: +requiredYieldReserve.toFixed(6),
    }
  }, [])

  const adminToggleBan = useCallback(async (userId) => {
    const id = Number(userId)
    if (id === Number(tid)) {
      showToast('Cannot delete current admin session.', 'err')
      return
    }
    try {
      await secureApi('admin_delete_user', { user_id: id })
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

      await secureApi('admin_update_user', { user_id: id, patch: corePatch })

      if (Object.keys(referralPatch).length > 1) {
        await secureApi('admin_update_user', { user_id: id, patch: referralPatch })
      }
      if (id===Number(tid)) setUser(p => ({ ...p, ...updates }))
      showToast('User updated.','ok')
    } catch(e) {
      console.error('[adminUpdateUser]',e)
      showToast(isFetchFailure(e) ? 'Network error - please retry.' : `Failed to update user: ${e?.message || 'please retry'}.`,'err')
    }
  }, [tid, showToast])

  const adminRetryWithdrawal = useCallback(async (txId) => {
    try {
      const result = await secureApi('admin_retry_withdrawal', { tx_id: txId })
      const status = result?.tx?.status || result?.processor?.status || ''
      if (status === 'sent') showToast('Withdrawal submitted to TON network.', 'ok')
      else if (status === 'pending') showToast('Withdrawal is still pending. Check the reason and retry when ready.', 'err')
      else showToast('Withdrawal retry processed.', 'ok')
      return result
    } catch(e) {
      console.error('[adminRetryWithdrawal]', e)
      showToast(`Failed to retry withdrawal: ${e?.message || 'please retry'}.`, 'err')
      return false
    }
  }, [showToast])

  const adminUpdatePlan = useCallback((planId, updates) => {
    setPlans(prev => { const next = prev.map(p => p.id===planId ? { ...p, ...updates } : p); saveAdminPlans(next); return next })
    showToast('Plan updated.','ok')
  }, [showToast])

  const adminToggleMaintenance = useCallback(async () => {
    const prevConfig = config
    const next = { ...prevConfig, maintenanceMode: !prevConfig.maintenanceMode }
    setConfig(next)
    try {
      await saveAdminConfig(next)
    } catch (e) {
      console.error('[adminToggleMaintenance]', e)
      setConfig(prevConfig)
      showToast(`Failed to update maintenance: ${e?.message || 'please retry'}.`, 'err')
    }
  }, [config, showToast])

  const adminSaveSettings = useCallback(async (updates) => {
    const prevConfig = config
    const next = { ...prevConfig, ...updates }
    setConfig(next)
    try {
      await saveAdminConfig(next)
      showToast('Settings updated.','ok')
      return true
    } catch(e) {
      console.error('[adminSaveSettings]', e)
      setConfig(prevConfig)
      showToast(`Failed to save settings: ${e?.message || 'please retry'}.`, 'err')
      return false
    }
  }, [config, showToast])

  const adminSendNotification = useCallback(async ({ title, body, audience = 'all', userId = null }) => {
    try {
      if (!String(title || '').trim()) { showToast('Notification title is required.','err'); return false }
      if (!String(body || '').trim()) { showToast('Notification message is required.','err'); return false }
      const result = await createNotification({ title, body, audience, userId, createdBy: tid })
      const bot = result?.bot_delivery
      const skipped = Number(bot?.skipped_no_chat) || 0
      const skippedText = skipped ? ` ${skipped} no bot chat.` : ''
      const failedText = bot?.last_error ? ` Last error: ${bot.last_error.slice(0, 80)}` : ''
      const botText = bot ? ` Bot: ${bot.sent}/${bot.attempted} sent.${skippedText}${failedText}` : ''
      showToast(`Notification sent.${botText}`,'ok')
      return true
    } catch(e) {
      console.error('[adminSendNotification]', e)
      showToast(`Failed to send notification: ${e?.message || 'please retry'}.`,'err')
      return false
    }
  }, [tid, showToast])

  const adminTestBotNotification = useCallback(async () => {
    try {
      const result = await testBotNotification()
      showToast(`Bot test sent to ${result.bot_chat_id}.`,'ok')
      return true
    } catch(e) {
      console.error('[adminTestBotNotification]', e)
      showToast(`Bot test failed: ${e?.message || 'please retry'}.`,'err')
      return false
    }
  }, [showToast])

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

  const playMineRound = useCallback(async ({ bet, selectedCell, mineCount }) => {
    try {
      const result = await secureApi('user_play_mine', {
        bet: Number(bet),
        selectedCell: Number(selectedCell),
        mineCount: Number(mineCount),
      })
      return result || { win: false, payout: 0, minePositions: [] }
    } catch (e) {
      console.error('[playMineRound]', e)
      showToast(`Mine round error: ${e?.message || 'please retry'}.`, 'err')
      throw e
    }
  }, [showToast])

  const mineCreate = useCallback(async ({ betAmount, mineDigit }) => {
    try {
      const result = await mineCreateGame({ betAmount, mineDigit })
      if (Number.isFinite(Number(result?.balance))) {
        setUser(p => ({ ...p, balance: Number(result.balance) }))
      }
      return result
    } catch (e) {
      console.error('[mineCreate]', e)
      showToast(`Create game failed: ${e?.message || 'please retry'}.`, 'err')
      throw e
    }
  }, [showToast])

  const mineJoin = useCallback(async ({ gameId, slot, cell, selectedCell }) => {
    try {
      const result = await mineJoinGame({ gameId, slot, cell, selectedCell })
      if (Number.isFinite(Number(result?.balance))) {
        setUser(p => ({ ...p, balance: Number(result.balance) }))
      }
      return result
    } catch (e) {
      console.error('[mineJoin]', e)
      showToast(`Join game failed: ${e?.message || 'please retry'}.`, 'err')
      throw e
    }
  }, [showToast])

  const mineReveal = useCallback(async ({ gameId, slot, selectedCell }) => {
    try {
      return await mineRevealCell({ gameId, slot, selectedCell })
    } catch (e) {
      console.error('[mineReveal]', e)
      showToast(`Reveal failed: ${e?.message || 'please retry'}.`, 'err')
      throw e
    }
  }, [showToast])

  const mineList = useCallback(async () => {
    try {
      return await mineListGames()
    } catch (e) {
      console.error('[mineList]', e)
      showToast(`Load mine games failed: ${e?.message || 'please retry'}.`, 'err')
      return { games: [] }
    }
  }, [showToast])

  const referralDisplay = { ...referral, code: referralLink }

  return {
    tab, setTab, loading, toast, config,
    user, plans, investments:myInvestments, transactions, referral: referralDisplay, referralDetails,
    notifications, notificationUnread, markNotificationsSeen,
    isAdmin:adminMode, isAdminView, setIsAdmin:setIsAdminView,
    walletConnected:!!wallet,
    wallet,
    connectWallet, disconnectWallet, showToast,
    submitDeposit, submitWithdraw, activateInvestment, collectProfit,
    playMineRound, mineCreate, mineJoin, mineReveal, mineList,
    computeAdminStats, getAllUsers, getAllTransactions,
    adminToggleBan, adminUpdateUser, adminRetryWithdrawal, adminUpdatePlan, adminSendNotification,
    adminGetNotifications, adminDeleteNotification, adminTestBotNotification,
    adminToggleMaintenance, adminSaveSettings,
  }
}
