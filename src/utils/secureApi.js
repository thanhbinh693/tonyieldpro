import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

export function getTelegramInitData() {
  try {
    return window.Telegram?.WebApp?.initData || ''
  } catch {
    return ''
  }
}

export async function secureApi(action, payload = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/secure-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-telegram-init-data': getTelegramInitData(),
    },
    body: JSON.stringify({ action, payload }),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Secure API failed (${res.status})`)
  }
  return data
}
