import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, LogOut, Shield, Users, Wallet } from 'lucide-react'
import './ProfilePage.css'

const formatTon = (value, signed = false) => {
  const n = Number(value) || 0
  const sign = signed && n > 0 ? '+' : ''
  return `${sign}${n.toFixed(3)} TON`
}
const memberSince = (joinDate) => {
  const d = joinDate ? new Date(joinDate) : new Date()
  return d.toLocaleDateString('en-GB', { month:'long', year:'numeric' })
}

// ─── Disconnect Wallet Modal ──────────────────────────────────────────────────
function DisconnectModal({ walletAddr, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false)
  const short = walletAddr ? walletAddr.slice(0,6)+'...'+walletAddr.slice(-4) : 'UQBx...kX9f'

  const handle = () => {
    setLoading(true)
    onConfirm()
    setLoading(false)
    onClose()
  }

  return (
    <div className="overlay" onClick={e => e.target.classList.contains('overlay') && onClose()}>
      <div className="sheet">
        <div className="handle"/>
        <h2 className="sheet-title">DISCONNECT WALLET</h2>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{marginBottom:12}}><Wallet size={32} color="#0098EA" /></div>
          <div style={{color:'var(--muted)',fontSize:13,lineHeight:1.6}}>
            You are about to disconnect your TON wallet from TONYield.<br/>
            You can reconnect anytime to open new positions.
          </div>
        </div>
        <div style={{
          background:'var(--card2)',borderRadius:12,padding:'12px 16px',
          marginBottom:20,border:'1px solid var(--border)'
        }}>
          <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>CONNECTED WALLET</div>
          <div style={{fontSize:14,color:'var(--blue)',fontFamily:'monospace'}}>{short}</div>
        </div>
        <div className="warning-bar" style={{marginBottom:20}}>
          Active positions remain open. New wallet deposits will require reconnection.
        </div>
        <button className="sheet-btn main" style={{background:'var(--red)',color:'#fff'}}
          onClick={handle} disabled={loading}>
          {loading ? 'DISCONNECTING...' : <><LogOut size={16} color="#FFFFFF" /> DISCONNECT WALLET</>}
        </button>
        <button className="sheet-btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

// ─── ProfilePage ──────────────────────────────────────────────────────────────
export default function ProfilePage({ user, referral, referralDetails = [], config, showToast, setIsAdmin, isAdmin, walletConnected, disconnectWallet, connectWallet }) {
  const [showDisconnect, setShowDisconnect] = useState(false)
  const [showReferralPage, setShowReferralPage] = useState(false)

  const refRate = config?.referralRate ?? 5
  const totalProfit = Number(user?.todayProfit) || 0

  const copyRef = () => {
    // referral.code is already a full https://t.me/... link when botUsername is configured
    // fallback: if bot not configured, show the raw Telegram ID for manual sharing
    const link = referral.code?.startsWith('http')
      ? referral.code
      : referral.code  // just the Telegram ID — user can share manually
    navigator.clipboard?.writeText(link).catch(() => {})
    showToast('Copied to clipboard.')
  }

  const handleDisconnect = () => {
    if (disconnectWallet) disconnectWallet()
    showToast('Wallet disconnected.')
  }

  const menu = [
    { Icon: Users, iconColor: '#0098EA', color: 'blue', label: 'TEAM', sub: `${referral?.friends || 0} members - ${formatTon(referral?.commission || 0)}`, action: () => setShowReferralPage(true) },
    walletConnected
      ? { Icon: LogOut, iconColor: '#EF4444', color: 'red', label: 'DISCONNECT WALLET', sub: 'Unlink TON Connect', danger: true, action: () => setShowDisconnect(true) }
      : { Icon: Wallet, iconColor: '#0098EA', color: 'blue', label: 'CONNECT WALLET', sub: 'Link your TON wallet', action: () => connectWallet && connectWallet() },
  ]

  if (showReferralPage) {
    return (
      <div className="page page-enter">
        <div style={{height:18}}/>

        <div className="ref-page-header">
          <button className="ref-back-btn" onClick={() => setShowReferralPage(false)} aria-label="Back to account">
            <ChevronLeft size={18} color="#FFFFFF" />
          </button>
          <div>
            <div className="ref-page-title">TEAM</div>
            <div className="ref-page-sub">ID {user?.id}</div>
          </div>
        </div>

        <div className="ref-full card">
          <div className="rf-header">
            <div>
              <div className="rf-title">REFERRAL PROGRAM</div>
              <div className="rf-sub">Earn {refRate}% commission on every deposit made by your referrals.</div>
            </div>
            <div className="rf-badge">{refRate}%</div>
          </div>
          <div className="rf-code-box">
            <span className="rf-code">{referral?.code}</span>
            <button className="copy-btn" onClick={copyRef}><Copy size={16} color="#FFFFFF" /> Copy</button>
          </div>
          <div className="rf-stats">
            <div className="rfs-item">
              <div className="rfs-val">{referral?.friends}</div>
              <div className="rfs-label">Referred Users</div>
            </div>
            <div className="rfs-item">
              <div className="rfs-val">{formatTon(referral?.commission)}</div>
              <div className="rfs-label">Referral Income</div>
            </div>
            <div className="rfs-item">
              <div className="rfs-val">{formatTon(referral?.depositVolume || 0)}</div>
              <div className="rfs-label">Referred Volume</div>
            </div>
          </div>
        </div>

        <div className="ref-detail card">
          <div className="rd-header">
            <div>
              <div className="rd-title">TEAM MEMBERS</div>
              <div className="rd-sub">Deposit volume and income generated by each member.</div>
            </div>
            <div className="rd-count">{referralDetails.length}</div>
          </div>

          {referralDetails.length === 0 ? (
            <div className="rd-empty">
              <Users size={20} color="#0098EA" />
              <div>
                <div className="rd-empty-title">NO REFERRALS YET</div>
                <div className="rd-empty-sub">Team members will appear here after opening your referral link.</div>
              </div>
            </div>
          ) : (
            <div className="rd-list">
              {referralDetails.map(item => (
                <div key={item.id} className="rd-row">
                  <div className="rd-user">
                    <div className="rd-avatar">{(item.username || item.firstName || 'U')[0].toUpperCase()}</div>
                    <div className="rd-user-main">
                      <div className="rd-name">{item.name}</div>
                      <div className="rd-id">ID {item.id}</div>
                    </div>
                  </div>
                  <div className="rd-metrics">
                    <div className="rd-metric">
                      <span>Total Deposit</span>
                      <strong>{formatTon(item.totalDeposit)}</strong>
                    </div>
                    <div className="rd-metric">
                      <span>Referral Income</span>
                      <strong className="rd-income">{formatTon(item.referralIncome)}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{height:8}}/>
      </div>
    )
  }

  return (
    <div className="page page-enter">
      <div style={{height:18}}/>

      <div className="prof-hero card">
        <div className="prof-hero-glow"/>
        <div className="avatar-svg-wrap">
          <svg viewBox="0 0 100 100" width="100" height="100" style={{overflow:'visible'}}>
            <defs>
              <filter id="profRingGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="2.5" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <filter id="profRingGlowOuter" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="4" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            {/* Track rings */}
            <circle cx="50" cy="50" r="46" fill="none" stroke="#0d2a4a" strokeWidth="2"/>
            <circle cx="50" cy="50" r="39" fill="none" stroke="#0d2a4a" strokeWidth="2"/>
            <circle cx="50" cy="50" r="32" fill="none" stroke="#0d2a4a" strokeWidth="1.5"/>
            {/* Dim backdrop full rings */}
            <circle cx="50" cy="50" r="46" fill="none" stroke="#00d4ff" strokeWidth="2" opacity="0.06" strokeDasharray="289"/>
            <circle cx="50" cy="50" r="39" fill="none" stroke="#00aaff" strokeWidth="2" opacity="0.06" strokeDasharray="245"/>
            <circle cx="50" cy="50" r="32" fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.06" strokeDasharray="201"/>
            {/* Outer ring — cyan — spinning arc */}
            <circle cx="50" cy="50" r="46" fill="none" stroke="#00d4ff" strokeWidth="2.2"
              strokeDasharray="110 179" strokeLinecap="round" filter="url(#profRingGlowOuter)" opacity="0.95">
              <animateTransform attributeName="transform" type="rotate"
                from="0 50 50" to="360 50 50" dur="8s" repeatCount="indefinite"/>
            </circle>
            {/* Mid ring — electric blue — reverse */}
            <circle cx="50" cy="50" r="39" fill="none" stroke="#00aaff" strokeWidth="2"
              strokeDasharray="80 164" strokeLinecap="round" filter="url(#profRingGlow)" opacity="0.88">
              <animateTransform attributeName="transform" type="rotate"
                from="0 50 50" to="-360 50 50" dur="6s" repeatCount="indefinite"/>
            </circle>
            {/* Inner ring — bright cyan — fast spin */}
            <circle cx="50" cy="50" r="32" fill="none" stroke="#00eeff" strokeWidth="1.8"
              strokeDasharray="55 146" strokeLinecap="round" filter="url(#profRingGlow)" opacity="0.9">
              <animateTransform attributeName="transform" type="rotate"
                from="0 50 50" to="360 50 50" dur="3.5s" repeatCount="indefinite"/>
            </circle>
            {/* Ripple pulse */}
            <circle cx="50" cy="50" r="46" fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0">
              <animate attributeName="r" values="46;68;46" dur="3s" begin="0s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.4;0;0.4" dur="3s" begin="0s" repeatCount="indefinite"/>
            </circle>
            <circle cx="50" cy="50" r="46" fill="none" stroke="#00aaff" strokeWidth="1" opacity="0">
              <animate attributeName="r" values="46;68;46" dur="3s" begin="1.1s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.25;0;0.25" dur="3s" begin="1.1s" repeatCount="indefinite"/>
            </circle>
            {/* Avatar circle */}
            <circle cx="50" cy="50" r="26" fill="var(--s2)"/>
            <text x="50" y="57" textAnchor="middle"
              style={{fontSize:24,fontWeight:600,fill:'var(--text)',fontFamily:'var(--font-display)'}}>
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </text>
          </svg>
        </div>
        <div className="prof-name">@{user?.username || user?.firstName || 'user'}</div>
        <div className="prof-id">ID {user?.id}</div>
        <div className="prof-stats">
          <div className="ps-item">
            <div className="ps-val">{formatTon(user?.balance).replace(' TON','')}</div>
            <div className="ps-label">Portfolio Value</div>
          </div>
          <div className="ps-item">
            <div className="ps-val" style={{color:'var(--green)'}}>{formatTon(totalProfit).replace(' TON','')}</div>
            <div className="ps-label">Profit Earned</div>
          </div>
          <div className="ps-item">
            <div className="ps-val" style={{color:'var(--blue)'}}>{referral?.friends}</div>
            <div className="ps-label">Referred Users</div>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="admin-hint" onClick={() => setIsAdmin(true)}>
          <Shield size={16} color="#0098EA" /> Admin Panel · Tap to enter
        </div>
      )}

      <div className="ref-full card">
        <div className="rf-header">
          <div>
            <div className="rf-title">REFERRAL PROGRAM</div>
            <div className="rf-sub">Earn {refRate}% commission on every deposit made by your referrals.</div>
          </div>
          <div className="rf-badge">{refRate}%</div>
        </div>
        <div className="rf-code-box">
          <span className="rf-code">{referral?.code}</span>
          <button className="copy-btn" onClick={copyRef}><Copy size={16} color="#FFFFFF" /> Copy</button>
        </div>
        <div className="rf-stats">
          <div className="rfs-item">
            <div className="rfs-val">{referral?.friends}</div>
            <div className="rfs-label">Referred Users</div>
          </div>
          <div className="rfs-item">
            <div className="rfs-val">{formatTon(referral?.commission)}</div>
            <div className="rfs-label">Referral Income</div>
          </div>
          <div className="rfs-item">
            <div className="rfs-val">{formatTon(referral?.depositVolume || 0)}</div>
            <div className="rfs-label">Referred Volume</div>
          </div>
        </div>
      </div>

      <div className="menu-list card">
        {menu.map((item, i) => (
          <div key={i} className="menu-item" onClick={item.action}>
            <div className={`mi-icon ${item.color}`}><item.Icon size={18} color={item.iconColor} /></div>
            <div className="mi-info">
              <div className="mi-label" style={item.danger ? {color:'var(--red)'} : {}}>{item.label}</div>
              <div className="mi-sub">{item.sub}</div>
            </div>
            <div className="mi-right"><ChevronRight size={18} color="#94A3B8" /></div>
          </div>
        ))}
      </div>

      <div className="app-version">TONYield v2.0 · {new Date().getFullYear()}</div>
      <div style={{height:8}}/>

      {showDisconnect && (
        <DisconnectModal
          walletAddr={user?.walletAddr}
          onClose={() => setShowDisconnect(false)}
          onConfirm={handleDisconnect}
        />
      )}
    </div>
  )
}
