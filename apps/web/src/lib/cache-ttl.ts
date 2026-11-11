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
