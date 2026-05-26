import React, { useEffect, useMemo, useState } from 'react'
import { Bomb, Coins, ShieldAlert, Sparkles } from 'lucide-react'
import { supabase } from '../utils/supabase'
import './MinePage.css'

function formatTon(value, digits = 3) {
  return `${(Number(value) || 0).toFixed(digits)} TON`
}

function fmtAgo(dateStr) {
  if (!dateStr) return 'just now'
  const ts = new Date(dateStr).getTime()
  const diff = Math.max(0, Date.now() - ts)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function hasJoinedGame(game, userId) {
  const players = Array.isArray(game?.players) ? game.players : []
  return players.some((p) => Number(p?.user_id) === Number(userId))
}

export default function MinePage({ user, config, showToast, mineCreate, mineJoin, mineList }) {
  const mineEnabled = config?.mineEnabled !== false
  const minBet = Number(config?.mineMinBet ?? 0.01)
  const configuredMaxBet = Number(config?.mineMaxBet)
  const maxBet = Number.isFinite(configuredMaxBet) && configuredMaxBet > 0 ? configuredMaxBet : null
  const balance = Number(user?.balance) || 0
  const myUserId = Number(user?.id) || 0

  const [amount, setAmount] = useState(String(minBet))
  const [safeCell, setSafeCell] = useState('')
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState([])

  const openGames = useMemo(
    () => games.filter(g => String(g.status || 'open') === 'open'),
    [games]
  )

  const refreshGames = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await mineList?.()
      const nextGames = Array.isArray(data?.games) ? data.games : []
      setGames(nextGames)
    } catch (e) {
      console.error('[mine][list]', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    refreshGames()
    const channel = supabase
      .channel(`mine-games-${myUserId || 'guest'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mine_games' }, () => refreshGames(true))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, []) // eslint-disable-line

  const createGame = async () => {
    if (!mineEnabled) {
      showToast?.('Mine game is currently disabled.', 'err')
      return
    }
    const entryAmount = Number(amount)
    const safe = Number(safeCell)
    if (!entryAmount || entryAmount < minBet) {
      showToast?.(`Minimum amount is ${formatTon(minBet)}.`, 'err')
      return
    }
    if (maxBet && entryAmount > maxBet) {
      showToast?.(`Maximum amount is ${formatTon(maxBet)}.`, 'err')
      return
    }
    if (entryAmount > balance) {
      showToast?.('Insufficient balance.', 'err')
      return
    }
    if (!Number.isInteger(safe) || safe < 0 || safe > 9) {
      showToast?.('Please enter safe cell from 0 to 9.', 'err')
      return
    }

    setLoading(true)
    try {
      const result = await mineCreate?.({ betAmount: entryAmount, safeCell: safe })
      showToast?.(result?.message || 'Game created successfully.', 'ok')
      setSafeCell('')
      await refreshGames(true)
    } catch (e) {
      console.error('[mine][create]', e)
    } finally {
      setLoading(false)
    }
  }

  const openGame = async (game) => {
    if (!mineEnabled || loading) return
    const cell = Number(safeCell)
    const requiredBalance = Number(game?.bet_amount) || 0
    if (Number(game?.creator_id) === myUserId) {
      showToast?.('This is your game. Wait for another player to open it.', 'err')
      return
    }
    if (hasJoinedGame(game, myUserId)) {
      showToast?.('You already opened this game.', 'err')
      return
    }
    if (!Number.isInteger(cell) || cell < 0 || cell > 9) {
      showToast?.('Please enter safe cell from 0 to 9 before opening a game.', 'err')
      return
    }
    if (requiredBalance > balance) {
      showToast?.(`Need ${formatTon(requiredBalance)} balance to open this game.`, 'err')
      return
    }

    setLoading(true)
    try {
      const result = await mineJoin?.({ gameId: game.id, cell })
      showToast?.(
        result?.win
          ? `Opened. You won ${formatTon(result?.payout || 0)}.`
          : 'Opened. No safe cell found.',
        result?.win ? 'ok' : 'err'
      )
      await refreshGames(true)
    } catch (e) {
      console.error('[mine][open]', e)
    } finally {
      setLoading(false)
    }
  }

  const quickAmounts = [minBet, minBet * 2, maxBet || minBet * 5]
    .map(v => +Number(v || 0).toFixed(3))
    .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i)

  return (
    <main className="page mine-page">
      <section className="mine-hero">
        <div>
          <div className="eyebrow"><Bomb size={14} /> DROP GAME</div>
          <h1>Mine</h1>
          <p>Create a compact room with a hidden safe cell and realtime open-game status.</p>
        </div>
        <div className="mine-balance">
          <span>Available</span>
          <strong>{formatTon(balance)}</strong>
        </div>
      </section>

      {!mineEnabled && (
        <section className="mine-card">
          <div className="mine-disabled"><ShieldAlert size={18} /> Mine game is disabled by admin.</div>
        </section>
      )}

      <section className="mine-card mine-controls">
        <div className="mine-field">
          <label>Create Game Amount</label>
          <div className="mine-input-wrap">
            <input
              type="number"
              min={minBet}
              max={maxBet || undefined}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading || !mineEnabled}
            />
            <span>TON</span>
          </div>
          <div className="mine-amount-row">
            {quickAmounts.map(v => (
              <button key={v} type="button" onClick={() => setAmount(String(v))} disabled={loading || !mineEnabled}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="mine-field">
          <label>Your Safe Cell (0 to 9)</label>
          <div className="mine-input-wrap">
            <input
              type="number"
              min={0}
              max={9}
              step="1"
              value={safeCell}
              onChange={(e) => setSafeCell(e.target.value)}
              disabled={loading || !mineEnabled}
            />
            <span>#</span>
          </div>
        </div>

        <button className="mine-primary" onClick={createGame} disabled={!mineEnabled || loading}>
          <Sparkles size={18} /> CREATE GAME
        </button>
      </section>

      <section className="mine-card mine-controls">
        <div className="mine-room-head">
          <h3>Open Games</h3>
        </div>

        {openGames.length === 0 ? (
          <div className="mine-status"><Coins size={16} /> No game yet. Create the first room.</div>
        ) : (
          <div className="mine-games-list">
            {openGames.map((g) => {
              const isCreator = Number(g.creator_id) === myUserId
              const joined = hasJoinedGame(g, myUserId)
              return (
                <div
                  key={g.id}
                  className="mine-game-row"
                >
                  <div className="mine-game-main">
                    <span className="mine-game-code">#{String(g.id).replace(/^mine-/, '').slice(0, 8)}</span>
                    <div className="mine-game-amount">
                      <strong>{formatTon(g.bet_amount || 0)}</strong>
                      <span>Need {formatTon(g.bet_amount || 0)}</span>
                    </div>
                  </div>
                  <div className="mine-game-side">
                    <button
                      type="button"
                      className={`mine-open-pill ${joined || isCreator ? 'muted' : ''}`}
                      onClick={() => openGame(g)}
                      disabled={loading || !mineEnabled || joined || isCreator}
                    >
                      {isCreator ? 'CREATED' : joined ? 'JOINED' : 'OPEN'}
                    </button>
                    <span>{fmtAgo(g.created_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
