import React, { useEffect, useMemo, useState } from 'react'
import { Bomb, Coins, ShieldAlert, Sparkles, Target } from 'lucide-react'
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

const OPEN_RISK_MULTIPLIER = 1.2
const MAX_OPENERS = 5

function mineGameMeta(game) {
  const bet = Number(game?.bet_amount) || 0
  const result = game?.result && typeof game.result === 'object' ? game.result : {}
  const payoutCap = Number(result.payout_cap ?? bet)
  const paidOut = Number(result.paid_out || 0)
  const remainingPool = Math.max(0, Number(result.remaining_pool ?? (payoutCap - paidOut)) || 0)
  const players = Array.isArray(game?.players) ? game.players.length : 0
  return {
    requiredBalance: bet * OPEN_RISK_MULTIPLIER,
    remainingPool,
    players,
  }
}

export default function MinePage({ user, config, showToast, mineCreate, mineJoin, mineList }) {
  const mineEnabled = config?.mineEnabled !== false
  const minBet = Number(config?.mineMinBet ?? 1)
  const configuredMaxBet = Number(config?.mineMaxBet)
  const maxBet = Number.isFinite(configuredMaxBet) && configuredMaxBet > 0 ? configuredMaxBet : null
  const balance = Number(user?.balance) || 0
  const myUserId = Number(user?.id) || 0

  const [amount, setAmount] = useState(String(minBet))
  const [creatorCell, setCreatorCell] = useState('')
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState([])

  const openGames = useMemo(
    () => games.filter(g => String(g.status || 'open') === 'open' && mineGameMeta(g).remainingPool > 0),
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
    if (!entryAmount || entryAmount < minBet) {
      showToast?.(`Minimum game is ${formatTon(minBet)}.`, 'err')
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
    const selectedCreatorCell = Number(creatorCell)
    if (!Number.isInteger(selectedCreatorCell) || selectedCreatorCell < 0 || selectedCreatorCell > 9) {
      showToast?.('Pick creator cell from 0 to 9.', 'err')
      return
    }

    setLoading(true)
    try {
      const result = await mineCreate?.({ betAmount: entryAmount, mineDigit: selectedCreatorCell })
      showToast?.(result?.message || 'Game created successfully.', 'ok')
      setCreatorCell('')
      await refreshGames(true)
    } catch (e) {
      console.error('[mine][create]', e)
    } finally {
      setLoading(false)
    }
  }

  const openGame = async (game) => {
    if (!mineEnabled || loading) return
    const meta = mineGameMeta(game)
    const requiredBalance = meta.requiredBalance
    if (Number(game?.creator_id) === myUserId) {
      showToast?.('This is your game. Wait for another player to open it.', 'err')
      return
    }
    if (hasJoinedGame(game, myUserId)) {
      showToast?.('You already opened this game.', 'err')
      return
    }
    if (requiredBalance > balance) {
      showToast?.(`Need ${formatTon(requiredBalance)} balance to open this game.`, 'err')
      return
    }

    setLoading(true)
    try {
      const result = await mineJoin?.({ gameId: game.id })
      showToast?.(
        result?.win
          ? `You won ${formatTon(result?.payout || 0)}!`
          : `Creator cell hit. You lost ${formatTon(result?.risk || requiredBalance)}.`,
        result?.win ? 'ok' : 'err'
      )
      await refreshGames(true)
    } catch (e) {
      console.error('[mine][open]', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page mine-page">
      <section className="mine-hero">
        <div className="mine-hero-mark">
          <Bomb size={28} />
        </div>
        <div>
          <div className="eyebrow"><Bomb size={14} /> DROP GAME</div>
          <h1>Mine</h1>
          <p>Pick a cell, lock a room, and let joiners open against the configured creator win rate.</p>
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
        </div>

        <div className="mine-field">
          <label>Creator Cell (0 to 9)</label>
          <div className="mine-digit-grid">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button
                key={digit}
                type="button"
                className={Number(creatorCell) === digit ? 'on' : ''}
                onClick={() => setCreatorCell(String(digit))}
                disabled={loading || !mineEnabled}
              >
                {digit}
              </button>
            ))}
          </div>
        </div>

        <button className="mine-primary" onClick={createGame} disabled={!mineEnabled || loading}>
          <Sparkles size={18} /> CREATE GAME
        </button>
      </section>

      <section className="mine-card mine-controls">
        <div className="mine-room-head">
          <h3><Target size={15} /> Open Games</h3>
          <span>{openGames.length} live</span>
        </div>

        {openGames.length === 0 ? (
          <div className="mine-status"><Coins size={16} /> No game yet. Create the first room.</div>
        ) : (
          <div className="mine-games-list">
            {openGames.map((g) => {
              const isCreator = Number(g.creator_id) === myUserId
              const joined = hasJoinedGame(g, myUserId)
              const meta = mineGameMeta(g)
              return (
                <div
                  key={g.id}
                  className="mine-game-row"
                >
                  <div className="mine-game-main">
                    <span className="mine-game-code">#{String(g.id).replace(/^mine-/, '').slice(0, 8)}</span>
                    <div className="mine-game-amount">
                      <strong>{formatTon(meta.remainingPool)}</strong>
                      <span>Need {formatTon(meta.requiredBalance)}</span>
                    </div>
                    <div className="mine-game-meta">
                      <span>{meta.players}/{MAX_OPENERS} opens</span>
                      <span>pool live</span>
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
