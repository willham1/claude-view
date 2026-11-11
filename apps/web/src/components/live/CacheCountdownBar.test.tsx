import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheRemainingSeconds, effectiveCacheTtl, formatCacheTtl } from '../../lib/cache-ttl'
import { CacheCountdownBar } from './CacheCountdownBar'

const NOW = 1_800_000_000

describe('cache-ttl helpers', () => {
  it('defaults to 5 minutes when the TTL is unknown', () => {
    expect(effectiveCacheTtl(null)).toBe(300)
    expect(effectiveCacheTtl(undefined)).toBe(300)
    expect(effectiveCacheTtl(0)).toBe(300)
    expect(effectiveCacheTtl(3600)).toBe(3600)
  })

  it('counts down from the latest cache hit', () => {
    expect(cacheRemainingSeconds(NOW - 600, 3600, NOW)).toBe(3000)
    expect(cacheRemainingSeconds(NOW - 600, 300, NOW)).toBe(0)
    expect(cacheRemainingSeconds(NOW - 60, null, NOW)).toBe(240)
    expect(cacheRemainingSeconds(null, 3600, NOW)).toBe(0)
  })

  it('labels the TTL', () => {
    expect(formatCacheTtl(3600)).toBe('1h')
    expect(formatCacheTtl(300)).toBe('5m')
    expect(formatCacheTtl(null)).toBe('5m')
  })
})

describe('CacheCountdownBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW * 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a 1-hour cache as warm 10 minutes after the last hit', () => {
    render(
      <CacheCountdownBar lastCacheHitAt={NOW - 600} cacheStatus="warm" cacheTtlSeconds={3600} />,
    )
    expect(screen.getByText('50:00')).toBeInTheDocument()
    expect(screen.getByText('83% remaining')).toBeInTheDocument()
    expect(screen.getByText(/Cache warm \(1h TTL\)/)).toBeInTheDocument()
  })

  it('shows a 5-minute cache as expired 10 minutes after the last hit', () => {
    render(
      <CacheCountdownBar lastCacheHitAt={NOW - 600} cacheStatus="cold" cacheTtlSeconds={300} />,
    )
    expect(screen.getByText('expired')).toBeInTheDocument()
    expect(screen.getByText(/Cache expired \(5m TTL\)/)).toBeInTheDocument()
  })

  it('falls back to 5 minutes when the TTL is unknown', () => {
    render(<CacheCountdownBar lastCacheHitAt={NOW - 60} cacheStatus="warm" />)
    expect(screen.getByText('4:00')).toBeInTheDocument()
  })
})
