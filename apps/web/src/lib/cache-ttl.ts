/**
 * Prompt-cache lifetime helpers.
 *
 * Anthropic's prompt cache has a 5-minute and a 1-hour lifetime. The server
 * reports the lifetime of the session's latest cache write as
 * `cacheTtlSeconds` (3600 or 300; null when unknown). The countdown starts
 * from the latest cache read or write (`lastCacheHitAt`), since a read
 * refreshes the entry's lifetime.
 */

/** Default prompt-cache TTL in seconds (5 minutes), used when unknown. */
export const DEFAULT_CACHE_TTL_SECONDS = 300

/** The TTL to count down from: the server's value, or 5 minutes. */
export function effectiveCacheTtl(cacheTtlSeconds: number | null | undefined): number {
  return cacheTtlSeconds != null && cacheTtlSeconds > 0
    ? cacheTtlSeconds
    : DEFAULT_CACHE_TTL_SECONDS
}

/** Seconds left before the cache expires (0 when expired or no cache activity). */
export function cacheRemainingSeconds(
  lastCacheHitAt: number | null | undefined,
  cacheTtlSeconds: number | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  if (lastCacheHitAt == null || lastCacheHitAt <= 0) return 0
  const elapsed = nowSeconds - lastCacheHitAt
  return Math.max(0, effectiveCacheTtl(cacheTtlSeconds) - elapsed)
}

/** Short label for the TTL, e.g. "1h" or "5m". */
export function formatCacheTtl(cacheTtlSeconds: number | null | undefined): string {
  const ttl = effectiveCacheTtl(cacheTtlSeconds)
  return ttl % 3600 === 0 ? `${ttl / 3600}h` : `${Math.round(ttl / 60)}m`
}

/** "41:20" style label for seconds left (m:ss, or h:mm:ss from an hour). */
export function formatCacheRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = (s % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Tailwind text colour for a cache countdown: green, amber under 60%, red under 20%. */
export function cacheRemainingTextColor(remaining: number, ttl: number): string {
  if (remaining <= 0) return 'text-gray-400 dark:text-gray-500'
  const f = remaining / ttl
  if (f < 0.2) return 'text-red-500 dark:text-red-400'
  if (f < 0.6) return 'text-amber-600 dark:text-amber-400'
  return 'text-green-600 dark:text-green-400'
}
