import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

const INIT_DATA_CACHE_KEY = 'tonyield_tg_init_data'

export function getTelegramInitData() {
  try {
    const liveInitData = window.Telegram?.WebApp?.initData || ''
    if (liveInitData) {
      sessionStorage.setItem(INIT_DATA_CACHE_KEY, liveInitData)
      return liveInitData
    }

    return sessionStorage.getItem(INIT_DATA_CACHE_KEY) || ''
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
      'apikey': SUPABASE_ANON_KEY,
      'x-telegram-init-data': getTelegramInitData(),
    },
    body: JSON.stringify({ action, payload }),
  })

  const text = await res.text().catch(() => '')
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {}

  if (!res.ok || data?.ok === false) {
    const fallback = res.status === 401
      ? 'Telegram authorization expired. Close and reopen the Mini App, then retry.'
      : `Secure API failed (${res.status})`
    throw new Error(data?.error || text || fallback)
  }
  return data
}
