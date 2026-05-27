import React, { useState, useEffect } from 'react'
import {
  ArrowDownCircle, ArrowUpCircle, Ban, BarChart2, Bell, Bomb, Bot, CheckCircle2,
  Clock, Cloud, Coins, Database, Download, Globe2, IdCard,
  RefreshCw, Save, Search, Send, Settings as SettingsIcon, Shield, Trash2, User,
  Users, Wallet, X, XCircle, Zap
} from 'lucide-react'
import { DAY_NAMES, DAY_NAMES_FULL } from '../utils/config'
import { supabase } from '../utils/supabase'
import './AdminPage.css'

const fmtDate = (ts) => {
  if (!ts) return '—'
  const d = new Date(Number(ts))
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}, ${hh}:${mi}`
}
const fmtDateShort = (dateStr) => {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' }) }
  catch { return dateStr }
}
const shortWallet = (addr) => addr ? addr.slice(0,8)+'...'+addr.slice(-6) : '—'
const TODAY_DOW = new Date().getDay()
const formatTon = (value) => `${(Number(value) || 0).toFixed(3)} TON`
const adminIconColor = {
  blue: '#0098EA',
  green: '#FFD600',
  red: '#EF4444',
  gold: '#FFD600',
  purple: '#00C2FF',
  muted: '#94A3B8',
}
const txIconMap = { deposit: ArrowDownCircle, withdraw: ArrowUpCircle, profit: Coins, referral: Users, mine: Bomb, game: Bomb }
const txIconColor = { deposit: '#0098EA', withdraw: '#EF4444', profit: '#FFD600', referral: '#0098EA', mine: '#00C2FF', game: '#00C2FF' }
const displayTxStatus = (status) => status === 'sent' ? 'completed' : status
const TX_TYPE_FILTERS = [
  { id:'deposit', label:'Deposit' },
  { id:'withdraw', label:'Withdraw' },
  { id:'profit', label:'Profit' },
  { id:'mine', label:'Mine' },
  { id:'referral', label:'Referral' },
]
const sectionIconMap = {
  overview: BarChart2,
  users: Users,
  deposits: ArrowDownCircle,
  withdraws: ArrowUpCircle,
  history: Database,
  notifications: Bell,
  plans: Zap,
  settings: SettingsIcon,
}

function AdminTxIcon({ type, size = 16 }) {
  const Icon = txIconMap[type] || BarChart2
  return <Icon size={size} color={txIconColor[type] || '#94A3B8'} />
}

const yieldNameByMarketId = (id) => {
  const marketId = Number(String(id || '').replace(/^plan-/, ''))
  if (marketId === 1) return 'Starter Yield'
  if (marketId === 2) return 'Pro Yield'
  if (marketId === 3) return 'VIP Yield'
  return ''
}

const getProfitPlanId = (tx) => {
  if (tx.invoiceId) return String(tx.invoiceId)
  const match = String(tx.id || '').match(/^prf-([^-]+)-/)
  if (match?.[1]) return match[1]
  if (tx.planId) return `plan-${tx.planId}`
  return 'unknown'
}

const getProfitPlanName = (items) => {
  const first = items[0] || {}
  const key = getProfitPlanId(first)
  const labelPlan = String(first.label || '')
    .replace(/^Profit collected\s*[·-]\s*/i, '')
    .replace(/^Profit\s*[·-]\s*/i, '')
    .replace(/^Deposit\s*[·-]\s*/i, '')
    .replace(/^Reinvest\s*[·-]\s*/i, '')
    .trim()
  return labelPlan || yieldNameByMarketId(key) || 'Yield Market'
}

const isCapitalReleaseTx = (tx) =>
  tx?.type === 'deposit' && (/^principal returned\b/i.test(String(tx.label || '').trim()) || String(tx.id || '').startsWith('ret-'))
const isMineTx = (tx) =>
  tx?.type === 'mine' || tx?.type === 'game' || /^mine\b/i.test(String(tx?.label || '').trim())
const mineResult = (tx) => {
  const label = String(tx?.label || '')
  if (/^mine created\b/i.test(label)) return 'LOCK'
  if (/^mine creator|^mine room return/i.test(label)) return 'REWARD'
  return (Number(tx?.amount) || 0) >= 0 ? 'WIN' : 'LOSS'
}
const adminTxTitle = (tx) => {
  if (isCapitalReleaseTx(tx)) return 'Capital Release'
  if (isMineTx(tx)) {
    const result = mineResult(tx)
    if (result === 'WIN') return 'Mine Win'
    if (result === 'LOSS') return 'Mine Loss'
    if (result === 'LOCK') return 'Mine Room'
    return 'Mine Reward'
  }
  return tx.label
}

const txMatchesFilter = (tx, filterId) => {
  if (filterId === 'mine') return isMineTx(tx)
  if (filterId === 'profit') return tx.type === 'profit' && !isMineTx(tx)
  return tx.type === filterId
}

const buildProfitGroups = (txs, allTx = []) => {
  const groups = new Map()
  txs.forEach(tx => {
    const key = getProfitPlanId(tx)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        items:[],
        total:0,
        latest:0,
        capitalRelease: allTx.find(t => isCapitalReleaseTx(t) && String(t.invoiceId || '') === String(key)),
      })
    }
    const group = groups.get(key)
    group.items.push(tx)
    group.total += Math.abs(Number(tx.amount) || 0)
    group.latest = Math.max(group.latest, Number(tx.createdAt) || 0)
  })
  return [...groups.values()].sort((a,b) => b.latest - a.latest)
}
const shortCode = (value) => {
  const raw = String(value || '')
    .replace(/^plan-/i, '')
    .replace(/^(tx-wd-|tx-|wd-|prf-|ref-|ret-|inv-|mine-lock-|mine-player-|mine-creator-|mine-)/i, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .replace(/^(txwd|tx|wd|prf|ref|ret|inv|mine)/i, '')
  if (!raw) return 'NA'
  return raw.length > 10 ? `${raw.slice(0, 4)}...${raw.slice(-4)}` : raw
}
const copyText = (value) => {
  const text = String(value || '')
  if (!text) return
  navigator.clipboard?.writeText(text).catch(() => {})
}
function CopyIdChip({ label, value }) {
  return (
    <span
      className="copy-id-chip"
      title={`Copy ${label}`}
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); copyText(value) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          copyText(value)
        }
      }}
    >
      {label}
    </span>
  )
}

export default function AdminPage({
  user,
  computeAdminStats, getAllUsers, getAllTransactions,
  plans,
  adminToggleBan, adminUpdatePlan, adminToggleMaintenance,
  adminUpdateUser, adminRetryWithdrawal, adminSaveSettings, adminSendNotification,
  adminGetNotifications, adminDeleteNotification, adminTestBotNotification,
  config, showToast, setIsAdmin
}) {
  const [section, setSection] = useState('overview')
  const [editPlan, setEditPlan] = useState(null)
  const [editUser, setEditUser] = useState(null)
  const [userSearch, setUserSearch] = useState('')
  const [txFilter, setTxFilter] = useState('deposit')
  const [selectedUser, setSelectedUser] = useState(null)
  const [expandedProfitIds, setExpandedProfitIds] = useState({})

  const [adminStats, setAdminStats]   = useState(null)
  const [allUsers,   setAllUsers]     = useState([])
  const [allTx,      setAllTx]        = useState([])
  const [dataLoading, setDataLoading] = useState(false)
  const [retryingWithdrawIds, setRetryingWithdrawIds] = useState(() => new Set())

  const loadAdminData = async (silent = false) => {
    if (!silent) setDataLoading(true)
    try {
      const [stats, users, txs] = await Promise.all([
        computeAdminStats(),
        getAllUsers(),
        getAllTransactions(),
      ])
      setAdminStats(stats)
      setAllUsers(users)
      setAllTx(txs)
    } catch(e) {
      console.warn('[AdminPage] load error:', e)
    } finally {
      setDataLoading(false)
    }
  }

  useEffect(() => {
    loadAdminData(true)
    const refresh = () => loadAdminData(true)
    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event:'*', schema:'public', table:'users' }, refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'investments' }, refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'transactions' }, refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'plans' }, refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'admin_config' }, refresh)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, []) // eslint-disable-line

  useEffect(() => {
    setRetryingWithdrawIds(prev => {
      if (prev.size === 0) return prev
      const next = new Set(prev)

      prev.forEach(txId => {
        const tx = allTx.find(t => t.id === txId)
        if (!tx || !['pending', 'processing'].includes(tx.status)) next.delete(txId)
      })

      return next.size === prev.size ? prev : next
    })
  }, [allTx])

  const markWithdrawRetryDone = (txId) => {
    setRetryingWithdrawIds(prev => {
      if (!prev.has(txId)) return prev
      const next = new Set(prev)
      next.delete(txId)
      return next
    })
  }

  const handleRetryWithdrawal = async (txId) => {
    setRetryingWithdrawIds(prev => {
      const next = new Set(prev)
      next.add(txId)
      return next
    })

    const result = await adminRetryWithdrawal?.(txId)
    if (!result) {
      markWithdrawRetryDone(txId)
      return
    }

    if (result?.tx?.status && result.tx.status !== 'processing') {
      markWithdrawRetryDone(txId)
    }
    loadAdminData(true)
    window.setTimeout(() => markWithdrawRetryDone(txId), 120000)
  }

  const allTxSorted = [...allTx].sort((a,b) => (b.createdAt||0) - (a.createdAt||0))
  const txCounts = TX_TYPE_FILTERS.reduce((acc, f) => {
    acc[f.id] = allTx.filter(t => txMatchesFilter(t, f.id)).length
    return acc
  }, {})
  const activeTxFilter = txFilter
  const filteredTx  = allTxSorted.filter(t => txMatchesFilter(t, activeTxFilter))
  const filteredProfitGroups = activeTxFilter === 'profit' ? buildProfitGroups(filteredTx, allTx) : []

  const filteredUsers = allUsers.filter(u => {
    if (!userSearch) return true
    const q = userSearch.toLowerCase()
    return (
      String(u.id).includes(q) ||
      (u.username||'').toLowerCase().includes(q) ||
      (u.firstName||'').toLowerCase().includes(q) ||
      (u.walletAddr||'').toLowerCase().includes(q)
    )
  })
  const confirmDeleteUser = (u) => {
    const label = u?.username ? `@${u.username}` : `ID #${u?.id}`
    return window.confirm(`Delete ${label}?\n\nThis removes the user, positions, transactions, and user notifications permanently.`)
  }

  const stats = adminStats ? [
    { label:'Registered Users',   val: adminStats.totalUsers,                color:'blue',   Icon: Users },
    { label:'Active Users',       val: adminStats.activeUsers,               color:'green',  Icon: CheckCircle2 },
    { label:'Restricted Users',   val: adminStats.bannedUsers,               color:'red',    Icon: Ban },
    { label:'Total Deposited',    val: formatTon(adminStats.totalDeposited), color:'gold',   Icon: ArrowDownCircle },
    { label:'Total Withdrawn',    val: formatTon(adminStats.totalWithdrawn), color:'purple', Icon: ArrowUpCircle },
    { label:'Net in Custody',     val: formatTon(adminStats.netInCustody),   color:'blue',   Icon: Database },
    { label:'Active Positions',   val: adminStats.activeInvestments,         color:'blue',   Icon: Zap },
    { label:'Pending Withdrawals',val: adminStats.pendingWithdraws,          color: adminStats.pendingWithdraws > 0 ? 'red' : 'muted', Icon: Clock },
    { label:"Today's Yield",     val: formatTon(adminStats.todayProfit),    color:'green',  Icon: Coins },
    { label:'Mine Fees Earned',   val: formatTon(adminStats.mineFeeEarned),  color:'gold',   Icon: Bomb },
    { label:'Required Daily Reserve', val: formatTon(adminStats.requiredYieldReserve), color:'gold', Icon: Wallet },
  ] : []

  const sections = [
    { id:'overview',  label:'Overview'   },
    { id:'users',     label:'Users', badge: allUsers.length },
    { id:'deposits',  label:'Deposits',  badge: allTx.filter(t=>t.type==='deposit').length },
    { id:'withdraws', label:'Withdrawals', badge: adminStats?.pendingWithdraws || 0, badgeColor: 'red' },
    { id:'history',   label:'History'    },
    { id:'notifications', label:'Notifications' },
    { id:'plans',     label:'Markets'      },
    { id:'settings',  label:'Configuration' },
  ]

  return (
    <div className="page admin-page page-enter">
      <div className="admin-header">
        <div className="admin-title">
          <span className="admin-shield"><Shield size={20} color="#0098EA" /></span>
          <div className="admin-title-info">
            <span>ADMIN PANEL</span>
            <span className="admin-id-badge">ID: {user?.id}</span>
          </div>
        </div>
        <div className="admin-header-right">
          <button className={`maint-btn ${config.maintenanceMode ? 'on' : ''}`} onClick={adminToggleMaintenance}>
            {config.maintenanceMode ? <><XCircle size={16} color="#EF4444" /> MAINTENANCE</> : <><SettingsIcon size={16} color="#0098EA" /> OPERATIONAL</>}
          </button>
          <button className="adm-refresh-btn" onClick={loadAdminData} title="Refresh"><RefreshCw size={16} color="#0098EA" /></button>
          <button className="exit-admin-btn" onClick={() => setIsAdmin(false)} title="Exit Admin"><X size={16} color="#FFFFFF" /> Exit</button>
        </div>
      </div>

      <div className="cloud-sync-badge">
        <span className="csb-icon"><Cloud size={16} color="#0098EA" /></span>
        <span>Supabase {dataLoading ? 'syncing...' : 'ready'}</span>
      </div>

      <div className="admin-tabs">
        {sections.map(s => {
          const Icon = sectionIconMap[s.id] || BarChart2
          return (
            <div
              key={s.id}
              className={`adm-tab ${section===s.id?'on':''}`}
              onClick={() => setSection(s.id)}
              title={s.label}
              aria-label={s.label}
            >
              <Icon size={14} />
            </div>
          )
        })}
      </div>

      {/* ─── OVERVIEW ──────────────────────────────────────────────────────── */}
      {section === 'overview' && (
        <div className="adm-section overview-section">
          <div className="overview-command">
            <div className="oc-grid" />
            <div className="oc-scanline" aria-hidden="true" />
            <div className="oc-main">
              <div className="oc-kicker">
                <span className="oc-live-dot" />
                Live Control Layer
              </div>
              <div className="oc-title">Network Ops</div>
              <div className="oc-sub">
                Realtime custody, reserve, markets, and payout telemetry.
              </div>
            </div>
            <div className="oc-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="oc-nodes" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="oc-metrics">
              <div className="oc-metric">
                <span>Custody</span>
                <strong>{formatTon(adminStats?.netInCustody)}</strong>
              </div>
              <div className="oc-metric">
                <span>Yield Reserve</span>
                <strong>{formatTon(adminStats?.requiredYieldReserve)}</strong>
              </div>
              <div className="oc-metric danger">
                <span>Payout Queue</span>
                <strong>{adminStats?.pendingWithdraws || 0}</strong>
              </div>
              <div className="oc-metric mine">
                <span>Mine Fees</span>
                <strong>{formatTon(adminStats?.mineFeeEarned)}</strong>
              </div>
            </div>
          </div>
          <div className="stat-grid">
            {stats.map((s,i) => (
              <div key={i} className={`stat-box ${s.color}`}>
                <div className="sb-icon"><s.Icon size={18} color={adminIconColor[s.color] || '#94A3B8'} /></div>
                <div className="sb-val">{s.val}</div>
                <div className="sb-label">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="day-status-bar">
            <div className="dsb-label">Today: <strong>{DAY_NAMES_FULL[TODAY_DOW]}</strong></div>
            <div className="dsb-plans">
              {plans.map(p => {
                const active = (p.activeDays||[1,2,3,4,5]).includes(TODAY_DOW)
                return (
                  <div key={p.id} className={`dsb-plan ${active?'on':'off'}`}>
                    <span className={`dsb-dot ${p.color}`}/>
                    {p.name}: <strong>{active?'Active':'Paused'}</strong>
                  </div>
                )
              })}
            </div>
          </div>
          {/* Recent transactions preview */}
          {false && allTxSorted.slice(0,5).length > 0 && (
            <div style={{marginTop:16}}>
              <div className="adm-sec-title" style={{marginBottom:8}} />
              {allTxSorted.slice(0,5).map(tx => (
                <div key={tx.id} className="adm-tx-row">
                  <div className={`atr-ico ${tx.type}`}><AdminTxIcon type={tx.type} /></div>
                  <div className="atr-left">
                    <div className="atr-label">User#{tx.userId} · {tx.label}</div>
                    <div className="atr-date">{fmtDate(tx.createdAt)}</div>
                  </div>
                  <div className="atr-right">
                    <span className={tx.amount>0?'pos':'neg'}>{tx.amount>0?'+':''}{(+tx.amount).toFixed(2)}</span>
                    <span className={`adm-status ${displayTxStatus(tx.status)}`}>{displayTxStatus(tx.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── USERS ─────────────────────────────────────────────────────────── */}
      {section === 'users' && (
        <div className="adm-section">
          <div className="adm-sec-title">USER DIRECTORY ({filteredUsers.length})</div>
          {/* Search */}
          <div className="user-search-wrap">
            <span className="user-search-icon"><Search size={16} color="#94A3B8" /></span>
            <input
              className="user-search-input"
              type="text"
              placeholder="Search by ID, username, wallet..."
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
            />
            {userSearch && <button className="user-search-clear" onClick={() => setUserSearch('')}><X size={16} color="#94A3B8" /></button>}
          </div>

          {filteredUsers.length === 0 && <div className="adm-empty">No users found</div>}
          {filteredUsers.map(u => (
            <div key={u.id} className={`user-card ${u.status}`}>
              {editUser === u.id ? (
                <UserEditor
                  user={u}
                  onSave={(updates) => { adminUpdateUser(u.id, updates); setEditUser(null); setTimeout(loadAdminData, 800) }}
                  onCancel={() => setEditUser(null)}
                />
              ) : selectedUser === u.id ? (
                <UserDetail
                  user={u}
                  allTx={allTx.filter(t => Number(t.userId) === Number(u.id))}
                  onClose={() => setSelectedUser(null)}
                  onEdit={() => { setSelectedUser(null); setEditUser(u.id) }}
                  onBan={() => { if (confirmDeleteUser(u)) { adminToggleBan(u.id); setSelectedUser(null); setTimeout(loadAdminData, 800) } }}
                />
              ) : (
                <>
                  {/* Header row */}
                  <div className="uc-header">
                    <div className="uc-avatar" style={{ background: u.status === 'banned' ? 'var(--red)' : 'var(--blue)' }}>
                      {(u.username||u.firstName||'U')[0].toUpperCase()}
                    </div>
                    <div className="uc-info">
                      <div className="uc-name">
                        {u.firstName && <span style={{color:'var(--text)',fontWeight:600}}>{u.firstName} </span>}
                        <span style={{color:'var(--muted)',fontSize:12}}>@{u.username||'—'}</span>
                      </div>
                      <div className="uc-id">
                        ID #{u.id}
                        {u.joinDate && <span style={{color:'var(--muted)',marginLeft:8}}>· Joined {fmtDateShort(u.joinDate)}</span>}
                      </div>
                    </div>
                    <span className={`user-status-badge ${u.status}`}>{u.status}</span>
                  </div>

                  {/* Wallet */}
                  {u.walletAddr && (
                    <div className="uc-wallet-row">
                      <span className="uc-wallet-icon"><Wallet size={16} color="#0098EA" /></span>
                      <span className="uc-wallet-addr" title={u.walletAddr}>{shortWallet(u.walletAddr)}</span>
                    </div>
                  )}

                  {/* Stats grid */}
                  <div className="uc-stats">
                    <div className="ucs"><div className="ucs-val">{(u.balance||0).toFixed(2)}</div><div className="ucs-lbl">Balance</div></div>
                    <div className="ucs"><div className="ucs-val" style={{color:'var(--green)'}}>{(+u.totalDeposit||0).toFixed(2)}</div><div className="ucs-lbl">Deposited</div></div>
                    <div className="ucs"><div className="ucs-val" style={{color:'var(--red)'}}>{(+u.totalWithdraw||0).toFixed(2)}</div><div className="ucs-lbl">Withdrawn</div></div>
                    <div className="ucs"><div className="ucs-val" style={{color:'var(--blue)'}}>{u.referralFriends||0}</div><div className="ucs-lbl">Referrals</div></div>
                    <div className="ucs"><div className="ucs-val" style={{color:'var(--gold)'}}>{u.activeInvestments||0}</div><div className="ucs-lbl">Active Inv</div></div>
                    <div className="ucs"><div className="ucs-val">{u.txCount||0}</div><div className="ucs-lbl">Txns</div></div>
                  </div>

                  {/* Pending withdraw warning */}
                  {u.pendingWithdraw > 0 && (
                    <div className="uc-pending-warn">
                      <Clock size={16} color="#FFD600" /> Pending withdrawal: <strong>{u.pendingWithdraw.toFixed(2)} TON</strong>
                    </div>
                  )}

                  {/* Referral commission */}
                  {(u.referralCommission||0) > 0 && (
                    <div className="uc-ref-row">
                      <span><Coins size={16} color="#FFD600" /> Referral earned: <strong>{(+u.referralCommission).toFixed(2)} TON</strong> · ref deposits <strong>{(+u.referralDepositVolume||0).toFixed(2)} TON</strong></span>
                    </div>
                  )}

                  <div className="uc-actions">
                    <button className="uc-detail-btn" onClick={() => setSelectedUser(u.id)}><User size={16} color="#0098EA" /> Details</button>
                    <button className="uc-edit-btn"   onClick={() => setEditUser(u.id)}><SettingsIcon size={16} color="#0098EA" /> Edit</button>
                    <button className="ban-btn delete" onClick={() => { if (confirmDeleteUser(u)) { adminToggleBan(u.id); setTimeout(loadAdminData, 800) } }}>
                      <Trash2 size={16} color="#EF4444" /> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── DEPOSITS ──────────────────────────────────────────────────────── */}
      {section === 'deposits' && (
        <div className="adm-section">
          <div className="adm-sec-title">DEPOSITS ({allTx.filter(t=>t.type==='deposit').length})</div>
          {allTx.filter(t=>t.type==='deposit').length === 0 && <div className="adm-empty">No deposits.</div>}
          {allTxSorted.filter(t=>t.type==='deposit').map(tx => (
            <div key={tx.id} className="adm-tx-row">
              <div className="atr-ico deposit"><AdminTxIcon type="deposit" /></div>
              <div className="atr-left">
                <div className="atr-label">
                  {(() => {
                    const u = allUsers.find(u => Number(u.id)===Number(tx.userId))
                    return u ? <><strong>@{u.username||u.firstName||'—'}</strong> <span style={{color:'var(--muted)',fontSize:11}}>#{tx.userId}</span></> : `User #${tx.userId}`
                  })()}
                  <span style={{marginLeft:6, color:'var(--gold)', fontWeight:700}}> · {tx.amount} TON</span>
                </div>
                <div className="atr-date">{tx.label} · {fmtDate(tx.createdAt)}</div>
              </div>
              <span className={`adm-status ${displayTxStatus(tx.status)}`}>{displayTxStatus(tx.status)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ─── WITHDRAWALS ───────────────────────────────────────────────────── */}
      {section === 'withdraws' && (
        <div className="adm-section">
          <div className="adm-sec-title">WITHDRAWALS ({allTx.filter(t=>t.type==='withdraw').length})</div>
          {/* Status summary */}
          {allTx.filter(t=>t.type==='withdraw').length > 0 && (
            <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
              {['pending','processing','sent','completed','failed'].map(s => {
                const count = allTx.filter(t=>t.type==='withdraw'&&t.status===s).length
                if (!count) return null
                const colors = { pending:'#f5a623', processing:'#3d9be9', sent:'#8b5cf6', completed:'#4cd964', failed:'#ff3b30' }
                return (
                  <div key={s} style={{ background:'var(--card)', borderRadius:8, padding:'4px 10px', fontSize:12, color:colors[s]||'var(--muted)', fontWeight:600, border:`1px solid ${colors[s]}33` }}>
                    {s}: {count}
                  </div>
                )
              })}
            </div>
          )}
          {allTx.filter(t=>t.type==='withdraw').length === 0 && <div className="adm-empty">No withdrawals.</div>}
          {allTxSorted.filter(t=>t.type==='withdraw').map(tx => {
            const retrying = retryingWithdrawIds.has(tx.id)
            const showRetry = ['pending', 'processing'].includes(tx.status) || retrying

            return (
            <div key={tx.id} className="adm-tx-row">
              <div className="atr-ico withdraw"><AdminTxIcon type="withdraw" /></div>
              <div className="atr-left">
                <div className="atr-label">
                  {(() => {
                    const u = allUsers.find(u => Number(u.id)===Number(tx.userId))
                    return u ? <><strong>@{u.username||u.firstName||'—'}</strong> <span style={{color:'var(--muted)',fontSize:11}}>#{tx.userId}</span></> : `User #${tx.userId}`
                  })()}
                  <span style={{marginLeft:6, color:'var(--red)', fontWeight:700}}> · {Math.abs(tx.amount)} TON</span>
                </div>
                {tx.toWallet && (
                  <div className="atr-date" style={{ fontSize:11, marginTop:2, color:'var(--blue)', fontFamily:'monospace' }}>
                    <Send size={16} color="#0098EA" /> {shortWallet(tx.toWallet)}
                  </div>
                )}
                <div className="admin-history-label">{tx.label}</div>
                <div className="admin-history-meta">
                  <span>{fmtDate(tx.createdAt)}</span>
                  <CopyIdChip label={shortCode(tx.id)} value={tx.id} />
                </div>
                {tx.failReason && (
                  <div className="atr-date" style={{ fontSize:11, marginTop:2, color:'var(--red)' }}>
                    {tx.failReason}
                  </div>
                )}
              </div>
              <div className="withdraw-row-actions">
                {showRetry && (
                  <button
                    className={`adm-retry-btn ${retrying ? 'loading' : ''}`}
                    title={retrying ? 'Withdrawal is being sent' : 'Retry withdrawal'}
                    disabled={retrying}
                    onClick={() => handleRetryWithdrawal(tx.id)}
                  >
                    <RefreshCw className={retrying ? 'spin' : ''} size={13} />
                    <span>{retrying ? 'Sending' : 'Retry'}</span>
                  </button>
                )}
                <span className={`adm-status ${displayTxStatus(tx.status)}`}>{displayTxStatus(tx.status)}</span>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {/* ─── HISTORY ───────────────────────────────────────────────────────── */}
      {section === 'history' && (
        <div className="adm-section">
          <div className="adm-sec-title history-title">TRANSACTION HISTORY <span>{activeTxFilter === 'profit' ? filteredProfitGroups.length : filteredTx.length}</span></div>
          {/* Filter pills */}
          <div className="tx-filter-row">
            {TX_TYPE_FILTERS.map(f => (
              <button key={f.id} className={`tx-filter-pill ${activeTxFilter===f.id?'on':''} ${f.id}`} onClick={() => setTxFilter(f.id)}>
                {f.label}
                <span className="tx-filter-count">{txCounts[f.id] || 0}</span>
              </button>
            ))}
          </div>
          {filteredTx.length === 0 && <div className="adm-empty">No transactions</div>}
          <div className="admin-history-list">
          {activeTxFilter === 'profit' && filteredProfitGroups.map(group => {
            const opened = !!expandedProfitIds[group.key]
            const planName = getProfitPlanName(group.items)
            return (
              <div key={`admin-profit-${group.key}`} className={`admin-profit-group ${opened ? 'open' : ''} ${group.capitalRelease ? 'capital-settled' : ''}`}>
                <button
                  type="button"
                  className="adm-tx-row admin-history-row profit admin-profit-head"
                  onClick={() => setExpandedProfitIds(p => ({ ...p, [group.key]: !p[group.key] }))}
                >
                  <div className="atr-ico profit">{opened ? <X size={14} color="#FFD600" /> : <Coins size={15} color="#FFD600" />}</div>
                  <div className="atr-left">
                    <div className="atr-label">
                      <strong>{planName}</strong>
                      <span className={`admin-history-type ${group.capitalRelease ? 'release' : ''}`}>{group.capitalRelease ? 'released' : 'yield'}</span>
                    </div>
                  </div>
                  <div className="atr-right">
                    <span className="pos">+{formatTon(group.total)}</span>
                    <span className="adm-status completed">completed</span>
                  </div>
                </button>
                {opened && (
                  <div className="admin-profit-items">
                    {group.items.map(tx => (
                      <div key={tx.id} className="adm-tx-row admin-history-row profit admin-profit-child">
                        <div className="atr-ico profit"><AdminTxIcon type="profit" size={14} /></div>
                        <div className="atr-left">
                          <div className="atr-label">
                            {(() => {
                              const u = allUsers.find(u => Number(u.id)===Number(tx.userId))
                              return u ? <><strong>@{u.username||u.firstName||'—'}</strong> <span style={{color:'var(--muted)',fontSize:11}}>#{tx.userId}</span></> : `User#${tx.userId}`
                            })()}
                          </div>
                          <div className="admin-history-label">Yield payout</div>
                          <div className="admin-history-meta">
                            <span>{fmtDate(tx.createdAt)}</span>
                            <CopyIdChip label={shortCode(tx.id)} value={tx.id} />
                          </div>
                        </div>
                        <div className="atr-right">
                          <span className="pos">+{formatTon(Math.abs(tx.amount))}</span>
                          <span className={`adm-status ${displayTxStatus(tx.status)}`}>{displayTxStatus(tx.status)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {activeTxFilter !== 'profit' && filteredTx.map(tx => (
            <div key={tx.id} className={`adm-tx-row admin-history-row ${isMineTx(tx) ? 'mine' : tx.type} ${isCapitalReleaseTx(tx) ? 'capital-release' : ''}`}>
              <div className={`atr-ico ${isMineTx(tx) ? 'mine' : tx.type}`}><AdminTxIcon type={isMineTx(tx) ? 'mine' : tx.type} /></div>
              <div className="atr-left">
                <div className="atr-label">
                  {(() => {
                    const u = allUsers.find(u => Number(u.id)===Number(tx.userId))
                    return u ? <><strong>@{u.username||u.firstName||'—'}</strong> <span style={{color:'var(--muted)',fontSize:11}}>#{tx.userId}</span></> : `User#${tx.userId}`
                  })()}
                  <span className={`admin-history-type ${isCapitalReleaseTx(tx) ? 'release' : isMineTx(tx) ? 'mine' : ''}`}>{isCapitalReleaseTx(tx) ? 'release' : isMineTx(tx) ? mineResult(tx) : (tx.type === 'withdraw' ? 'WD' : tx.type)}</span>
                </div>
                <div className="admin-history-label">{adminTxTitle(tx)}</div>
                <div className="admin-history-meta">
                  <span>{fmtDate(tx.createdAt)}</span>
                  <CopyIdChip label={shortCode(tx.id)} value={tx.id} />
                </div>
              </div>
              <div className="atr-right">
                <span className={tx.amount>0?'pos':'neg'}>{tx.amount>0?'+':''}{formatTon(Math.abs(tx.amount))}</span>
                <span className={`adm-status ${displayTxStatus(tx.status)}`}>{displayTxStatus(tx.status)}</span>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {section === 'notifications' && (
        <NotificationPanel
          allUsers={allUsers}
          onSend={adminSendNotification}
          onLoad={adminGetNotifications}
          onDelete={adminDeleteNotification}
          onTestBot={adminTestBotNotification}
          showToast={showToast}
        />
      )}

      {/* ─── PLANS ─────────────────────────────────────────────────────────── */}
      {section === 'plans' && (
        <div className="adm-section">
          <div className="adm-sec-title">YIELD MARKETS</div>
          {plans.map(p => (
            <div key={p.id} className={`plan-edit-card ${p.color}`}>
              <div className="pec-header">
                <span className={`pec-badge ${p.color}`}>{p.tier}</span>
                <span className="pec-name">{p.name}</span>
                {p.hot && <span className="pec-hot">HOT</span>}
              </div>
              {editPlan === p.id ? (
                <PlanEditor plan={p} onSave={(u) => { adminUpdatePlan(p.id,u); setEditPlan(null) }} onCancel={() => setEditPlan(null)} />
              ) : (
                <>
                  <div className="pec-info">
                    <div className="pec-field"><span>Rate</span><span className={`pec-rate ${p.color}`}>{p.rate}% / interval</span></div>
                    <div className="pec-field"><span>Min</span><span>{p.min} TON</span></div>
                    <div className="pec-field"><span>Max</span><span>{p.max ? p.max+' TON' : '∞'}</span></div>
                    <div className="pec-field"><span>Duration</span><span>{p.duration} {p.durationUnit==='hours'?'hr':'day'}</span></div>
                    <div className="pec-field"><span>Profit every</span><span className="pec-interval">{
                      (() => {
                        const mins = p.profitIntervalMinutes || (p.profitIntervalMs ? p.profitIntervalMs/60000 : null) || (p.profitIntervalHours||24)*60
                        if (mins < 60) return `${mins} min`
                        const h = mins/60; return h >= 24 ? `${h/24} day` : `${h}hr`
                      })()
                    }</span></div>
                    <div className="pec-field"><span>Active days</span><span>{(p.activeDays||[1,2,3,4,5]).length} days/wk</span></div>
                  </div>
                  <div className="pec-days-row">
                    <span className="pec-days-label">Active days:</span>
                    <div className="pec-days">
                      {DAY_NAMES.map((d,i) => {
                        const active = (p.activeDays||[1,2,3,4,5]).includes(i)
                        return <span key={i} className={`pec-day-chip ${active?'on '+p.color:'off'} ${i===TODAY_DOW?'today':''}`}>{d}</span>
                      })}
                    </div>
                  </div>
                  <button className="pec-edit-btn" onClick={() => setEditPlan(p.id)}><SettingsIcon size={16} color="#0098EA" /> Edit Plan</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── SETTINGS ──────────────────────────────────────────────────────── */}
      {section === 'settings' && (
        <SettingsPanel config={config} onSave={adminSaveSettings} showToast={showToast} currentUserId={user?.id} />
      )}

      <div style={{height:8}}/>
    </div>
  )
}

// ─── User Detail Modal ────────────────────────────────────────────────────────
function UserDetail({ user: u, allTx, onClose, onEdit, onBan }) {
  const shortWalletLocal = (addr) => addr ? addr.slice(0,10)+'...'+addr.slice(-8) : '—'
  const fmtDateLocal = (ts) => {
    if (!ts) return '—'
    return new Date(Number(ts)).toLocaleString('en-US', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
  }
  const recentTx = [...allTx].sort((a,b) => (b.createdAt||0)-(a.createdAt||0)).slice(0,10)

  return (
    <div className="user-detail">
      <div className="ud-header">
        <div className="ud-avatar" style={{ background: u.status==='banned' ? 'var(--red)' : 'var(--blue)' }}>
          {(u.username||u.firstName||'U')[0].toUpperCase()}
        </div>
        <div className="ud-title">
          <div className="ud-name">{u.firstName || '@'+u.username}</div>
          <div className="ud-sub">@{u.username} · ID #{u.id}</div>
        </div>
        <span className={`user-status-badge ${u.status}`}>{u.status}</span>
      </div>

      <div className="ud-info-grid">
        <div className="ud-info-row"><span className="ud-lbl">First Name</span><span>{u.firstName||'—'}</span></div>
        <div className="ud-info-row"><span className="ud-lbl">Username</span><span>@{u.username||'—'}</span></div>
        <div className="ud-info-row"><span className="ud-lbl">Joined</span><span>{u.joinDate ? new Date(u.joinDate).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</span></div>
        <div className="ud-info-row"><span className="ud-lbl">Wallet</span><span style={{fontFamily:'monospace',fontSize:11,color:'var(--blue)'}}>{shortWalletLocal(u.walletAddr)}</span></div>
        {u.walletAddr && (
          <div className="ud-info-row">
            <span className="ud-lbl"></span>
            <span style={{fontFamily:'monospace',fontSize:9,color:'var(--muted)',wordBreak:'break-all'}}>{u.walletAddr}</span>
          </div>
        )}
      </div>

      <div className="ud-stats-grid">
        <div className="ud-stat"><div className="ud-stat-val">{(u.balance||0).toFixed(2)}</div><div className="ud-stat-lbl">Balance (TON)</div></div>
        <div className="ud-stat"><div className="ud-stat-val" style={{color:'var(--green)'}}>{(+u.totalDeposit||0).toFixed(2)}</div><div className="ud-stat-lbl">Total Deposited</div></div>
        <div className="ud-stat"><div className="ud-stat-val" style={{color:'var(--red)'}}>{(+u.totalWithdraw||0).toFixed(2)}</div><div className="ud-stat-lbl">Total Withdrawn</div></div>
        <div className="ud-stat"><div className="ud-stat-val" style={{color:'var(--green)'}}>{(+u.totalProfit||0).toFixed(2)}</div><div className="ud-stat-lbl">Total Profit</div></div>
        <div className="ud-stat"><div className="ud-stat-val" style={{color:'var(--gold)'}}>{(+u.todayProfit||0).toFixed(2)}</div><div className="ud-stat-lbl">Today Profit</div></div>
        <div className="ud-stat"><div className="ud-stat-val">{u.activeInvestments||0}</div><div className="ud-stat-lbl">Active Inv</div></div>
        <div className="ud-stat"><div className="ud-stat-val" style={{color:'var(--blue)'}}>{u.referralFriends||0}</div><div className="ud-stat-lbl">Referrals</div></div>
        <div className="ud-stat"><div className="ud-stat-val" style={{color:'var(--purple)'}}>{(+u.referralDepositVolume||0).toFixed(2)}</div><div className="ud-stat-lbl">Ref Deposit Volume</div></div>
        <div className="ud-stat"><div className="ud-stat-val">{u.depositCount||0}</div><div className="ud-stat-lbl">Deposits</div></div>
        <div className="ud-stat"><div className="ud-stat-val">{u.withdrawCount||0}</div><div className="ud-stat-lbl">Withdrawals</div></div>
      </div>

      {(u.referralCommission||0) > 0 && (
        <div className="ud-ref-earned">
          <Coins size={16} color="#FFD600" /> Referral commission earned: <strong>{(+u.referralCommission).toFixed(2)} TON</strong> · referred deposits: <strong>{(+u.referralDepositVolume||0).toFixed(2)} TON</strong>
        </div>
      )}
      {u.pendingWithdraw > 0 && (
        <div className="ud-pending-warn">
          <Clock size={16} color="#FFD600" /> Pending withdrawal: <strong>{u.pendingWithdraw.toFixed(2)} TON</strong>
        </div>
      )}

      {/* Recent transactions */}
      {recentTx.length > 0 && (
        <div className="ud-tx-section">
          <div className="ud-tx-title">Recent Transactions ({allTx.length})</div>
          {recentTx.map(tx => (
            <div key={tx.id} className="adm-tx-row" style={{padding:'6px 0'}}>
              <div className={`atr-ico ${tx.type}`}><AdminTxIcon type={tx.type} size={16} /></div>
              <div className="atr-left">
                <div className="atr-label" style={{fontSize:12}}>{tx.label}</div>
                <div className="atr-date">{fmtDateLocal(tx.createdAt)}</div>
              </div>
              <div className="atr-right">
                <span className={tx.amount>0?'pos':'neg'} style={{fontSize:13}}>{tx.amount>0?'+':''}{(+tx.amount).toFixed(2)}</span>
                <span className={`adm-status ${displayTxStatus(tx.status)}`}>{displayTxStatus(tx.status)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ud-actions">
        <button className="uc-edit-btn" onClick={onEdit}><SettingsIcon size={16} color="#0098EA" /> Edit User</button>
        <button className="ban-btn delete" onClick={onBan}>
          <Trash2 size={16} color="#EF4444" /> Delete User
        </button>
        <button className="ud-close-btn" onClick={onClose}><X size={16} color="#FFFFFF" /> Close</button>
      </div>
    </div>
  )
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function NotificationPanel({ allUsers, onSend, onLoad, onDelete, onTestBot, showToast }) {
  const [audience, setAudience] = useState('all')
  const [userId, setUserId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(false)

  const loadNotifications = async () => {
    setLoading(true)
    const rows = await onLoad()
    setNotifications(rows)
    setLoading(false)
  }

  useEffect(() => {
    loadNotifications()
  }, []) // eslint-disable-line

  const handleSend = async () => {
    if (audience === 'user' && !userId) {
      showToast('Select a user or enter Telegram ID','err')
      return
    }
    setSending(true)
    const ok = await onSend({ title, body, audience, userId })
    setSending(false)
    if (ok) {
      setTitle('')
      setBody('')
      setUserId('')
      loadNotifications()
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this notification?')) return
    const ok = await onDelete(id)
    if (ok) setNotifications(prev => prev.filter(n => n.id !== id))
  }

  return (
    <div className="adm-section notify-panel">
      <div className="adm-sec-title">SEND NOTIFICATION</div>
      <div className="settings-info">Users receive this in the Mini App and through the Telegram bot.</div>

      <div className="notify-toggle">
        <button className={audience==='all'?'on':''} onClick={() => setAudience('all')}>All users</button>
        <button className={audience==='user'?'on':''} onClick={() => setAudience('user')}>One user</button>
      </div>

      {audience === 'user' && (
        <div className="setting-group">
          <div className="sg-label">Target user</div>
          <input
            className="sg-input"
            list="notify-users"
            value={userId}
            onChange={e=>setUserId(e.target.value.replace(/\D/g,''))}
            placeholder="Telegram user ID"
          />
          <datalist id="notify-users">
            {allUsers.map(u => (
              <option key={u.id} value={u.id}>{u.username || u.firstName || `User ${u.id}`}</option>
            ))}
          </datalist>
        </div>
      )}

      <div className="setting-group">
        <div className="sg-label">Title</div>
        <input className="sg-input" value={title} onChange={e=>setTitle(e.target.value)} maxLength={80} placeholder="System update" />
      </div>

      <div className="setting-group">
        <div className="sg-label">Message</div>
        <textarea className="sg-input notify-textarea" value={body} onChange={e=>setBody(e.target.value)} maxLength={500} placeholder="Write the notification content..." />
      </div>

      <button className="sg-save-btn" onClick={handleSend} disabled={sending}>
        {sending ? 'SENDING...' : <><Send size={16} color="#FFFFFF" /> SEND NOTIFICATION</>}
      </button>
      <button className="sg-save-btn ghost" onClick={onTestBot} disabled={sending}>
        <Bot size={16} color="#0098EA" /> TEST BOT MESSAGE
      </button>

      <div className="notify-history">
        <div className="notify-history-head">
          <div className="adm-sec-title">OLD NOTIFICATIONS</div>
          <button className="adm-refresh-btn" onClick={loadNotifications} title="Refresh"><RefreshCw size={16} color="#0098EA" /></button>
        </div>
        {loading && <div className="adm-empty">Loading notifications...</div>}
        {!loading && notifications.length === 0 && <div className="adm-empty">No notifications yet</div>}
        {!loading && notifications.map(n => (
          <div key={n.id} className="notify-admin-row">
            <div className="notify-admin-main">
              <div className="notify-admin-title">{n.title}</div>
              <div className="notify-admin-body">{n.body}</div>
              <div className="notify-admin-meta">
                {n.audience === 'all' ? 'All users' : `User #${n.userId}`} · {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
            <button className="notify-delete-btn" onClick={() => handleDelete(n.id)}><X size={16} color="#EF4444" /> Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsPanel({ config, onSave, showToast, currentUserId }) {
  const [adminWalletTestnet, setAdminWalletTestnet] = useState(config.adminWalletTestnet || config.adminWallet || '')
  const [adminWalletMainnet, setAdminWalletMainnet] = useState(config.adminWalletMainnet || '')
  const [adminIds,     setAdminIds]     = useState(
    Array.isArray(config.adminIds) ? config.adminIds.join(', ') : config.adminIds || String(currentUserId||'')
  )
  const [botUsername,  setBotUsername]  = useState(config.botUsername  || '')
  const [withdrawalWebhookUrl, setWithdrawalWebhookUrl] = useState(config.withdrawalWebhookUrl || '')
  const [withdrawalWebhookSecret, setWithdrawalWebhookSecret] = useState(config.withdrawalWebhookSecret || '')
  const [referralRate, setReferralRate] = useState(config.referralRate || 5)
  const [minWithdraw,  setMinWithdraw]  = useState(config.minWithdraw  || 5)
  const [withdrawReferralGateEnabled, setWithdrawReferralGateEnabled] = useState(!!config.withdrawReferralGateEnabled)
  const [withdrawMinReferrals, setWithdrawMinReferrals] = useState(config.withdrawMinReferrals ?? 3)
  const [mineEnabled, setMineEnabled] = useState(config.mineEnabled ?? true)
  const [mineMinBet, setMineMinBet] = useState(config.mineMinBet ?? 1)
  const [mineFeeRate, setMineFeeRate] = useState(config.mineFeeRate ?? 5)
  const [mineCreatorWinRate, setMineCreatorWinRate] = useState(config.mineCreatorWinRate ?? 30)
  const [mineSlots, setMineSlots] = useState(config.mineSlots ?? 5)
  const [tonNetwork,   setTonNetwork]   = useState(config.tonNetwork   || 'testnet')
  const [showNetConfirm, setShowNetConfirm] = useState(false)
  const [pendingNetwork, setPendingNetwork] = useState(null)

  useEffect(() => {
    setAdminWalletTestnet(config.adminWalletTestnet || config.adminWallet || '')
    setAdminWalletMainnet(config.adminWalletMainnet || '')
    setAdminIds(Array.isArray(config.adminIds) ? config.adminIds.join(', ') : config.adminIds || String(currentUserId||''))
    setBotUsername(config.botUsername || '')
    setWithdrawalWebhookUrl(config.withdrawalWebhookUrl || '')
    setWithdrawalWebhookSecret(config.withdrawalWebhookSecret || '')
    setReferralRate(config.referralRate || 5)
    setMinWithdraw(config.minWithdraw || 5)
    setWithdrawReferralGateEnabled(!!config.withdrawReferralGateEnabled)
    setWithdrawMinReferrals(config.withdrawMinReferrals ?? 3)
    setMineEnabled(config.mineEnabled ?? true)
    setMineMinBet(config.mineMinBet ?? 1)
    setMineFeeRate(config.mineFeeRate ?? 5)
    setMineCreatorWinRate(config.mineCreatorWinRate ?? 30)
    setMineSlots(config.mineSlots ?? 5)
    setTonNetwork(config.tonNetwork || 'testnet')
  }, [config, currentUserId])

  const handleNetworkSwitch = (net) => {
    if (net === tonNetwork) return
    setPendingNetwork(net)
    setShowNetConfirm(true)
  }

  const handleSave = () => {
    const parsedIds = adminIds.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean).map(Number).filter(n=>!isNaN(n)&&n>0)
    const activeAdminWallet = tonNetwork === 'mainnet' ? adminWalletMainnet.trim() : adminWalletTestnet.trim()
    const cleanWebhookUrl = withdrawalWebhookUrl.trim()
    if (!activeAdminWallet) { showToast(`Admin ${tonNetwork} wallet cannot be empty`,'err'); return }
    if (parsedIds.length === 0) { showToast('Add at least one Admin Telegram ID','err'); return }
    if (cleanWebhookUrl && !/^https?:\/\//i.test(cleanWebhookUrl)) { showToast('Webhook URL must start with http:// or https://','err'); return }
    const cleanMineMinBet = Math.max(0.001, Number(mineMinBet) || 0.001)
    const cleanMineFeeRate = Math.min(50, Math.max(0, Number(mineFeeRate) || 0))
    const cleanMineCreatorWinRate = Math.min(100, Math.max(0, Number(mineCreatorWinRate) || 0))
    const cleanMineSlots = Math.min(20, Math.max(1, Math.trunc(Number(mineSlots) || 5)))
    onSave({
      adminWallet: activeAdminWallet,
      adminWalletTestnet: adminWalletTestnet.trim(),
      adminWalletMainnet: adminWalletMainnet.trim(),
      adminIds: parsedIds,
      botUsername: botUsername.trim(),
      withdrawalWebhookUrl: cleanWebhookUrl,
      withdrawalWebhookSecret: withdrawalWebhookSecret.trim(),
      referralRate: +referralRate,
      minWithdraw: +minWithdraw,
      withdrawReferralGateEnabled,
      withdrawMinReferrals: Math.max(0, Number(withdrawMinReferrals) || 0),
      mineEnabled: !!mineEnabled,
      mineMinBet: cleanMineMinBet,
      mineFeeRate: cleanMineFeeRate,
      mineCreatorWinRate: cleanMineCreatorWinRate,
      mineSlots: cleanMineSlots,
      tonNetwork,
    })
  }

  const cleanBotUsername = botUsername.trim().replace(/^@/, '')
  const refLink = cleanBotUsername ? `https://t.me/${cleanBotUsername}?startapp=${currentUserId}` : '(enter bot username to preview)'

  return (
    <div className="adm-section settings-panel">
      <div className="adm-sec-title"><SettingsIcon size={18} color="#0098EA" /> SYSTEM CONFIGURATION</div>
      <div className="settings-info">Settings sync through Supabase Realtime across admin devices.</div>

      <div className="setting-group">
        <div className="sg-label"><Wallet size={16} color="#0098EA" />Admin Wallet Testnet</div>
        <div className="sg-desc">Receives testnet deposits. Usually starts with kQ or 0Q.</div>
        <input className="sg-input" type="text" value={adminWalletTestnet} onChange={e=>setAdminWalletTestnet(e.target.value)} placeholder="0Q..." spellCheck={false}/>
      </div>

      <div className="setting-group">
        <div className="sg-label"><Wallet size={16} color="#0098EA" />Admin Wallet Mainnet</div>
        <div className="sg-desc">Receives real TON deposits. Usually starts with UQ or EQ.</div>
        <input className="sg-input" type="text" value={adminWalletMainnet} onChange={e=>setAdminWalletMainnet(e.target.value)} placeholder="UQ..." spellCheck={false}/>
      </div>

      <div className="setting-group">
        <div className="sg-label"><IdCard size={16} color="#0098EA" />Admin Telegram IDs</div>
        <div className="sg-desc">Comma-separated Telegram user IDs. Get yours from <strong>@userinfobot</strong>.</div>
        <input className="sg-input" type="text" value={adminIds} onChange={e=>setAdminIds(e.target.value)} placeholder="123456789, 987654321"/>
        <div className="sg-hint">Current session ID: <strong>{currentUserId}</strong></div>
      </div>

      <div className="setting-group">
        <div className="sg-label"><Bot size={16} color="#0098EA" />Bot Username</div>
        <div className="sg-desc">Your bot's @username — used to generate referral links.</div>
        <div className="sg-input-prefix-wrap">
          <span className="sg-prefix">@</span>
          <input className="sg-input with-prefix" type="text" value={botUsername} onChange={e=>setBotUsername(e.target.value.replace('@',''))} placeholder="YourBotName"/>
        </div>
        <div className="sg-ref-preview">
          <span className="sg-ref-label">Ref link preview:</span>
          <span className="sg-ref-url">{refLink}</span>
        </div>
      </div>

      <div className="setting-group">
        <div className="sg-label"><Coins size={16} color="#FFD600" />Referral Commission (%)</div>
        <div className="sg-slider-wrap">
          <input type="range" min="1" max="30" step="0.5" value={referralRate} onChange={e=>setReferralRate(+e.target.value)} className="sg-slider"/>
          <div className="sg-slider-val">
            <span className="sg-rate-big">{referralRate}%</span>
            <span className="sg-rate-label">per referral deposit</span>
          </div>
        </div>
      </div>

      <div className="setting-group network-group">
        <div className="sg-label"><Globe2 size={16} color="#0098EA" />TON Network</div>
        <div className="network-toggle-wrap">
          <button className={`net-btn ${tonNetwork==='testnet'?'net-active testnet':'net-inactive'}`} onClick={() => handleNetworkSwitch('testnet')}><span className="net-dot"/>Testnet</button>
          <button className={`net-btn ${tonNetwork==='mainnet'?'net-active mainnet':'net-inactive'}`} onClick={() => handleNetworkSwitch('mainnet')}><span className="net-dot"/>Mainnet</button>
        </div>
        <div className={`network-badge ${tonNetwork}`}>{tonNetwork==='testnet'?'Currently on TESTNET':'Currently on MAINNET'}</div>
        {showNetConfirm && (
          <div className="net-confirm-box">
            <div className="net-confirm-title"><XCircle size={16} color="#FFD600" /> Switch to {pendingNetwork}?</div>
            <div className="net-confirm-desc">{pendingNetwork==='mainnet'?'Mainnet uses real TON. Real funds.':'Testnet uses test TON only.'}</div>
            <div className="net-confirm-btns">
              <button className="net-confirm-yes" onClick={() => { setTonNetwork(pendingNetwork); setShowNetConfirm(false); setPendingNetwork(null) }}>Yes, Switch</button>
              <button className="net-confirm-no"  onClick={() => { setShowNetConfirm(false); setPendingNetwork(null) }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="setting-group">
        <div className="sg-label"><Download size={16} color="#0098EA" />Minimum Withdrawal (TON)</div>
        <div className="sg-row">
          <input className="sg-input sg-input-sm" type="number" min="1" step="0.5" value={minWithdraw} onChange={e=>setMinWithdraw(+e.target.value)}/>
          <span className="sg-unit">TON</span>
        </div>
      </div>

      <div className="setting-group">
        <div className="sg-label"><Users size={16} color="#0098EA" />Withdrawal Unlock Rule</div>
        <div className="sg-desc">When enabled, users unlock withdrawals after inviting more users than this number.</div>
        <label className="sg-check-row">
          <input type="checkbox" checked={withdrawReferralGateEnabled} onChange={e=>setWithdrawReferralGateEnabled(e.target.checked)} />
          <span>Require referral unlock before withdrawals</span>
        </label>
        <div className="sg-row">
          <input
            className="sg-input sg-input-sm"
            type="number"
            min="0"
            step="1"
            value={withdrawMinReferrals}
            onChange={e=>setWithdrawMinReferrals(+e.target.value)}
            disabled={!withdrawReferralGateEnabled}
          />
          <span className="sg-unit">threshold</span>
        </div>
      </div>

      <div className="setting-group mine-admin-config">
        <div className="sg-label"><Bomb size={16} color="#FFD600" />Mine Game</div>
        <div className="sg-desc">Openers need 1.2x room amount. Creator win % is the target chance across the full room; the server converts it per slot.</div>
        <label className="sg-check-row">
          <input type="checkbox" checked={mineEnabled} onChange={e=>setMineEnabled(e.target.checked)} />
          <span>Enable Mine page for users</span>
        </label>
        <div className="sg-row">
          <input className="sg-input sg-input-sm" type="number" min="1" max="20" step="1" value={mineSlots} onChange={e=>setMineSlots(+e.target.value)} />
          <span className="sg-unit">slots</span>
        </div>
        <div className="sg-row">
          <input className="sg-input sg-input-sm" type="number" min="0.001" step="0.001" value={mineMinBet} onChange={e=>setMineMinBet(+e.target.value)} />
          <span className="sg-unit">min TON</span>
        </div>
        <div className="sg-row">
          <input className="sg-input sg-input-sm" type="number" min="0" max="50" step="0.5" value={mineFeeRate} onChange={e=>setMineFeeRate(+e.target.value)} />
          <span className="sg-unit">fee rate %</span>
        </div>
        <div className="sg-row">
          <input className="sg-input sg-input-sm" type="number" min="0" max="100" step="0.5" value={mineCreatorWinRate} onChange={e=>setMineCreatorWinRate(+e.target.value)} />
          <span className="sg-unit">creator win %</span>
        </div>
      </div>

      <button className="sg-save-btn" onClick={handleSave}><Save size={16} color="#FFFFFF" /> SAVE CONFIGURATION</button>
    </div>
  )
}

// ─── User Editor ──────────────────────────────────────────────────────────────
function UserEditor({ user, onSave, onCancel }) {
  const [balance,       setBalance]       = useState(user.balance||0)
  const [totalDeposit,  setTotalDeposit]  = useState(user.totalDeposit||0)
  const [totalWithdraw, setTotalWithdraw] = useState(user.totalWithdraw||0)
  const [totalProfit,   setTotalProfit]   = useState(user.totalProfit||0)
  const [todayProfit,   setTodayProfit]   = useState(user.todayProfit||0)
  const [referrals,     setReferrals]     = useState(user.referrals||0)
  const [referralFriends, setReferralFriends] = useState(user.referralFriends||0)
  const [referralCommission, setReferralCommission] = useState(user.referralCommission||0)
  const [referralDepositVolume, setReferralDepositVolume] = useState(user.referralDepositVolume||0)
  return (
    <div className="plan-editor">
      <div className="adm-sec-title" style={{marginBottom:12}}>
        EDIT USER · {user.firstName && <span>{user.firstName} </span>}<span style={{color:'var(--muted)'}}>@{user.username}</span>
        <span style={{color:'var(--muted)',fontSize:12,marginLeft:8}}>#{user.id}</span>
      </div>
      <div className="pe-row"><label>Balance</label><input type="number" value={balance} onChange={e=>setBalance(+e.target.value)} step="0.01"/></div>
      <div className="pe-row"><label>Total Deposited</label><input type="number" value={totalDeposit} onChange={e=>setTotalDeposit(+e.target.value)} step="0.01"/></div>
      <div className="pe-row"><label>Total Withdrawn</label><input type="number" value={totalWithdraw} onChange={e=>setTotalWithdraw(+e.target.value)} step="0.01"/></div>
      <div className="pe-row"><label>Total Profit</label><input type="number" value={totalProfit} onChange={e=>setTotalProfit(+e.target.value)} step="0.01"/></div>
      <div className="pe-row"><label>Today's Profit</label><input type="number" value={todayProfit} onChange={e=>setTodayProfit(+e.target.value)} step="0.01"/></div>
      <div className="pe-row"><label>Referrals</label><input type="number" value={referrals} onChange={e=>setReferrals(+e.target.value)}/></div>
      <div className="pe-row"><label>Referral Friends</label><input type="number" value={referralFriends} onChange={e=>setReferralFriends(+e.target.value)}/></div>
      <div className="pe-row"><label>Referral Earned</label><input type="number" value={referralCommission} onChange={e=>setReferralCommission(+e.target.value)} step="0.01"/></div>
      <div className="pe-row"><label>Ref Deposit Volume</label><input type="number" value={referralDepositVolume} onChange={e=>setReferralDepositVolume(+e.target.value)} step="0.01"/></div>
      <div className="pe-btns">
        <button className="pe-save" onClick={() => onSave({ balance, totalDeposit, totalWithdraw, totalProfit, todayProfit, referrals, referralFriends, referralCommission, referralDepositVolume })}><Save size={16} color="#FFFFFF" /> SAVE CHANGES</button>
        <button className="pe-cancel" onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  )
}

// ─── Plan Editor ──────────────────────────────────────────────────────────────
function PlanEditor({ plan, onSave, onCancel }) {
  const [rate, setRate] = useState(plan.rate)
  const [min, setMin] = useState(plan.min)
  const [max, setMax] = useState(plan.max||'')
  const [duration, setDuration] = useState(plan.duration)
  const [durationUnit, setDurationUnit] = useState(plan.durationUnit||'days')
  const [hot, setHot] = useState(plan.hot)
  const resolveCurrentMinutes = () => {
    if (plan.profitIntervalMinutes) return plan.profitIntervalMinutes
    if (plan.profitIntervalMs) return plan.profitIntervalMs/60_000
    return (plan.profitIntervalHours||24)*60
  }
  const [profitIntervalMinutes, setProfitIntervalMinutes] = useState(resolveCurrentMinutes)
  const [activeDays, setActiveDays] = useState(plan.activeDays||[1,2,3,4,5])
  const intervalOptions = [
    {value:5,label:'5 min (test)'},{value:15,label:'15 min (test)'},{value:30,label:'30 min (test)'},
    {value:60,label:'1 hr (test)'},{value:120,label:'2 hr (test)'},{value:180,label:'3 hr'},
    {value:360,label:'6 hr'},{value:720,label:'12 hr'},{value:1440,label:'24 hr (1 day)'},{value:2880,label:'48 hr (2 days)'},
  ]
  const toggleDay = (dow) => setActiveDays(prev => prev.includes(dow) ? prev.filter(d=>d!==dow) : [...prev,dow].sort())
  return (
    <div className="plan-editor">
      <div className="pe-row"><label>Rate (%/interval)</label><input type="number" value={rate} onChange={e=>setRate(+e.target.value)} step="0.1"/></div>
      <div className="pe-row"><label>Min (TON)</label><input type="number" value={min} onChange={e=>setMin(+e.target.value)}/></div>
      <div className="pe-row"><label>Max (TON)</label><input type="number" value={max} onChange={e=>setMax(e.target.value)} placeholder="∞"/></div>
      <div className="pe-row">
        <label>Duration</label>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <input type="number" value={duration} onChange={e=>setDuration(+e.target.value)} style={{flex:1}}/>
          <select value={durationUnit} onChange={e=>setDurationUnit(e.target.value)} className="pe-select" style={{flex:'none',width:'auto'}}>
            <option value="days">days</option>
            <option value="hours">hr</option>
          </select>
        </div>
      </div>
      <div className="pe-row">
        <label>Profit every</label>
        <select value={profitIntervalMinutes} onChange={e=>setProfitIntervalMinutes(+e.target.value)} className="pe-select">
          {intervalOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>
      <div className="pe-days-section">
        <label className="pe-days-label">Active days <span className="pe-days-hint">(unchecked = paused)</span></label>
        <div className="pe-days-grid">
          {DAY_NAMES.map((d,i) => (
            <button key={i} type="button" className={`pe-day-btn ${activeDays.includes(i)?'on':'off'} ${i===TODAY_DOW?'today':''}`} onClick={()=>toggleDay(i)}>
              {d}{i===TODAY_DOW&&<span className="pe-today-dot">•</span>}
            </button>
          ))}
        </div>
        {activeDays.length===0 && <span className="pe-warn"><XCircle size={16} color="#EF4444" /> Select at least 1 day</span>}
      </div>
      <div className="pe-row"><label>HOT badge</label><input type="checkbox" checked={hot} onChange={e=>setHot(e.target.checked)} style={{width:'auto',height:'auto',cursor:'pointer'}}/></div>
      <div className="pe-btns">
        <button className="pe-save" disabled={activeDays.length===0} onClick={() => {
          if (activeDays.length===0) return
          const durMs = durationUnit==='hours' ? duration*3_600_000 : duration*86_400_000
          onSave({ rate, min, max:max?+max:null, duration, durationUnit, durationMs:durMs, profitIntervalMinutes, profitIntervalMs:profitIntervalMinutes*60_000, activeDays, hot })
        }}><Save size={16} color="#FFFFFF" /> SAVE CHANGES</button>
        <button className="pe-cancel" onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  )
}
