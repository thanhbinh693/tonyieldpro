import React, { useState } from 'react'
import { Calendar, Copy } from 'lucide-react'
import { Avatar } from '../Avatar'
import './AvatarCard.css'

const formatSince = (value) => {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function AvatarCard({ user, balance, todayProfit, profitEarned, referredUsers = 0 }) {
  const [copied, setCopied] = useState(false)
  const name = user?.firstName || user?.username || 'Anonymous'
  const today = Number(todayProfit) || 0
  const earned = Number(profitEarned) || 0
  const teamCount = Number(referredUsers) || 0

  const copyId = () => {
    navigator.clipboard?.writeText(String(user?.id || '')).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="avatar-card">
      <div className="oc-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="avatar-card-identity">
        <Avatar src={user?.photoUrl} name={user?.firstName} username={user?.username} size={56} glowing showStatus />
        <div className="avatar-card-info">
          <span className="avatar-card-name">{name}</span>
          {user?.username && <span className="avatar-card-username">@{user.username}</span>}
          <button className="avatar-card-id" onClick={copyId} title="Copy ID" type="button">
            <span>ID: {user?.id}</span>
            <Copy size={11} color={copied ? 'var(--green)' : 'var(--muted)'} />
          </button>
          <span className="avatar-card-since">
            <Calendar size={11} color="var(--muted)" />
            Since {formatSince(user?.joinDate)}
          </span>
        </div>
      </div>

      <div className="avatar-card-divider" />

      <div className="avatar-card-portfolio">
        <div>
          <span className="avatar-card-balance">{(Number(balance) || 0).toFixed(6)} TON</span>
          <span className="avatar-card-balance-label">Portfolio Value</span>
        </div>
        {today > 0 && <span className="avatar-card-profit">+{today.toFixed(3)} today</span>}
      </div>

      <div className="avatar-card-metrics">
        <div className="avatar-card-metric">
          <span className="avatar-card-metric-value profit">{earned.toFixed(3)} TON</span>
          <span className="avatar-card-metric-label">Profit Earned</span>
        </div>
        <div className="avatar-card-metric">
          <span className="avatar-card-metric-value team">{teamCount}</span>
          <span className="avatar-card-metric-label">Referred Users</span>
        </div>
      </div>
    </div>
  )
}

export default AvatarCard
