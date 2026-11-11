import { describe, expect, it } from 'vitest'
import { cacheRemainingTextColor, formatCacheRemaining } from './cache-ttl'

describe('formatCacheRemaining', () => {
  it('uses m:ss under an hour and h:mm:ss from an hour', () => {
    expect(formatCacheRemaining(0)).toBe('0:00')
    expect(formatCacheRemaining(65)).toBe('1:05')
    expect(formatCacheRemaining(2480)).toBe('41:20')
    expect(formatCacheRemaining(3600)).toBe('1:00:00')
    expect(formatCacheRemaining(-5)).toBe('0:00')
  })
})

describe('cacheRemainingTextColor', () => {
  it('goes green, amber, red, grey as the cache runs down', () => {
    expect(cacheRemainingTextColor(3000, 3600)).toContain('green')
    expect(cacheRemainingTextColor(1800, 3600)).toContain('amber')
    expect(cacheRemainingTextColor(300, 3600)).toContain('red')
    expect(cacheRemainingTextColor(0, 3600)).toContain('gray')
  })
})
