import { useState } from 'react'

interface Props {
  balance?: number
  config?: { minWithdraw?: number }
  walletConnected?: boolean
  user?: { walletAddr?: string }
  onClose: () => void
  showToast: (msg: string, type?: string) => void
  onSubmit: (amount: number, walletAddress: string) => Promise<boolean>
  onConnectWallet?: () => void
}

export default function WithdrawModal({
  balance = 0,
  config,
  walletConnected,
  user,
  onClose,
  showToast,
  onSubmit,
  onConnectWallet,
}: Props) {
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  const minWithdraw = Number(config?.minWithdraw) || 5
  const walletAddress = user?.walletAddr || ''
  const shortAddr = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : 'Not connected'

  async function handleWithdraw() {
    if (!walletConnected || !walletAddress) {
      showToast('Connect your TON wallet first', 'err')
      return
    }
    const amt = parseFloat(amount)
    if (!amt || amt < minWithdraw) {
      showToast(`Minimum withdrawal: ${minWithdraw} TON`, 'err')
      return
    }
    if (amt > balance) {
      showToast('Insufficient balance', 'err')
      return
    }
    setLoading(true)
    try {
      const ok = await onSubmit(amt, walletAddress)
      if (ok) onClose()
    } finally {
      setLoading(false)
    }
  }

  const fmtTon = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="modal-overlay show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="sheet-handle" />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, marginBottom: 16 }}>
          Withdraw TON
        </div>

        {/* Balance */}
        <div style={{ background: 'var(--s2)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>Available balance</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800 }}>
            {fmtTon(balance)} <span style={{ color: 'var(--gold)', fontSize: 16 }}>TON</span>
          </div>
        </div>

        {/* Wallet connect warning */}
        {!walletConnected && (
          <div
            onClick={onConnectWallet}
            style={{ background: '#ff4d4d10', border: '1px solid #ff4d4d40', borderRadius: 9, padding: '10px 12px', marginBottom: 14, fontSize: 12, color: '#ff8a80', display: 'flex', gap: 8, cursor: 'pointer' }}
          >
            <span>⚠</span>
            <span>Connect your TON wallet to withdraw. <b>Tap to connect.</b></span>
          </div>
        )}

        {/* Note */}
        <div style={{ background: '#ff4d4d10', border: '1px solid #ff4d4d20', borderRadius: 9, padding: '10px 12px', marginBottom: 14, fontSize: 12, color: '#ff8a80', display: 'flex', gap: 8 }}>
          <span>ℹ</span>
          <span>Minimum withdrawal: <b>{minWithdraw} TON</b>. Processed automatically within minutes.</span>
        </div>

        {/* Input */}
        <input
          className="input"
          type="number"
          placeholder="Amount in TON..."
          value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{ marginBottom: 10 }}
          disabled={loading}
        />

        {/* Quick amounts */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[10, 50, 100].map(v => (
            <button key={v} onClick={() => setAmount(String(v))} disabled={loading}
              style={{ flex: 1, padding: '9px 0', background: 'var(--s2)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
              {v}
            </button>
          ))}
          <button onClick={() => setAmount(String(balance))} disabled={loading}
            style={{ flex: 1, padding: '9px 0', background: 'var(--s2)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
            All
          </button>
        </div>

        {/* Summary */}
        <div style={{ background: 'var(--s2)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
            <span style={{ color: 'var(--muted)' }}>Destination</span>
            <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>{shortAddr}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--muted)' }}>Network fee</span>
            <span style={{ fontWeight: 700, color: 'var(--muted)' }}>~0.015 TON</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            Transactions are irreversible. Double-check your wallet address.
          </div>
        </div>

        <button className="btn btn-red" onClick={handleWithdraw} disabled={loading} style={{ marginBottom: 8 }}>
          {loading ? 'Processing...' : 'Confirm Withdrawal'}
        </button>
        <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
      </div>
    </div>
  )
}
