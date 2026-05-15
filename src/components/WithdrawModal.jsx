import React, { useState, useEffect } from 'react'
import { useTonWallet, toUserFriendlyAddress } from '@tonconnect/ui-react'
import { CheckCircle2, Info, Send, ShieldCheck, Wallet, XCircle } from 'lucide-react'

import './Modal.css'

const formatTon = (value) => `${(Number(value) || 0).toFixed(3)} TON`

/**
 * Convert any TON address format to friendly format.
 * - mainnet: UQ... (bounceable=false, testOnly=false)
 * - testnet: kQ... (bounceable=false, testOnly=true)
 *
 * toUserFriendlyAddress(addr, bounceable, testOnly)
 */
function toFriendlyAddr(rawAddr, isTestnet) {
  if (!rawAddr) return ''
  try {
    return toUserFriendlyAddress(rawAddr, isTestnet)
  } catch {
    return ''
  }
}

function isValidTonAddress(addr) {
  if (!addr || typeof addr !== 'string') return false
  // mainnet: UQ.../EQ... | testnet: kQ.../0Q...
  // base64url alphabet includes A-Z a-z 0-9 _ - and trailing = padding
  // BUG FIX: match đúng UQ/EQ (mainnet) và kQ/0Q (testnet), độ dài chuẩn 48 ký tự
  return /^[UEk0][Qq][A-Za-z0-9_-]{46}=?$/.test(addr.trim())
}

/**
 * WithdrawModal — Automatic flow via backend
 *
 * Wallet address always taken DIRECTLY from TonConnect (live) — do not use cached walletAddr.
 * If wallet is no longer connected, user must reconnect.
 */
export default function WithdrawModal({
  balance, config, onClose, showToast,
  onSubmit, walletConnected, onConnectWallet, user
}) {
  const [amount,    setAmount]    = useState('')
  const [step,      setStep]      = useState(walletConnected ? 'amount' : 'connect')
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Always get live address from TonConnect — do NOT use user.walletAddr to avoid stale data
  const tonWallet  = useTonWallet()
  // Derive isTestnet from config so it updates when admin switches network
  const isTestnet  = (config?.tonNetwork || 'testnet') === 'testnet'
  // Convert immediately to friendly format based on current network
  const walletAddr = toFriendlyAddr(tonWallet?.account?.address || '', isTestnet)

  const minW     = config?.minWithdraw || 5
  const amt      = parseFloat(amount) || 0
  const validAmt = amt >= minW && amt <= balance

  // Auto-advance when wallet just connected
  useEffect(() => {
    if (walletConnected && step === 'connect') setStep('amount')
  }, [walletConnected])

  const handleConnect = async () => {
    setLoading(true)
    try { await onConnectWallet() }
    catch { showToast('Network error - please retry.', 'err') }
    setLoading(false)
  }

  const handleSubmit = async () => {
    if (!validAmt) {
      showToast(amt < minW ? `Amount below minimum (${formatTon(minW)}).` : 'Amount exceeds available balance.', 'err')
      return
    }
    // Check live wallet from TonConnect — do not use cached address
    if (!walletAddr) {
      showToast('No wallet connected.', 'err')
      setStep('connect')
      return
    }
    if (!isValidTonAddress(walletAddr)) {
      showToast('Invalid destination address.', 'err')
      return
    }
    setLoading(true)
    // Pass wallet address DIRECTLY from TonConnect live — do not fallback to cached
    const ok = await onSubmit(amt, walletAddr)
    setLoading(false)
    if (ok !== false) {
      setSubmitted(true)
      setTimeout(() => onClose(), 2800)
    }
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="overlay" onClick={e => e.target.classList.contains('overlay') && onClose()}>
        <div className="sheet" style={{ padding: '56px 24px 40px', textAlign: 'center' }}>
          <div className="handle" />
          <div style={{ marginBottom: 16 }}><CheckCircle2 size={32} color="#FFD600" /></div>
          <h2 className="sheet-title" style={{ marginBottom: 8 }}>REQUEST SUBMITTED</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
            Withdrawal request submitted for <b>{formatTon(amt)}</b>.<br />
            Processing time: up to 24 hours.
          </p>
          <div style={{
            background: 'var(--card)', borderRadius: 12, padding: '12px 16px',
            margin: '20px 0', fontSize: 12, color: 'var(--muted)',
            wordBreak: 'break-all', textAlign: 'left',
          }}>
            <div style={{ marginBottom: 4, fontWeight: 600, color: 'var(--text)' }}>DESTINATION WALLET</div>
            {walletAddr}
          </div>
          <button className="sheet-btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" onClick={e => e.target.classList.contains('overlay') && onClose()}>
      <div className="sheet" style={{ paddingBottom: 40 }}>
        <div className="handle" />

        {/* ── Step 1: Connect wallet ────────────────────────────────────── */}
        {step === 'connect' && (
          <div className="wallet-connect-wrap">
            <div className="wc-icon"><Wallet size={32} color="#0098EA" /></div>
            <h2 className="sheet-title" style={{ marginTop: 8 }}>WITHDRAWAL REQUEST</h2>
            <p className="wc-desc">
              Connect your TON wallet to set the destination address.
            </p>
            <div className="wc-features">
              <div className="wc-feat"><CheckCircle2 size={16} color="#FFD600" /> Destination is read from TON Connect.</div>
              <div className="wc-feat"><CheckCircle2 size={16} color="#FFD600" /> No private keys are stored.</div>
              <div className="wc-feat"><ShieldCheck size={16} color="#FFD600" /> Payout is handled by the withdrawal system.</div>
            </div>
            <button
              className={`sheet-btn main ${loading ? 'btn-loading' : ''}`}
              style={{ background: 'linear-gradient(135deg,#0098EA,#00C2FF)', color: '#fff', marginTop: 24 }}
              onClick={handleConnect}
              disabled={loading}
            >
              {loading ? <><span className="spinner" /><span className="btn-loading-text">CONNECTING...</span></> : <><Wallet size={16} color="#FFFFFF" /> CONNECT WALLET</>}
            </button>
            <button className="sheet-btn ghost" onClick={onClose}>Cancel</button>
          </div>
        )}

        {/* ── Step 2: Enter amount ──────────────────────────────────────── */}
        {step === 'amount' && (
          <>
            <h2 className="sheet-title">WITHDRAWAL REQUEST</h2>

            {/* Balance */}
            <div className="bal-display">
              <div className="bd-label">AVAILABLE</div>
              <div className="bd-val">{formatTon(balance).replace(' TON','')} <span>TON</span></div>
            </div>

            {/* Destination wallet — LIVE from TonConnect, NOT cached */}
            <div style={{
              background: 'var(--card)', borderRadius: 12, padding: '10px 14px',
              marginBottom: 14, border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
                <Wallet size={16} color="#94A3B8" /> DESTINATION WALLET
              </div>
              {walletAddr ? (
                <>
                  <div style={{ fontSize: 13, color: 'var(--blue)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {`${walletAddr.slice(0, 14)}...${walletAddr.slice(-8)}`}
                  </div>
                  {/* Warning if current wallet differs from previously saved address */}
                  {user?.walletAddr && user.walletAddr !== walletAddr && (
                    <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 5 }}>
                      <XCircle size={16} color="#FFD600" /> This address differs from the saved wallet.
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--red)' }}>
                  <XCircle size={16} color="#EF4444" /> No wallet connected.
                </div>
              )}
            </div>

            <div className="info-bar" style={{ marginBottom: 14 }}>
              <Info size={16} color="#0098EA" /> Minimum: <b>{formatTon(minW)}</b>. Processing time: up to 24 hours.
            </div>

            {/* Amount input */}
            <div className="sheet-field">
              <label className="sf-label">WITHDRAWAL AMOUNT</label>
              <div className="sf-input-wrap">
                <input
                  className="sheet-input"
                  type="number"
                  placeholder={`Min ${formatTon(minW)}`}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
                <span className="sf-unit">TON</span>
              </div>
              <div className="quick-row">
                {[10, 50, 100].filter(v => v <= balance).map(v => (
                  <div key={v} className="qr-btn" onClick={() => setAmount(String(v))}>{v}</div>
                ))}
                <div className="qr-btn" onClick={() => setAmount(String(balance?.toFixed(2)))}>Max</div>
              </div>
            </div>

            {/* Summary */}
            {amt > 0 && (
              <div className="step-summary">
                <div className="ss-row">
                  <span>Withdrawal amount</span>
                  <span className="green">{formatTon(amt)}</span>
                </div>
                <div className="ss-row">
                  <span>Available</span>
                  <span style={{ color: 'var(--muted)' }}>{formatTon(balance)}</span>
                </div>
                <div className="ss-row">
                  <span>Minimum</span>
                  <span style={{ color: 'var(--muted)' }}>{formatTon(minW)}</span>
                </div>
              </div>
            )}

            <button
              className={`sheet-btn main ${loading ? 'btn-loading' : ''}`}
              style={{ background: validAmt ? 'var(--blue)' : 'var(--card)',
                       color: validAmt ? '#fff' : 'var(--muted)' }}
              onClick={handleSubmit}
              disabled={!amt || loading}
            >
              {loading ? <><span className="spinner" /><span className="btn-loading-text">SUBMITTING...</span></> : <><Send size={16} color="#FFFFFF" /> SUBMIT WITHDRAWAL</>}
            </button>
            <button className="sheet-btn ghost" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  )
}
