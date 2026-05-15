import React, { useState, useEffect } from 'react'
import { CheckCircle2, Coins, Send, Wallet } from 'lucide-react'
import './Modal.css'

const colorMap = { gold: '#FFD600', blue: '#0098EA', purple: '#00C2FF' }
const formatTon = (value) => `${(Number(value) || 0).toFixed(3)} TON`
const formatPct = (value) => `${(Number(value) || 0).toFixed(1)}%`
const formatDuration = (plan) => {
  const n = Number(plan?.duration) || 0
  const unit = plan?.durationUnit === 'hours' ? 'hour' : 'day'
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}
const formatDistribution = (minutes) => `Every ${Number(minutes) || 0} min`

function detectPlan(plans, amount) {
  const amt = parseFloat(amount) || 0
  if (!amt) return null
  const eligible = plans.filter(p => amt >= p.min && (!p.max || amt <= p.max))
  if (eligible.length === 0) return null
  return eligible[eligible.length - 1]
}

export default function DepositModal({ plans, defaultPlan, onClose, showToast, onSubmit, walletConnected, onConnectWallet, userBalance }) {
  const [amount, setAmount] = useState(defaultPlan ? String(defaultPlan.min) : '')
  const [step, setStep]     = useState(walletConnected ? 'deposit' : 'connect')
  const [loading, setLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('wallet') // 'wallet' | 'balance'

  const autoPlan = detectPlan(plans, amount)
  const amt = parseFloat(amount) || 0
  const intervalMin = autoPlan?.profitIntervalMinutes || 1440
  const durationMs = autoPlan
    ? autoPlan.durationMs || (autoPlan.duration * (autoPlan.durationUnit === 'hours' ? 3_600_000 : 86_400_000))
    : 0
  const totalIntervals = autoPlan ? Math.floor(durationMs / (intervalMin * 60_000)) : 0
  const perInterval = autoPlan && amt ? (amt * autoPlan.rate / 100).toFixed(4) : null
  const hourly = perInterval ? (parseFloat(perInterval) * (60 / intervalMin)).toFixed(4) : null
  const totalReturn = perInterval ? (parseFloat(perInterval) * totalIntervals).toFixed(4) : null
  const amountValid = autoPlan && amt >= autoPlan.min && (!autoPlan.max || amt <= autoPlan.max)

  // If wallet connects while modal is open, advance to deposit step
  useEffect(() => {
    if (walletConnected && step === 'connect') setStep('deposit')
  }, [walletConnected])

  const handleConnectWallet = async () => {
    setLoading(true)
    try {
      await onConnectWallet()
      // step will update via useEffect once walletConnected flips
    } catch (e) {
      showToast('Network error - please retry.', 'err')
    }
    setLoading(false)
  }

  const handleConfirm = async () => {
    if (paymentMethod === 'wallet' && !walletConnected) { setStep('connect'); return }
    if (!amountValid) {
      showToast(autoPlan ? 'Amount exceeds strategy range.' : `Amount below minimum (${formatTon(plans[0]?.min || 10)}).`, 'err')
      return
    }
    if (paymentMethod === 'balance') {
      const bal = parseFloat(userBalance) || 0
      if (amt > bal) {
        showToast('Insufficient balance.', 'err')
        return
      }
    }
    setLoading(true)
    try {
      const ok = await onSubmit(autoPlan.id, amt, paymentMethod)
      if (ok !== false) onClose()
    } finally {
      setLoading(false)
    }
  }

  const planColor     = autoPlan ? colorMap[autoPlan.color] : '#888'
  const planTextColor = autoPlan?.color === 'gold' ? '#080b12' : '#fff'

  return (
    <div className="overlay" onClick={e => e.target.classList.contains('overlay') && onClose()}>
      <div className="sheet">
        <div className="handle"/>

        {/* ── Step: Connect Wallet ── */}
        {step === 'connect' && (
          <div className="wallet-connect-wrap">
            <div className="wc-icon"><Wallet size={32} color="#0098EA" /></div>
            <h2 className="sheet-title" style={{marginTop:8}}>NEW POSITION</h2>
            <p className="wc-desc">
              Connect your TON wallet to open a position from an external wallet.
            </p>
            <div className="wc-features">
              <div className="wc-feat"><CheckCircle2 size={16} color="#FFD600" /> Secured by TON Connect.</div>
              <div className="wc-feat"><CheckCircle2 size={16} color="#FFD600" /> No private keys are stored.</div>
              <div className="wc-feat"><CheckCircle2 size={16} color="#FFD600" /> You confirm the transaction in your wallet.</div>
            </div>
            <button className={`sheet-btn main ${loading ? 'btn-loading' : ''}`} style={{background:'linear-gradient(135deg,#0098EA,#00C2FF)',color:'#fff',marginTop:24}}
              onClick={handleConnectWallet} disabled={loading}>
              {loading ? <><span className="spinner" /><span className="btn-loading-text">CONNECTING...</span></> : <><Wallet size={16} color="#FFFFFF" /> CONNECT WALLET</>}
            </button>
            <button className="sheet-btn ghost" onClick={onClose}>Cancel</button>
          </div>
        )}

        {/* ── Step: Deposit ── */}
        {step === 'deposit' && (
          <>
            <h2 className="sheet-title">NEW POSITION</h2>

            {/* Payment Method Toggle */}
            <div style={{display:'flex',gap:8,marginBottom:14}}>
              <button
                onClick={() => setPaymentMethod('wallet')}
                style={{
                  flex:1, padding:'9px 12px', borderRadius:10, border:'none', cursor:'pointer',
                  fontSize:13, fontWeight:600,
                  background: paymentMethod==='wallet' ? 'linear-gradient(135deg,#0098EA,#00C2FF)' : 'var(--s2)',
                  color: paymentMethod==='wallet' ? '#fff' : 'var(--muted)',
                  transition:'all 0.15s'
                }}>
                <Wallet size={16} color={paymentMethod === 'wallet' ? '#FFFFFF' : '#94A3B8'} /> TON Wallet
              </button>
              <button
                onClick={() => setPaymentMethod('balance')}
                style={{
                  flex:1, padding:'9px 12px', borderRadius:10, border:'none', cursor:'pointer',
                  fontSize:13, fontWeight:600,
                  background: paymentMethod==='balance' ? 'linear-gradient(135deg,#0098EA,#00C2FF)' : 'var(--s2)',
                  color: paymentMethod==='balance' ? '#fff' : 'var(--muted)',
                  transition:'all 0.15s'
                }}>
                <Coins size={16} color={paymentMethod === 'balance' ? '#FFFFFF' : '#94A3B8'} /> Account Balance
              </button>
            </div>

            {/* Wallet connected indicator */}
            {paymentMethod === 'wallet' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--s2)', border: '1px solid var(--border2)',
              borderRadius: 10, padding: '8px 12px', marginBottom: 14, fontSize: 12
            }}>
              <div style={{width:7,height:7,borderRadius:'50%',background:'var(--green)',flexShrink:0}}/>
              <span style={{color:'var(--muted)'}}>Send from connected wallet.</span>
            </div>
            )}
            {paymentMethod === 'balance' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--s2)', border: '1px solid var(--border2)',
              borderRadius: 10, padding: '8px 12px', marginBottom: 14, fontSize: 12
            }}>
              <div style={{width:7,height:7,borderRadius:'50%',background:'#00C2FF',flexShrink:0}}/>
              <span style={{color:'var(--muted)'}}>Deduct from available balance. {formatTon(userBalance)} available.</span>
            </div>
            )}

            {/* Auto plan badge */}
            <div className="auto-plan-row">
              {autoPlan && (
                <div className="auto-plan-badge" style={{background: planColor, color: planTextColor}}>
                  <Coins size={16} color={planTextColor} />
                  <span>{autoPlan.tier || autoPlan.name} Yield - {formatPct(autoPlan.rate)} / cycle - {formatDuration(autoPlan)}</span>
                  <span className="apb-tag">AUTO</span>
                </div>
              )}
            </div>

            {/* Range guide */}
            <div className="plan-range-guide">
              {plans.map(p => (
                <div key={p.id} className={`prg-item ${autoPlan?.id === p.id ? 'active ' + p.color : ''}`}>
                  <div className="prg-tier">{p.tier}</div>
                  <div className="prg-range">{formatTon(p.min)} - {p.max ? formatTon(p.max) : 'No limit'}</div>
                  <div className="prg-rate">{formatPct(p.rate)}</div>
                </div>
              ))}
            </div>

            <div className="sheet-field">
              <label className="sf-label">INVESTMENT AMOUNT</label>
              <div className="sf-input-wrap">
                <input className="sheet-input" type="number" placeholder={`Min ${formatTon(plans[0]?.min || 10)}`}
                  value={amount} onChange={e => setAmount(e.target.value)} autoFocus/>
                <span className="sf-unit">TON</span>
              </div>
              <div className="quick-row">
                {[10, 100, 200, 500].map(v => (
                  <div key={v} className="qr-btn" onClick={() => setAmount(String(v))}>{v}</div>
                ))}
              </div>
            </div>

            {/* Estimated returns */}
            {amt > 0 && autoPlan && (
              <div className="est-box">
                <div className="est-title">POSITION SUMMARY</div>
                <div className="er-grid">
                  <div className="er-item">
                    <div className="er-val" style={{color: planColor}}>{perInterval ? `+${Number(perInterval).toFixed(3)} TON` : '---'}</div>
                    <div className="er-lbl">Per cycle</div>
                  </div>
                  <div className="er-item">
                    <div className="er-val" style={{color: planColor}}>{autoPlan ? formatPct(autoPlan.rate) : '---'}</div>
                    <div className="er-lbl">Rate</div>
                  </div>
                  <div className="er-item">
                    <div className="er-val" style={{color: planColor}}>{totalReturn ? `+${Number(totalReturn).toFixed(3)} TON` : '---'}</div>
                    <div className="er-lbl">Est. return</div>
                  </div>
                </div>
                <div className="er-note">{autoPlan ? `${formatDistribution(autoPlan.profitIntervalMinutes || 5)}. Duration ${formatDuration(autoPlan)}. This action cannot be undone.` : ''}</div>
              </div>
            )}

            <button
              className={`sheet-btn main ${loading ? 'btn-loading' : ''}`}
              style={amountValid ? {background: planColor, color: planTextColor} : {}}
              onClick={handleConfirm}
              disabled={loading || !amt}
            >
              {loading
                ? <><span className="spinner" /><span className="btn-loading-text">BROADCASTING TX...</span></>
                : amt
                  ? paymentMethod === 'balance'
                    ? `CONFIRM & DEPOSIT ${formatTon(amt)}`
                    : <><Send size={16} color={planTextColor} /> CONFIRM & DEPOSIT</>
                  : 'ENTER AMOUNT'}
            </button>
            <button className="sheet-btn ghost" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  )
}
