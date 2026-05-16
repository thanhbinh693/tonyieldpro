import React, { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import './Toast.css'

export default function Toast({ msg, type }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])
  return (
    <div className={`toast ${type} ${visible ? 'in' : ''}`}>
      <span className="toast-icon">
        {type === 'ok'
          ? <CheckCircle2 size={16} color="var(--color-gold)" />
          : <XCircle size={16} color="var(--color-loss)" />}
      </span>
      <span>{msg}</span>
    </div>
  )
}
