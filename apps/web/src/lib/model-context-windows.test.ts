import { describe, expect, it } from 'vitest'
import {
  AUTOCOMPACT_RESERVE_TOKENS,
  autocompactThresholdPct,
  getContextLimit,
  knownContextWindow,
} from './model-context-windows'

describe('getContextLimit', () => {
  describe('200K default — fill within normal range', () => {
    it('returns 200K when no args provided', () => {
      expect(getContextLimit()).toBe(200_000)
    })

    it('returns 200K for a known model with no fill', () => {
      expect(getContextLimit('claude-sonnet-4-6')).toBe(200_000)
    })

    it('returns 200K when fill is exactly 200K (boundary)', () => {
      expect(getContextLimit('claude-sonnet-4-6', 200_000)).toBe(200_000)
    })

    it('returns 200K when fill is just under 200K', () => {
      expect(getContextLimit('claude-sonnet-4-6', 199_999)).toBe(200_000)
    })

    it('returns 200K for unknown model with low fill', () => {
      expect(getContextLimit('unknown-model-xyz', 50_000)).toBe(200_000)
    })
  })

  describe('1M inference — fill exceeds 200K', () => {
    it('returns 1M when fill exceeds 200K (regression: 1M session bug)', () => {
      expect(getContextLimit('claude-sonnet-4-6', 200_001)).toBe(1_000_000)
    })

    it('returns 1M when fill is 250K (typical mid-session 1M usage)', () => {
      expect(getContextLimit('claude-sonnet-4-6', 250_000)).toBe(1_000_000)
    })

    it('returns 1M when fill is exactly 1M (full 1M context)', () => {
      expect(getContextLimit('claude-opus-4-6', 1_000_000)).toBe(1_000_000)
    })

    it('returns 1M regardless of model name when fill > 200K', () => {
      expect(getContextLimit('claude-haiku-4-5', 300_000)).toBe(1_000_000)
      expect(getContextLimit(null, 300_000)).toBe(1_000_000)
      expect(getContextLimit(undefined, 300_000)).toBe(1_000_000)
    })
  })

  describe('statuslineSize — authoritative value takes precedence', () => {
    it('returns 1M when statuslineSize is 1_000_000', () => {
      expect(getContextLimit(undefined, undefined, 1_000_000)).toBe(1_000_000)
    })

    it('statuslineSize takes precedence over currentFill > 200K', () => {
      expect(getContextLimit('claude-sonnet-4-6', 250_000, 200_000)).toBe(200_000)
    })

    it('statuslineSize=0 falls through to fill-based logic', () => {
      expect(getContextLimit('claude-sonnet-4-6', 250_000, 0)).toBe(1_000_000)
    })

    it('statuslineSize=null falls through to fill-based logic', () => {
      expect(getContextLimit('claude-sonnet-4-6', 250_000, null)).toBe(1_000_000)
    })

    it('statuslineSize=undefined falls through to fill-based logic', () => {
      expect(getContextLimit('claude-sonnet-4-6', 250_000, undefined)).toBe(1_000_000)
    })

    it('returns statuslineSize even with low fill', () => {
      expect(getContextLimit('claude-sonnet-4-6', 50_000, 1_000_000)).toBe(1_000_000)
    })
  })

  describe('usedPct never exceeds 100% — the visible regression', () => {
    it('usedPct stays ≤ 100% for a 250K-fill 1M session', () => {
      const fill = 250_000
      const limit = getContextLimit('claude-sonnet-4-6', fill)
      const usedPct = Math.min((fill / limit) * 100, 100)
      expect(usedPct).toBeLessThanOrEqual(100)
      expect(usedPct).toBeCloseTo(25, 0)
    })

    it('usedPct is correct for a normal 80K-fill 200K session', () => {
      const fill = 80_000
      const limit = getContextLimit('claude-sonnet-4-6', fill)
      const usedPct = (fill / limit) * 100
      expect(usedPct).toBe(40)
    })
  })
})

describe('model windows from Claude Code model table', () => {
  it('gives 1M from the first request for the current models', () => {
    for (const m of [
      'claude-opus-5-5',
      'claude-fable-5-2',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]) {
      expect(getContextLimit(m, 10_000)).toBe(1_000_000)
      expect(knownContextWindow(m)).toBe(1_000_000)
    }
  })

  it('normalises provider prefixes, dates and [1m] tags', () => {
    expect(knownContextWindow('us.anthropic.claude-opus-5-5-v1:0')).toBe(1_000_000)
    expect(knownContextWindow('claude-opus-5-5[1m]')).toBe(1_000_000)
    expect(knownContextWindow('claude-opus-5-5-20261001')).toBe(1_000_000)
  })

  it('does not confuse claude-opus-5 with an unknown longer id', () => {
    expect(knownContextWindow('claude-opus-5-9')).toBeNull()
    expect(getContextLimit('claude-opus-5-9', 10_000)).toBe(200_000)
  })

  it('keeps the 200k default (and fill guess) for 200k-window models', () => {
    expect(knownContextWindow('claude-sonnet-4-6')).toBeNull()
    expect(getContextLimit('claude-sonnet-4-6', 10_000)).toBe(200_000)
    expect(getContextLimit('claude-sonnet-4-6[1m]', 10_000)).toBe(1_000_000)
  })

  it('statusline size still wins over the table', () => {
    expect(getContextLimit('claude-opus-5-5', 10_000, 200_000)).toBe(200_000)
  })
})

describe('autocompact threshold', () => {
  it('is window minus 33k: 96.7% of 1M, 83.5% of 200k', () => {
    expect(AUTOCOMPACT_RESERVE_TOKENS).toBe(33_000)
    expect(autocompactThresholdPct(1_000_000)).toBeCloseTo(96.7, 5)
    expect(Math.round(autocompactThresholdPct(1_000_000))).toBe(97)
    expect(autocompactThresholdPct(200_000)).toBeCloseTo(83.5, 5)
  })
})
