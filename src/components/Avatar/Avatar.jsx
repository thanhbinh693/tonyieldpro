import React, { useState } from 'react'
import './Avatar.css'

function getInitials(name) {
  return String(name || '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getAvatarClass(seed) {
  const idx = String(seed || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 5
  return `avatar-tone-${idx}`
}

export function Avatar({ src, name, username, size = 40, showStatus = false, glowing = false }) {
  const [imgError, setImgError] = useState(false)
  const label = name || username || '?'
  const initials = getInitials(label)

  return (
    <div className={`avatar-wrapper ${glowing ? 'avatar-glowing' : ''}`} style={{ width: size, height: size }}>
      {src && !imgError ? (
        <img src={src} alt={label} className="avatar-img" onError={() => setImgError(true)} />
      ) : (
        <div className={`avatar-initials ${getAvatarClass(label)}`} style={{ fontSize: size * 0.36 }}>
          {initials}
        </div>
      )}
      {showStatus && <span className="avatar-status-dot" />}
    </div>
  )
}

export default Avatar
