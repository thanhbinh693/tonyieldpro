import React, { useMemo, useState } from 'react'
import { Bomb, Coins, Gem, RotateCcw, ShieldAlert, Sparkles } from 'lucide-react'
import './MinePage.css'

const GRID_SIZE = 25
const DEFAULT_MINE_CONFIG = {
  enabled: true,
  minBet: 0.01,
  maxBet: 1,
  mineCount: 3,
  houseEdge: 4,
}

function clampNumber(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function formatTon(value, digits = 3) {
  return `${(Number(value) || 0).toFixed(digits)} TON`
}

function buildCells(revealed = [], minePositions = []) {
  const revealedSet = new Set(revealed.map(Number))
  const mineSet = new Set(minePositions.map(Number))
  return Array.from({ length: GRID_SIZE }, (_, index) => ({
    index,
    revealed: revealedSet.has(index),
    mine: mineSet.has(index),
  }))
}

export default function MinePage({ user, config, showToast, playMineRound }) {
  const mineConfig = { ...DEFAULT_MINE_CONFIG, ...(config?.mine || {}) }
  const [bet, setBet] = useState(String(mineConfig.minBet))
  const [loading, setLoading] = useState(false)
  const [round, setRound] = useState(null)

  const safeMineCount = clampNumber(mineConfig.mineCount, 1, GRID_SIZE - 1)
  const safeHouseEdge = clampNumber(mineConfig.houseEdge, 0, 30)
  const balance = Number(user?.balance) || 0

  const cells = useMemo(
    () => buildCells(round?.revealedCells || [], round?.minePositions || []),
    [round?.revealedCells, round?.minePositions]
  )

  const multiplier = useMemo(() => {
    const safeCells = GRID_SIZE - safeMineCount
    const base = GRID_SIZE / Math.max(1, safeCells)
    return Math.max(1.01, base * (1 - safeHouseEdge / 100))
  }, [safeMineCount, safeHouseEdge])

  const startRound = () => {
    if (!mineConfig.enabled) {
      showToast?.('Mine game is currently disabled.', 'err')
      return
    }
    const amount = Number(bet)
    if (!amount || amount < Number(mineConfig.minBet)) {
      showToast?.(`Minimum bet is ${formatTon(mineConfig.minBet)}.`, 'err')
      return
    }
    if (amount > Number(mineConfig.maxBet)) {
      showToast?.(`Maximum bet is ${formatTon(mineConfig.maxBet)}.`, 'err')
      return
    }
    if (amount > balance) {
      showToast?.('Insufficient balance.', 'err')
      return
    }
    setRound({
      bet: amount,
      status: 'playing',
      revealedCells: [],
      minePositions: [],
      payout: 0,
      selectedCell: null,
    })
  }

  const revealCell = async (index) => {
    if (!round || round.status !== 'playing' || loading) return
    if (round.revealedCells.includes(index)) return

    setLoading(true)
    try {
      const result = await playMineRound({
        bet: round.bet,
        selectedCell: index,
        mineCount: safeMineCount,
      })

      setRound({
        ...round,
        status: result.win ? 'won' : 'lost',
        revealedCells: [index],
        minePositions: result.minePositions || [],
        payout: Number(result.payout) || 0,
        selectedCell: index,
      })

      showToast?.(
        result.win
          ? `You found a gem and won ${formatTon(result.payout)}.`
          : 'Boom! Mine exploded.',
        result.win ? 'ok' : 'err'
      )
    } catch (e) {
      console.error('[mine]', e)
      showToast?.(`Mine round failed: ${e?.message || 'please retry'}.`, 'err')
    } finally {
      setLoading(false)
    }
  }

  const resetRound = () => setRound(null)

  const quickBets = [mineConfig.minBet, mineConfig.minBet * 2, mineConfig.maxBet]
    .map(v => +Number(v || 0).toFixed(3))
    .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i)

  return (
    <main className="page mine-page">
      <section className="mine-hero">
        <div>
          <div className="eyebrow"><Bomb size={14} /> BALANCE GAME</div>
          <h1>Mine</h1>
          <p>Pick one safe tile. Win instantly if you uncover a gem, or lose the bet if you hit a mine.</p>
        </div>
        <div className="mine-balance">
          <span>Available</span>
          <strong>{formatTon(balance)}</strong>
        </div>
      </section>

      <section className="mine-card mine-controls">
        <div className="mine-field">
          <label>Bet Amount</label>
          <div className="mine-input-wrap">
            <input
              type="number"
              min={mineConfig.minBet}
              max={mineConfig.maxBet}
              step="0.01"
              value={bet}
              onChange={e => setBet(e.target.value)}
              disabled={round?.status === 'playing' || loading}
            />
            <span>TON</span>
          </div>
          <div className="mine-bet-row">
            {quickBets.map(v => (
              <button key={v} type="button" onClick={() => setBet(String(v))} disabled={round?.status === 'playing' || loading}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="mine-stat-grid">
          <div><span>Mines</span><strong>{safeMineCount}</strong></div>
          <div><span>Win chance</span><strong>{Math.round(((GRID_SIZE - safeMineCount) / GRID_SIZE) * 100)}%</strong></div>
          <div><span>Multiplier</span><strong>{multiplier.toFixed(2)}x</strong></div>
          <div><span>Max bet</span><strong>{formatTon(mineConfig.maxBet, 2)}</strong></div>
        </div>

        {!round ? (
          <button className="mine-primary" onClick={startRound} disabled={!mineConfig.enabled || loading}>
            <Sparkles size={18} /> START ROUND
          </button>
        ) : (
          <button className="mine-secondary" onClick={resetRound} disabled={loading}>
            <RotateCcw size={18} /> NEW ROUND
          </button>
        )}
      </section>

      <section className={`mine-card mine-board-card ${round?.status || 'idle'}`}>
        {!mineConfig.enabled && (
          <div className="mine-disabled"><ShieldAlert size={18} /> Mine game is disabled by admin.</div>
        )}

        <div className="mine-board">
          {cells.map(cell => {
            const visibleMine = round?.status === 'lost' && cell.mine
            const selected = round?.selectedCell === cell.index
            return (
              <button
                key={cell.index}
                type="button"
                className={`mine-cell ${cell.revealed ? 'revealed' : ''} ${visibleMine ? 'mine' : ''} ${selected ? 'selected' : ''}`}
                disabled={!round || round.status !== 'playing' || loading}
                onClick={() => revealCell(cell.index)}
              >
                {cell.revealed && round?.status === 'won' ? <Gem size={22} /> : null}
                {visibleMine ? <Bomb size={22} /> : null}
              </button>
            )
          })}
        </div>

        <div className="mine-status">
          {!round && <><Coins size={16} /> Set your bet and start a round.</>}
          {round?.status === 'playing' && <><Sparkles size={16} /> Choose one tile to reveal.</>}
          {round?.status === 'won' && <><Gem size={16} /> Won {formatTon(round.payout)}. Net profit {formatTon(round.payout - round.bet)}.</>}
          {round?.status === 'lost' && <><Bomb size={16} /> Lost {formatTon(round.bet)}.</>}
        </div>
      </section>
    </main>
  )
}