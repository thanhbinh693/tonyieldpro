import React from 'react'
import { Home, Layers, User } from 'lucide-react'
import './BottomNav.css'

export default function BottomNav({ tab, setTab }) {
  const tabs = [
    { id: 'home', label: 'HOME', Icon: Home },
    { id: 'plans', label: 'MARKETS', Icon: Layers },
    { id: 'profile', label: 'ACCOUNT', Icon: User },
  ]

  return (
    <nav className="bnav">
      {tabs.map(t => (
        <div key={t.id} className={`ni ${tab===t.id?'on':''}`} onClick={() => setTab(t.id)}>
          <div className="ni-ico">
            <t.Icon size={20} color={tab === t.id ? 'var(--color-ton)' : 'var(--color-muted)'} />
          </div>
          <span className="ni-lbl">{t.label}</span>
          {tab === t.id && <div className="ni-active-dot"/>}
        </div>
      ))}
    </nav>
  )
}
