import React, { useEffect, useId, useState } from 'react'
import { Play } from 'lucide-react'
import './PlanRing.css'

const formatTime = (ms) => {
  if (ms <= 0) return '0:00'
  const totalSec = Math.ceil(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PlanRing({
  nextProfitTime = 0,
  intervalMs = 86_400_000,
  planColor = 'blue',
  activated = false,
  paused = false,
  waitingLabel = '',
  size = 100,
  onActivate,
}) {
  const uid = useId().replace(/:/g, '')
  const [timeLeft, setTimeLeft] = useState(0)
  const [progress, setProgress] = useState(0)
  const radius = (size - 16) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2
  const safeInterval = Math.max(1000, Number(intervalMs) || 86_400_000)

  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, Number(nextProfitTime || 0) - Date.now())
      const elapsed = safeInterval - remaining
      setTimeLeft(remaining)
      setProgress(Math.max(0, Math.min(1, elapsed / safeInterval)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextProfitTime, safeInterval])

  const colors = {
    blue: { track: 'var(--color-ton-muted)', arc: ['var(--blue)', 'var(--blue2)'] },
    gold: { track: 'var(--color-gold-muted)', arc: ['var(--color-gold-warm)', 'var(--gold)'] },
    purple: { track: 'var(--color-ton-muted)', arc: ['var(--color-ton-dark)', 'var(--blue2)'] },
  }[planColor] || {
    track: 'var(--color-ton-muted)',
    arc: ['var(--blue)', 'var(--blue2)'],
  }
  const strokeOffset = circumference - progress * circumference
  const dotAngle = 2 * Math.PI * progress - Math.PI / 2
  const urgent = activated && timeLeft > 0 && timeLeft <= 30_000
  const distributing = activated && timeLeft <= 0

  return (
    <div className="plan-ring-shell">
      <div className={`plan-ring-wrapper ${distributing ? 'ring-distributing' : ''}`} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="plan-ring-svg">
          <defs>
            <linearGradient id={`arc-gradient-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colors.arc[0]} />
              <stop offset="100%" stopColor={colors.arc[1]} />
            </linearGradient>
            <filter id={`ring-glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx={center} cy={center} r={radius} fill="none" stroke={colors.track} strokeWidth="6" />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={`url(#arc-gradient-${uid})`}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
            filter={`url(#ring-glow-${uid})`}
            className="plan-ring-arc"
          />
          {(activated || paused) && (
            <circle
              cx={center + radius * Math.cos(dotAngle)}
              cy={center + radius * Math.sin(dotAngle)}
              r="4"
              fill={colors.arc[1]}
              filter={`url(#ring-glow-${uid})`}
            />
          )}
        </svg>
        <div className="plan-ring-center">
          {activated && !paused ? (
            <>
              <span className={`ring-timer ${urgent ? 'urgent' : ''}`}>{formatTime(timeLeft)}</span>
              <span className="ring-label">{distributing ? 'Distributing' : 'Next yield'}</span>
            </>
          ) : paused ? (
            <>
              <span className="ring-timer ring-muted">Paused</span>
              <span className="ring-label">{waitingLabel || 'Offline'}</span>
            </>
          ) : (
            <button className="ring-activate" onClick={onActivate} type="button">
              <Play size={16} color="currentColor" />
              <span>Activate</span>
            </button>
          )}
        </div>
      </div>
      <div className={`plan-ring-status ${activated && !paused ? 'status-active' : 'status-pending'}`}>
        {activated && !paused ? 'ACTIVE' : paused ? 'PAUSED' : 'READY'}
      </div>
    </div>
  )
}

export default PlanRing
