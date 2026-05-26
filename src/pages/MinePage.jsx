import React, { useEffect, useMemo, useState } from 'react'
import { Bomb, Coins, Gem, ShieldAlert, Sparkles, Users } from 'lucide-react'
import { supabase } from '../utils/supabase'
import './MinePage.css'

const GRID_SIZE = 25
const SLOT_COUNT = 5

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

function buildCells(selectedCell, safeCell, revealAll) {
  return Array.from({ length: GRID_SIZE }, (_, index) => {
    const isSelected = Number(selectedCell) === index
    const isSafe = Number(safeCell) === index
    const isRevealed = revealAll || isSelected
    return {
      index,
      selected: isSelected,
      revealed: isRevealed,
      safe: isSafe,
      mine: isRevealed && !isSafe,
    }
  })
}

function normalizeSlots(players = []) {
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => ({
    slot: i + 1,
    user_id: null,
    selected_cell: null,
    status: 'empty',
  }))

  ;(Array.isArray(players) ? players : []).forEach((p) => {
    const slotIdx = Number(p?.slot) - 1
    if (slotIdx < 0 || slotIdx >= SLOT_COUNT) return
    slots[slotIdx] = {
      slot: slotIdx + 1,
      user_id: Number(p?.user_id) || null,
      selected_cell: Number.isInteger(Number(p?.selected_cell)) ? Number(p.selected_cell) : null,
      status: String(p?.status || 'joined'),
    }
  })

  return slots
}

export default function MinePage({ user, config, showToast, mineCreate, mineJoin, mineReveal, mineList }) {
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
  const [activeGameId, setActiveGameId] = useState('')

  const activeGame = useMemo(
    () => games.find(g => String(g.id) === String(activeGameId)) || games[0] || null,
    [games, activeGameId]
  )

  const activeSlots = useMemo(
    () => normalizeSlots(activeGame?.players || []),
    [activeGame?.players]
  )

  const mySlot = useMemo(
    () => activeSlots.find(s => Number(s.user_id) === myUserId) || null,
    [activeSlots, myUserId]
  )

  const boardCells = useMemo(() => {
    const safe = Number(activeGame?.safe_cell)
    const selected = mySlot?.selected_cell
    const revealAll = activeGame?.status === 'completed' && Number.isInteger(safe)
    return buildCells(selected, safe, revealAll)
  }, [activeGame?.safe_cell, activeGame?.status, mySlot?.selected_cell])

  const refreshGames = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await mineList?.()
      const nextGames = Array.isArray(data?.games) ? data.games : []
      setGames(nextGames)
      setActiveGameId(prev => {
        if (prev && nextGames.some(g => String(g.id) === String(prev))) return prev
        return nextGames[0]?.id || ''
      })
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
      if (result?.game?.id) setActiveGameId(result.game.id)
    } catch (e) {
      console.error('[mine][create]', e)
    } finally {
      setLoading(false)
    }
  }

  const joinGame = async (slot) => {
    if (!activeGame) return
    setLoading(true)
    try {
      const result = await mineJoin?.({ gameId: activeGame.id, slot })
      showToast?.(result?.message || `Joined slot #${slot}`, 'ok')
      await refreshGames(true)
    } catch (e) {
      console.error('[mine][join]', e)
    } finally {
      setLoading(false)
    }
  }

  const revealCell = async (cellIndex) => {
    if (!activeGame || !mySlot) return
    if (activeGame.status !== 'open') return
    if (mySlot.selected_cell !== null && mySlot.selected_cell !== undefined) return

    setLoading(true)
    try {
      const result = await mineReveal?.({
        gameId: activeGame.id,
        slot: mySlot.slot,
        selectedCell: cellIndex,
      })
      const won = !!result?.won
      showToast?.(
        won
          ? `Nice! You won ${formatTon(result?.payout || 0)}`
          : 'Boom! You hit a mine.',
        won ? 'ok' : 'err'
      )
      await refreshGames(true)
    } catch (e) {
      console.error('[mine][reveal]', e)
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
          <p>Create room with hidden safe cell, let players join 1/5 slots and reveal once. Closest to TON wallet game-flow.</p>
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

        {games.length === 0 ? (
          <div className="mine-status"><Coins size={16} /> No game yet. Create the first room.</div>
        ) : (
          <div className="mine-games-list">
            {games.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`mine-game-row ${String(activeGame?.id) === String(g.id) ? 'active' : ''}`}
                onClick={() => setActiveGameId(g.id)}
              >
                <span>#{String(g.id).slice(0, 8)}</span>
                <span>{formatTon(g.bet_amount || 0)}</span>
                <span>{g.status}</span>
                <span>{fmtAgo(g.created_at)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {activeGame && (
        <>
          <section className="mine-card mine-controls">
            <div className="mine-room-head">
              <h3>Game #{String(activeGame.id).slice(0, 10)}</h3>
              <div className="mine-room-meta">
                <Users size={16} />
                <span>{activeSlots.filter(s => s.user_id).length}/{SLOT_COUNT}</span>
              </div>
            </div>

            <div className="mine-slots-grid">
              {activeSlots.map((slot) => {
                const isMine = Number(slot.user_id) === myUserId
                const canJoin = !slot.user_id && mineEnabled && activeGame.status === 'open'
                return (
                  <div key={slot.slot} className={`mine-slot-card ${isMine ? 'mine' : ''}`}>
                    <div className="mine-slot-top">
                      <strong>Slot #{slot.slot}</strong>
                      <span>{slot.user_id ? `UID ${slot.user_id}` : 'Empty'}</span>
                    </div>
                    <div className="mine-slot-status">{slot.status}</div>
                    {canJoin && (
                      <button type="button" className="mine-secondary" onClick={() => joinGame(slot.slot)} disabled={loading}>
                        Join slot
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <section className={`mine-card mine-board-card ${activeGame.status || 'idle'}`}>
            <div className="mine-board">
              {boardCells.map(cell => {
                const canReveal = mySlot && mySlot.selected_cell == null && activeGame.status === 'open'
                return (
                  <button
                    key={cell.index}
                    type="button"
                    className={`mine-cell ${cell.revealed ? 'revealed' : ''} ${cell.mine ? 'mine' : ''} ${cell.selected ? 'selected' : ''}`}
                    disabled={!canReveal || loading}
                    onClick={() => revealCell(cell.index)}
                  >
                    {cell.revealed && cell.safe ? <Gem size={22} /> : null}
                    {cell.mine ? <Bomb size={22} /> : null}
                  </button>
                )
              })}
            </div>

            <div className="mine-status">
              {!mySlot && <><Coins size={16} /> Join a slot to play this game.</>}
              {mySlot && mySlot.selected_cell == null && activeGame.status === 'open' && <><Sparkles size={16} /> Pick one cell now.</>}
              {mySlot && mySlot.selected_cell != null && activeGame.status === 'open' && <><Sparkles size={16} /> Waiting for game to complete.</>}
              {activeGame.status === 'completed' && <><Gem size={16} /> Game completed. Board revealed.</>}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
