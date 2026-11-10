import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSubAgentContext } from './use-subagent-context'

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
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
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
