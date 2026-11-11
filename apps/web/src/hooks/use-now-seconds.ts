import { useEffect, useState } from 'react'

/** Current unix time in seconds, updated every `intervalMs` while `enabled`. */
export function useNowSeconds(enabled = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!enabled) return
    setNow(Math.floor(Date.now() / 1000))
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])
  return now
}
