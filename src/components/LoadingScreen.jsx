import React from 'react'
import { Shield, Wrench } from 'lucide-react'
import './LoadingScreen.css'

export default function LoadingScreen({ mode = 'loading' }) {
  const isMaintenance = mode === 'maintenance'
  const Icon = isMaintenance ? Wrench : Shield

  return (
    <div className={`loading-screen ${isMaintenance ? 'maintenance' : ''}`}>
      <div className="loading-grid" />
      <div className="loading-orb" />
      <div className="loading-core">
        <div className="loading-logo-node">
          <Icon size={isMaintenance ? 48 : 32} color="var(--color-ton)" />
        </div>
        {isMaintenance ? (
          <>
            <div className="loading-title">SCHEDULED MAINTENANCE</div>
            <div className="loading-subtitle maintenance-copy">
              <span>The system is temporarily unavailable.</span>
              <span>Operations will resume shortly.</span>
            </div>
          </>
        ) : (
          <>
            <div className="loading-word">CONNECTING<span className="dot-loader" /></div>
            <div className="loading-subtitle">syncing blockchain state</div>
          </>
        )}
      </div>
    </div>
  )
}
