export const DAY_MS = 86_400_000

export function calculateIntervalProfit(amount, dailyRate, intervalMs) {
  const principal = Number(amount) || 0
  const rate = Number(dailyRate) || 0
  const interval = Number(intervalMs) || DAY_MS
  return principal * (rate / 100) * (interval / DAY_MS)
}
