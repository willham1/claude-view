import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubAgentInfo } from '../types/generated/SubAgentInfo'
import {
  type SubAgentContext,
  subAgentCostUsd,
  useSubAgentContext,
  withTranscriptCosts,
} from './use-subagent-context'

describe('sub-agent cost from transcripts', () => {
  const agent = (o: Partial<SubAgentInfo>): SubAgentInfo => ({
    toolUseId: 't1',
    agentType: 'general',
    description: 'made-up',
    status: 'complete',
    startedAt: 0,
    ...o,
  })
  const ctx = (o: Partial<SubAgentContext>): SubAgentContext => ({
    agentId: 'a1',
    requestCount: 1,
    startContextTokens: 1,
    currentContextTokens: 1,
    peakContextTokens: 1,
    ...o,
  })

  it('prefers the transcript cost, then the parent-reported cost, else null', () => {
    expect(subAgentCostUsd(agent({ agentId: 'a1', costUsd: null }), [ctx({ costUsd: 2 })])).toBe(2)
    expect(subAgentCostUsd(agent({ agentId: 'a1', costUsd: 0.4 }), [ctx({})])).toBe(0.4)
    expect(subAgentCostUsd(agent({ agentId: 'zz' }), [ctx({ costUsd: 2 })])).toBeNull()
  })

  it('fills costUsd for background agents so the Overview total is not $0', () => {
    const agents = [
      agent({ agentId: 'a1', toolUseId: 't1' }),
      agent({ agentId: 'a2', toolUseId: 't2' }),
    ]
    const out = withTranscriptCosts(agents, [
      ctx({ agentId: 'a1', costUsd: 1.5 }),
      ctx({ agentId: 'a2', costUsd: 0.25 }),
    ])
    expect(out?.reduce((s, a) => s + (a.costUsd ?? 0), 0)).toBeCloseTo(1.75, 9)
    // No contexts yet: list returned unchanged.
    expect(withTranscriptCosts(agents, undefined)).toBe(agents)
  })
})

describe('useSubAgentContext', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not start a new poll while the previous request is still running', () => {
    // A fetch that never resolves: the first request stays in flight.
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useSubAgentContext('sess-1', true, true, 1000))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('polls again once the previous request has finished', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useSubAgentContext('sess-1', true, true, 1000))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
  it('aborts a stalled request after the timeout so polling resumes', async () => {
    // First request stalls until aborted; later ones succeed.
    let calls = 0
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      calls += 1
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        })
      }
      return Promise.resolve(new Response('[]', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useSubAgentContext('sess-1', true, true, 1000, 3000))
    await vi.advanceTimersByTimeAsync(2500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
