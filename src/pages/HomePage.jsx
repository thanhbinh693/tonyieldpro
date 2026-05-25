import React, { useState, useEffect, useRef } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Bell, ChevronRight, Clock, Hash, Minus, Play, Plus, Shield, Target, TrendingUp, Users } from 'lucide-react'
import { DAY_NAMES_FULL } from '../utils/config'
import './HomePage.css'

const TODAY_DOW = new Date().getDay()

function isPlanActiveToday(inv) {
  const days = inv.activeDays || [1,2,3,4,5]
  return days.includes(TODAY_DOW)
}

// ─── Plan Progress Ring + Ripple Wave ────────────────────────────────────────
//
// Local countdown timer — không poll DB, chỉ đọc nextProfitTime từ props.
// Khi server tick xong → Realtime WS → parent cập nhật inv.nextProfitTime
// → component re-render với nextProfitTime mới → timer reset tự động.
//
function PlanRing({ inv, onActivate, onCollect }) {
  // remaining được tính trực tiếp từ nextProfitTime — không lưu trong state
  // để tránh drift khi nextProfitTime thay đổi từ Realtime update
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // setInterval 1s chỉ để force re-render mỗi giây
    // Giá trị thực tế luôn được tính từ inv.nextProfitTime live
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, []) // mount once — không depend on nextProfitTime

  const remaining = Math.max(0, inv.nextProfitTime - Date.now())
  const expired   = remaining === 0

  const h = Math.floor(remaining / 3600000)
  const m = Math.floor((remaining % 3600000) / 60000)
  const s = Math.floor((remaining % 60000) / 1000)
  const fmt = n => String(n).padStart(2, '0')

  const planPct = Math.min(1, (inv.progress || 0) / 100)
  // Resolve intervalMs: priority profitIntervalMs > Minutes > Hours > default 24h
  const intervalMs = inv.intervalMs  // pre-computed by myInvestments
    || inv.profitIntervalMs
    || (inv.profitIntervalMinutes ? inv.profitIntervalMinutes * 60_000 : 0)
    || (inv.profitIntervalHours   ? inv.profitIntervalHours   * 3_600_000 : 0)
    || 86_400_000
  const dayPct = Math.min(1, 1 - remaining / intervalMs)

  const R_outer = 42, R_mid = 34, R_inner = 26
  const C = r => 2 * Math.PI * r
  const arc = (r, pct) => {
    const c = C(r)
    const filled = Math.max(0.01, pct) * c
    return `${filled.toFixed(2)} ${c.toFixed(2)}`
  }

  const colorMap = { gold: '#FFD600', blue: '#0098EA', purple: '#00C2FF' }
  const ringColor = '#00d4ff'  // cosmic blue override for all plans
  const ringColorDim = '#00d4ff30'
  const ringColorMid = '#00aaff'
  const activeToday = isPlanActiveToday(inv)

  // Not yet activated → show Activate button (or waiting if inactive day)
  if (!inv.activated) {
    if (!activeToday) {
      // Deposited on inactive day → show waiting state
      return (
        <div className="rings-wrap waiting">
          <svg viewBox="0 0 100 100" className="rings-svg">
            <circle cx="50" cy="50" r={R_outer} className="ring-track" strokeWidth="3.5"/>
            <circle cx="50" cy="50" r={R_mid}   className="ring-track" strokeWidth="2.5"/>
            <circle cx="50" cy="50" r={R_outer} fill="none" stroke={ringColor} strokeWidth="3.5"
              strokeDasharray={arc(R_outer, 0.15)} strokeLinecap="round" opacity="0.2"
              transform="rotate(-90 50 50)"/>
          </svg>
        </div>
      )
    }
    return (
      <div className="rings-wrap expired">
        <svg viewBox="0 0 100 100" className="rings-svg">
          <circle cx="50" cy="50" r={R_outer} className="ring-track" strokeWidth="3.5"/>
          <circle cx="50" cy="50" r={R_mid}   className="ring-track" strokeWidth="2.5"/>
          <circle cx="50" cy="50" r={R_inner} className="ring-track" strokeWidth="2"/>
          <circle cx="50" cy="50" r={R_outer} fill="none" stroke={ringColor} strokeWidth="3.5"
            strokeDasharray={arc(R_outer, 0.3)} strokeLinecap="round" opacity="0.25"
            transform="rotate(-90 50 50)"/>
        </svg>
        <button className="activate-btn" onClick={() => onActivate(inv.id)}>
          <span className="activate-icon"><Play size={16} color="#FFFFFF" /></span>
          <span>Activate</span>
        </button>
      </div>
    )
  }

  // Activated but today is inactive day → show paused state
  if (!activeToday) {
    return (
      <div className="rings-wrap paused">
        <svg viewBox="0 0 100 100" className="rings-svg">
          <circle cx="50" cy="50" r={R_outer} className="ring-track" strokeWidth="3.5"/>
          <circle cx="50" cy="50" r={R_mid}   className="ring-track" strokeWidth="2.5"/>
          <circle cx="50" cy="50" r={R_inner} className="ring-track" strokeWidth="2"/>
          <circle cx="50" cy="50" r={R_outer} fill="none" stroke={ringColor} strokeWidth="3.5"
            strokeDasharray={arc(R_outer, planPct)} strokeLinecap="round" opacity="0.35"
            transform="rotate(-90 50 50)"/>
        </svg>
      </div>
    )
  }

  if (expired) return null

  return (
    <>
      <div className="rings-wrap">
        <svg viewBox="0 0 100 100" className="rings-svg" style={{overflow:'visible'}}>
        <defs>
          <filter id="ringGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="ringGlowStrong" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {/* Track rings - dark subtle */}
        <circle cx="50" cy="50" r={R_outer} fill="none" stroke="#0d2a4a" strokeWidth="3.5"/>
        <circle cx="50" cy="50" r={R_mid}   fill="none" stroke="#0d2a4a" strokeWidth="2.5"/>
        <circle cx="50" cy="50" r={R_inner} fill="none" stroke="#0d2a4a" strokeWidth="2"/>
        {/* Dim glow backdrop */}
        <circle cx="50" cy="50" r={R_outer} fill="none" stroke="#00d4ff" strokeWidth="3.5"
          strokeDasharray={arc(R_outer, 1)} strokeLinecap="round" opacity="0.07"/>
        <circle cx="50" cy="50" r={R_mid}   fill="none" stroke="#00aaff" strokeWidth="2.5"
          strokeDasharray={arc(R_mid, 1)}   strokeLinecap="round" opacity="0.07"/>
        <circle cx="50" cy="50" r={R_inner} fill="none" stroke="#00d4ff" strokeWidth="2"
          strokeDasharray={arc(R_inner, 1)} strokeLinecap="round" opacity="0.07"/>
        {/* Outer ring — plan progress — bright cyan */}
        <circle cx="50" cy="50" r={R_outer} fill="none" stroke="#00d4ff" strokeWidth="3.5"
          strokeDasharray={arc(R_outer, planPct)} strokeLinecap="round"
          filter="url(#ringGlow)" opacity="0.95">
          <animateTransform attributeName="transform" type="rotate"
            from="-90 50 50" to="270 50 50" dur="20s" repeatCount="indefinite"/>
        </circle>
        {/* Mid ring — day progress — electric blue */}
        <circle cx="50" cy="50" r={R_mid} fill="none" stroke="#00aaff" strokeWidth="2.5"
          strokeDasharray={arc(R_mid, dayPct)} strokeLinecap="round"
          filter="url(#ringGlow)" opacity="0.85">
          <animateTransform attributeName="transform" type="rotate"
            from="-90 50 50" to="-450 50 50" dur="14s" repeatCount="indefinite"/>
        </circle>
        {/* Inner ring — spin accent — bright cyan */}
        <circle cx="50" cy="50" r={R_inner} fill="none" stroke="#00eeff" strokeWidth="2"
          strokeDasharray={arc(R_inner, 0.35)} strokeLinecap="round"
          filter="url(#ringGlowStrong)" opacity="0.9">
          <animateTransform attributeName="transform" type="rotate"
            from="-90 50 50" to="270 50 50" dur="5s" repeatCount="indefinite"/>
        </circle>
        {/* Pulse ripples */}
        <circle cx="50" cy="50" r="16" fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0">
          <animate attributeName="r" values="16;50;16" dur="3.5s" begin="0s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.5;0;0.5" dur="3.5s" begin="0s" repeatCount="indefinite"/>
        </circle>
        <circle cx="50" cy="50" r="16" fill="none" stroke="#00aaff" strokeWidth="1" opacity="0">
          <animate attributeName="r" values="16;50;16" dur="3.5s" begin="1.2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.3;0;0.3" dur="3.5s" begin="1.2s" repeatCount="indefinite"/>
        </circle>
          <text x="50" y="46" className="ring-time-h">{fmt(h)}:{fmt(m)}</text>
          <text x="50" y="57" className="ring-time-s">{fmt(s)}s</text>
        </svg>
      </div>
      <div className="inv-countdown-label">{fmt(h)}:{fmt(m)}:{fmt(s)}</div>
    </>
  )
}

const txIcon  = { profit: TrendingUp, deposit: ArrowDownCircle, withdraw: ArrowUpCircle, referral: Users }
const txClass = { profit:'p',  deposit:'d', withdraw:'w', referral:'r'  }
const txColor = { profit:'#FFD600', deposit:'#0098EA', withdraw:'#EF4444', referral:'#0098EA' }
const txDisplayAmount = (tx) => tx.type === 'withdraw'
  ? -Math.abs(Number(tx.amount) || 0)
  : Number(tx.amount) || 0

function TxIconNode({ type, size = 16 }) {
  const Icon = txIcon[type] || TrendingUp
  return <Icon size={size} color={txColor[type] || '#94A3B8'} />
}

const formatTon = (value, signed = false) => {
  const n = Number(value) || 0
  const sign = signed && n > 0 ? '+' : ''
  return `${sign}${n.toFixed(3)} TON`
}
const formatPct = (value) => `${(Number(value) || 0).toFixed(1)}%`
const formatDateLong = (date = new Date()) =>
  date.toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
const getGreeting = () => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
const formatYieldName = (name) => {
  const v = String(name || '')
    .replace(/\bBasic\b/gi, 'Starter Yield')
    .replace(/\bProfessional\b/gi, 'Pro Yield')
    .replace(/\bElite\b/gi, 'VIP Yield')
  return /\byield\b/i.test(v) ? v : `${v} Yield`
}
const formatYieldLabel = (label) => String(label || '')
  .replace(/\bBasic\b/gi, 'Starter Yield')
  .replace(/\bProfessional\b/gi, 'Pro Yield')
  .replace(/\bElite\b/gi, 'VIP Yield')
  .replace(/\bYield\s+Yield\b/gi, 'Yield')
const yieldNameByMarketId = (id) => {
  const marketId = Number(String(id || '').replace(/^plan-/, ''))
  if (marketId === 1) return 'Starter Yield'
  if (marketId === 2) return 'Pro Yield'
  if (marketId === 3) return 'VIP Yield'
  return ''
}
const formatMarketIdLabel = (key, planName = '') => {
  const normalizedKey = String(key || '')
  if (normalizedKey.startsWith('plan-')) {
    const marketName = planName || yieldNameByMarketId(normalizedKey)
    return marketName ? `Market ID ${formatYieldName(marketName)}` : `Market ID ${normalizedKey.replace(/^plan-/, '')}`
  }
  return `Market ID ${normalizedKey}`
}
const shortCode = (prefix, value) => {
  const raw = String(value || '').replace(/^plan-/, '')
  if (!raw) return `${prefix}-NA`
  const compact = raw.length > 10 ? `${raw.slice(0, 4)}...${raw.slice(-4)}` : raw
  return `${prefix}-${compact}`
}
const isCapitalReleaseTx = (tx) =>
  tx?.type === 'deposit' && (/^principal returned\b/i.test(String(tx.label || '').trim()) || String(tx.id || '').startsWith('ret-'))
const txTitle = (tx) => {
  if (isCapitalReleaseTx(tx)) return 'Capital Release'
  if (tx.type === 'withdraw') return 'Withdrawal'
  return formatYieldLabel(tx.label)
}
const txTime = (ts, opts = {}) =>
  new Date(ts || Date.now()).toLocaleString('en-GB', {
    day:'2-digit',
    month:'short',
    hour:'2-digit',
    minute:'2-digit',
    ...opts,
  })

const statusBadge = (s) => {
  const displayStatus = s === 'sent' ? 'completed' : s
  const map = { completed:'badge-ok', approved:'badge-ok', done:'badge-ok', rejected:'badge-err', failed:'badge-err' }
  const lbl = { completed:'COMPLETED', approved:'COMPLETED', done:'COMPLETED', pending:'PENDING', processing:'PROCESSING', rejected:'FAILED', failed:'FAILED' }
  return <span className={`tx-badge ${map[displayStatus]||''}`}>{lbl[displayStatus] || String(displayStatus || '').toUpperCase()}</span>
}

function getDayLabel(ts) {
  if (!ts) return 'Unknown'
  const d = new Date(ts)
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1)
  const day = new Date(d); day.setHours(0,0,0,0)
  if (day.getTime() === today.getTime()) return 'Today'
  if (day.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
}

function groupTxByDay(txs) {
  const groups = []
  const seen = {}
  txs.forEach(tx => {
    const ts = tx.createdAt || Date.now()
    const label = getDayLabel(ts)
    if (!seen[label]) { seen[label] = []; groups.push({ label, items: seen[label] }) }
    seen[label].push(tx)
  })
  return groups
}

function getProfitPlanId(tx) {
  if (tx.invoiceId) return String(tx.invoiceId)
  const match = String(tx.id || '').match(/^prf-([^-]+)-/)
  if (match?.[1]) return match[1]
  if (tx.planId) return `plan-${tx.planId}`
  return 'unknown'
}

function getProfitPlanName(items, investments) {
  const first = items[0] || {}
  const key = getProfitPlanId(first)
  const inv = investments.find(i => {
    const ids = [i.invoiceId, i.id, i.planId, i.planId ? `plan-${i.planId}` : '']
    return ids.some(id => String(id || '') === String(key))
  })
  if (inv?.plan) return formatYieldName(inv.plan)
  const labelPlan = String(first.label || '')
    .replace(/^Profit collected\s*[·-]\s*/i, '')
    .replace(/^Profit\s*[·-]\s*/i, '')
    .replace(/^Deposit\s*[·-]\s*/i, '')
    .replace(/^Reinvest\s*[·-]\s*/i, '')
    .trim()
  return formatYieldName(labelPlan || yieldNameByMarketId(key) || 'Starter Yield')
}

function buildTxDisplayItems(items, investments, allTx = []) {
  const output = []
  const profitGroups = new Map()

  items.forEach(tx => {
    if (tx.type !== 'profit') {
      output.push({ kind:'tx', tx })
      return
    }
    const key = getProfitPlanId(tx)
    if (!profitGroups.has(key)) {
      const group = {
        kind:'profitGroup',
        key,
        items:[],
        firstCreatedAt:tx.createdAt || 0,
        capitalRelease: allTx.find(t => isCapitalReleaseTx(t) && String(t.invoiceId || '') === String(key)),
      }
      profitGroups.set(key, group)
      output.push(group)
    }
    const group = profitGroups.get(key)
    group.items.push(tx)
    group.firstCreatedAt = Math.max(group.firstCreatedAt, tx.createdAt || 0)
  })

  return output
}

const TX_TYPE_FILTERS = [
  { id:'deposit', label:'Deposit' },
  { id:'withdraw', label:'Withdraw' },
  { id:'profit', label:'Profit' },
  { id:'referral', label:'Referral' },
]

export default function HomePage({ user, investments, transactions, plans, config, referral, notifications = [], notificationUnread = 0, markNotificationsSeen, onDeposit, onWithdraw, setTab, setIsAdmin, isAdmin, isAdminView, activateInvestment, collectProfit }) {
  const logoRef = useRef(null)
  const pressRef = useRef(null)
  const [showAllTx, setShowAllTx] = useState(false)
  const [txTypeFilter, setTxTypeFilter] = useState('deposit')
  const [expandedProfitIds, setExpandedProfitIds] = useState({})
  const [showNotifications, setShowNotifications] = useState(false)

  // Determine today's inactive plans
  const inactivePlans = (plans || []).filter(p => !(p.activeDays || [1,2,3,4,5]).includes(TODAY_DOW))
  const hasInactiveToday = inactivePlans.length > 0
  const todayLabel = DAY_NAMES_FULL[TODAY_DOW]
  const todayProfit = Number(user?.todayProfit) || 0
  const portfolioValue = Number(user?.balance) || 0
  const todayPct = portfolioValue > 0 ? (todayProfit / portfolioValue) * 100 : 0

  // long-press logo → toggle admin view
  const handlePressStart = () => {
    pressRef.current = setTimeout(() => { setIsAdmin(v => !v) }, 1800)
  }
  const handlePressEnd = () => clearTimeout(pressRef.current)

  return (
    <div className="page page-enter">
      {/* Header */}
      <div className="hp-header">
        <div className="brand">
          <div className="brand-logo-wrap" ref={logoRef}
            onMouseDown={handlePressStart} onMouseUp={handlePressEnd}
            onTouchStart={handlePressStart} onTouchEnd={handlePressEnd}>
            <div className="brand-logo-fire">
              {/* Fire SVG centered on T */}
              <svg className="fire-svg" viewBox="0 0 60 70" xmlns="http://www.w3.org/2000/svg">
                {/* Outer glow */}
                <defs>
                  <radialGradient id="fireGlow" cx="50%" cy="65%" r="50%">
                    <stop offset="0%" stopColor="#00C2FF" stopOpacity="0.9"/>
                    <stop offset="40%" stopColor="#0098EA" stopOpacity="0.5"/>
                    <stop offset="100%" stopColor="#ff0000" stopOpacity="0"/>
                  </radialGradient>
                  <radialGradient id="coreGlow" cx="50%" cy="60%" r="40%">
                    <stop offset="0%" stopColor="#fff5a0" stopOpacity="1"/>
                    <stop offset="50%" stopColor="#ffb300" stopOpacity="0.8"/>
                    <stop offset="100%" stopColor="#0098EA" stopOpacity="0"/>
                  </radialGradient>
                  <filter id="blur1" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="2.5"/>
                  </filter>
                  <filter id="blur2" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="5"/>
                  </filter>
                </defs>
                {/* Background wide glow - extends outside box */}
                <ellipse cx="30" cy="52" rx="28" ry="18" fill="url(#fireGlow)" filter="url(#blur2)" opacity="0.9">
                  <animate attributeName="ry" values="18;22;16;20;18" dur="2.1s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.9;0.6;1;0.7;0.9" dur="2.1s" repeatCount="indefinite"/>
                </ellipse>
                {/* Main flame body left */}
                <path d="M22 58 Q16 45 20 35 Q14 42 12 52 Q8 38 18 28 Q15 34 19 40 Q20 25 28 18 Q24 30 26 38 Q30 22 30 10 Q34 22 34 38 Q36 30 32 18 Q40 25 41 40 Q45 34 42 28 Q52 38 48 52 Q46 42 40 35 Q44 45 38 58 Z" 
                  fill="#0098EA" opacity="0.7">
                  <animate attributeName="d" 
                    values="M22 58 Q16 45 20 35 Q14 42 12 52 Q8 38 18 28 Q15 34 19 40 Q20 25 28 18 Q24 30 26 38 Q30 22 30 10 Q34 22 34 38 Q36 30 32 18 Q40 25 41 40 Q45 34 42 28 Q52 38 48 52 Q46 42 40 35 Q44 45 38 58 Z;M24 58 Q17 46 21 34 Q13 43 11 53 Q7 37 19 27 Q16 33 20 41 Q21 24 29 16 Q25 29 27 37 Q31 21 30 9 Q35 23 33 39 Q37 29 31 17 Q41 24 42 41 Q47 33 43 27 Q53 37 49 53 Q47 43 41 34 Q45 46 36 58 Z;M22 58 Q16 45 20 35 Q14 42 12 52 Q8 38 18 28 Q15 34 19 40 Q20 25 28 18 Q24 30 26 38 Q30 22 30 10 Q34 22 34 38 Q36 30 32 18 Q40 25 41 40 Q45 34 42 28 Q52 38 48 52 Q46 42 40 35 Q44 45 38 58 Z"
                    dur="0.8s" repeatCount="indefinite"/>
                </path>
                {/* Inner bright flame */}
                <path d="M26 56 Q22 46 25 38 Q21 43 22 50 Q19 39 26 32 Q24 38 26 43 Q28 30 30 22 Q32 30 34 43 Q36 38 34 32 Q41 39 38 50 Q39 43 35 38 Q38 46 34 56 Z"
                  fill="#ffb300" opacity="0.85">
                  <animate attributeName="d"
                    values="M26 56 Q22 46 25 38 Q21 43 22 50 Q19 39 26 32 Q24 38 26 43 Q28 30 30 22 Q32 30 34 43 Q36 38 34 32 Q41 39 38 50 Q39 43 35 38 Q38 46 34 56 Z;M27 56 Q23 47 26 37 Q20 44 21 51 Q18 38 27 31 Q25 37 27 44 Q29 29 30 20 Q31 29 33 44 Q35 37 33 31 Q42 38 39 51 Q40 44 36 37 Q39 47 33 56 Z;M26 56 Q22 46 25 38 Q21 43 22 50 Q19 39 26 32 Q24 38 26 43 Q28 30 30 22 Q32 30 34 43 Q36 38 34 32 Q41 39 38 50 Q39 43 35 38 Q38 46 34 56 Z"
                    dur="0.6s" repeatCount="indefinite"/>
                </path>
                {/* Core white-yellow */}
                <ellipse cx="30" cy="48" rx="6" ry="9" fill="url(#coreGlow)" filter="url(#blur1)">
                  <animate attributeName="ry" values="9;11;8;10;9" dur="0.5s" repeatCount="indefinite"/>
                </ellipse>
              </svg>
              {/* The T letter */}
              <span className="brand-logo-T">T</span>
            </div>
          </div>
          <div>
            <div className="brand-name">{getGreeting()}, {user?.firstName || user?.username || 'Investor'}</div>
            <div className="notif-sub">{formatDateLong()}</div>
          </div>
        </div>
        <div className="header-right">
          {isAdmin && !isAdminView && (
            <div className="admin-badge enter-admin" onClick={() => setIsAdmin(true)} title="Enter Admin Panel">
              <Shield size={16} color="#0098EA" />
              <span>ADMIN</span>
            </div>
          )}
          {isAdminView && (
            <div className="admin-badge active-admin" onClick={() => setTab('admin')}>
              <Play size={16} color="#0098EA" />
              <span>Panel</span>
            </div>
          )}
          <button className="notif-btn" onClick={() => { setShowNotifications(true); markNotificationsSeen?.() }} title="Notifications">
            <Bell size={20} color={notificationUnread > 0 ? '#0098EA' : '#94A3B8'} />
            {notificationUnread > 0 && <span className="notif-dot">{notificationUnread > 9 ? '9+' : notificationUnread}</span>}
          </button>
        </div>
      </div>

      {showNotifications && (
        <div className="notif-overlay" onClick={() => setShowNotifications(false)}>
          <div className="notif-panel" onClick={e => e.stopPropagation()}>
            <div className="notif-head">
              <div>
                <div className="notif-title">NOTIFICATIONS</div>
                <div className="notif-sub">System announcements</div>
              </div>
              <button className="notif-close" onClick={() => setShowNotifications(false)}>×</button>
            </div>
            <div className="notif-list">
              {notifications.length === 0 && <div className="notif-empty">No notifications.</div>}
              {notifications.map(n => (
                <div key={n.id} className="notif-item">
                  <div className="notif-item-title">{n.title}</div>
                  <div className="notif-item-body">{n.body}</div>
                  <div className="notif-time">{new Date(n.createdAt).toLocaleString([], { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Balance Hero */}
      <div className="bal-hero">
        <div className="oc-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="bal-tag">PORTFOLIO VALUE</div>
        <div className="bal-num">{formatTon(user?.balance).replace(' TON','')} <span>TON</span></div>
        <div className="bal-profit">
          <span className="green-dot" /><span className="green">{formatTon(todayProfit, true)} today ({formatPct(todayPct)})</span>
        </div>
        <div className="bal-btns">
          <button className="bb dep" onClick={onDeposit}>
            <ArrowDownCircle size={16} color="#FFFFFF" />
            Open Position
          </button>
          <button className="bb wit" onClick={onWithdraw}>
            <ArrowUpCircle size={16} color="#0098EA" />
            Withdraw
          </button>
        </div>
      </div>

      {/* Status row */}
      <div className="status-row">
        <div className="status-pill">
          {hasInactiveToday
            ? <><div className="sp-dot orange"/><div><div className="sp-label">Today: {todayLabel}</div><div className="sp-val" style={{color:'var(--gold)'}}>Some plans paused</div></div></>
            : <><div className="sp-dot green"/><div><div className="sp-label">Referral income</div><div className="sp-val" style={{color:'var(--green)'}}>{formatTon(referral?.commission || 0)}</div></div></>
          }
        </div>
        <div className="status-pill">
          <div className="sp-dot blue"/>
          <div>
            <div className="sp-label">Active positions</div>
            <div className="sp-val">{investments.length}</div>
          </div>
        </div>
        <div className="status-pill">
          <div className="sp-dot blue"/>
          <div>
            <div className="sp-label">Total deposited</div>
            <div className="sp-val">{formatTon(user?.totalDeposit || 0)}</div>
          </div>
        </div>
        <div className="status-pill">
          <div className="sp-dot orange"/>
          <div>
            <div className="sp-label">Total withdrawn</div>
            <div className="sp-val">{formatTon(user?.totalWithdraw || 0)}</div>
          </div>
        </div>
      </div>

      {/* Investments with plan rings */}
      <div className="sec">
        <div className="sec-hdr">
          <div className="sec-title">ACTIVE POSITIONS <span>{investments.length}</span></div>
          <div className="sec-link" onClick={() => setTab('plans')}>VIEW MARKETS</div>
        </div>
        {investments.length === 0 && (
          <div className="empty-state">
            <div className="es-icon"><Target size={32} color="#0098EA" /></div>
            <div className="es-text">NO ACTIVE POSITIONS</div>
            <div className="notif-sub">Your portfolio is empty. Explore available yield strategies to get started.</div>
            <button className="es-btn" onClick={() => setTab('plans')}>VIEW MARKETS</button>
          </div>
        )}
        {investments.map(inv => {
          const activeToday = isPlanActiveToday(inv)
          return (
            <div key={inv.id} className={`inv-card ${inv.planColor} ${!activeToday ? 'inv-paused' : ''}`}>
              <div className="inv-main">
                <div className="inv-left">
                  <div className="inv-badge-row">
                    <span className={`inv-badge ${inv.planColor}`}>{formatYieldName(inv.plan).toUpperCase()}</span>
                    <span className="tx-badge badge-ok">{activeToday ? 'ACTIVE' : 'PAUSED'}</span>
                  </div>
                  {inv.invoiceId && (
                    <div className="inv-id-row">
                      <span className="inv-id-lbl">Market ID</span>
                      <span className="inv-id-val">{inv.invoiceId}</span>
                    </div>
                  )}
                  <div className="inv-amount">{formatTon(inv.amount).replace(' TON','')} <span>TON</span></div>
                  <div className="inv-rate">Principal</div>
                  <div className="inv-rate">
                    {(() => {
                      const ms = inv.intervalMs
                        || inv.profitIntervalMs
                        || (inv.profitIntervalMinutes ? inv.profitIntervalMinutes * 60_000 : 0)
                        || (inv.profitIntervalHours   ? inv.profitIntervalHours   * 3_600_000 : 0)
                        || 86_400_000
                      if (ms < 3_600_000)  return `${formatPct(inv.rate)} / ${Math.round(ms/60_000)} min`
                      if (ms < 86_400_000) {
                        const hours = Math.round(ms/3_600_000)
                        return `${formatPct(inv.rate)} / ${hours} hour${hours === 1 ? '' : 's'}`
                      }
                      return `${formatPct(inv.rate)} / day`
                    })()}
                  </div>
                  <div className="inv-earned-row">
                    <span className="inv-earned-lbl">Earned</span>
                    <span className="inv-earned">{formatTon(inv.earned || 0, true)}</span>
                  </div>
                  <div className="pbar-wrap">
                    <div className="pbar"><div className={`pbar-fill ${inv.planColor}`} style={{width:`${inv.progress}%`}}/></div>
                    <div className="pbar-meta">Progress {inv.progress}%</div>
                  </div>
                </div>
                <div className="inv-right">
                  <PlanRing inv={inv} onActivate={activateInvestment} onCollect={collectProfit} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Referral mini */}
      <div className="sec">
        <div className="ref-mini" onClick={() => setTab('profile')}>
          <div className="rm-left">
            <div className="rm-icon"><Users size={18} color="#0098EA" /></div>
            <div>
              <div className="rm-label">REFERRAL PROGRAM</div>
              <div className="rm-sub">{referral?.friends ?? 0} referred users. {formatTon(referral?.commission ?? 0)} referral income.</div>
            </div>
          </div>
          <div className="rm-arrow"><ChevronRight size={18} color="#94A3B8" /></div>
        </div>
      </div>

      {/* Transactions */}
      <div className="sec">
        <div className="sec-hdr">
          <div className="sec-title">TRANSACTION HISTORY</div>
        </div>
        {transactions.length === 0 && (
          <div className="tx-empty">NO TRANSACTIONS<br/>Your transaction history will appear here once you make your first deposit.</div>
        )}
        {transactions.length > 0 && (() => {
          const counts = TX_TYPE_FILTERS.reduce((acc, f) => {
            acc[f.id] = transactions.filter(tx => tx.type === f.id).length
            return acc
          }, {})
          const activeType = txTypeFilter
          const activeItems = transactions.filter(tx => tx.type === activeType)
          const displayItems = buildTxDisplayItems(activeItems, investments, transactions)
          return (
            <>
              {/* Day tab strip — swipe left/right */}
              <div className="tx-type-strip">
                {TX_TYPE_FILTERS.map(f => (
                  <button
                    key={f.id}
                    className={`tx-type-tab ${activeType === f.id ? 'active' : ''} ${f.id}`}
                    onClick={() => setTxTypeFilter(f.id)}
                  >
                    <span>{f.label}</span>
                    <b>{counts[f.id] || 0}</b>
                  </button>
                ))}
              </div>
              {/* Transactions for selected day */}
              <div className="tx-list card tx-list-animated">
                {displayItems.length === 0 && (
                  <div className="tx-filter-empty">No {TX_TYPE_FILTERS.find(f => f.id === activeType)?.label.toLowerCase()} transactions.</div>
                )}
                {displayItems.map(item => {
                  if (item.kind === 'profitGroup') {
                    const opened = !!expandedProfitIds[item.key]
                    const total = item.items.reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0)
                    const planName = getProfitPlanName(item.items, investments)
                    return (
                      <div key={`profit-${item.key}`} className={`tx-profit-group ${opened ? 'open' : ''} ${item.capitalRelease ? 'capital-settled' : ''}`}>
                        <button
                          type="button"
                          className="tx-row tx-profit-head"
                          onClick={() => setExpandedProfitIds(p => ({ ...p, [item.key]: !p[item.key] }))}
                        >
                          <div className={`tx-ico ${txClass.profit}`}>
                            {opened ? <Minus size={16} color="#FFD600" /> : <Plus size={16} color="#FFD600" />}
                          </div>
                          <div className="tx-inf">
                            <div className="tx-title-row">
                              <div className="tx-n">{planName}</div>
                              {item.capitalRelease ? <span className="tx-kind release">RELEASED</span> : <span className="tx-kind profit">YIELD</span>}
                            </div>
                            <div className="tx-meta-row">
                              <span>{shortCode('MK', item.key)}</span>
                              <span>{item.items.length} payouts</span>
                              <span>{txTime(item.firstCreatedAt)}</span>
                              {item.capitalRelease && <span>{shortCode('CR', item.capitalRelease.id)}</span>}
                            </div>
                          </div>
                          <div className="tx-right">
                            <div className="tx-a pos">{formatTon(total, true)}</div>
                            <span className="tx-badge badge-ok">COMPLETED</span>
                          </div>
                        </button>
                        {opened && (
                          <div className="tx-profit-items">
                            {item.items.map(tx => (
                              <div key={tx.id} className="tx-row tx-profit-child">
                                <div className={`tx-ico ${txClass.profit}`}><TxIconNode type="profit" /></div>
                                <div className="tx-inf">
                                  <div className="tx-n">Yield payout</div>
                                  <div className="tx-meta-row">
                                    <Clock size={12} />
                                    <span>{txTime(tx.createdAt)}</span>
                                  </div>
                                </div>
                                <div className="tx-right">
                                  <div className="tx-a pos">{formatTon(Math.abs(Number(tx.amount) || 0), true)}</div>
                                  {statusBadge(tx.status)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  }
                  const tx = item.tx
                  const shownAmount = txDisplayAmount(tx)
                  return (
                    <div key={tx.id} className={`tx-row ${isCapitalReleaseTx(tx) ? 'capital-release' : ''}`}>
                      <div className={`tx-ico ${txClass[tx.type]}`}><TxIconNode type={tx.type} /></div>
                      <div className="tx-inf">
                        <div className="tx-title-row">
                          <div className="tx-n">{txTitle(tx)}</div>
                          <span className={`tx-kind ${isCapitalReleaseTx(tx) ? 'release' : tx.type}`}>{isCapitalReleaseTx(tx) ? 'RELEASE' : tx.type}</span>
                        </div>
                        <div className="tx-meta-row">
                          {tx.type === 'withdraw' ? (
                            <>
                              <Hash size={12} />
                              <span>{shortCode('WD', tx.id)}</span>
                              <span>{txTime(tx.createdAt)}</span>
                            </>
                          ) : tx.invoiceId ? (
                            <>
                              <Hash size={12} />
                              <span>{shortCode('MK', tx.invoiceId)}</span>
                              <span>{txTime(tx.createdAt)}</span>
                            </>
                          ) : (
                            <>
                              <Clock size={12} />
                              <span>{txTime(tx.createdAt)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="tx-right">
                        <div className={`tx-a ${shownAmount >= 0 ? 'pos' : 'neg'}`}>{formatTon(shownAmount, true)}</div>
                        {statusBadge(tx.status)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )
        })()}
      </div>
      <div style={{height:8}}/>
    </div>
  )
}
