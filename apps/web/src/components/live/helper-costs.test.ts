import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'
import {
  helperCostIds,
  helperCostUsd,
  projectCostWithHelpers,
  sessionCostWithHelpers,
  useHelperCostPolling,
  useHelperCostStore,
} from './helper-costs'
import type { LiveSession } from './use-live-sessions'

function agent(over: Partial<SubAgentInfo>): SubAgentInfo {
  return {
    toolUseId: 'toolu_x',
    agentType: 'builder',
    description: 'x',
    status: 'complete',
    startedAt: 1,
    ...over,
  } as SubAgentInfo
}

function session(id: string, totalUsd: number, subAgents: SubAgentInfo[] = []): LiveSession {
  return { id, cost: { totalUsd }, subAgents, teamName: null } as unknown as LiveSession
}

describe('helperCostUsd', () => {
  it('prices each helper from its transcript, else the parent-reported cost', () => {
    const agents = [
      agent({ agentId: 'a1', toolUseId: 't1', costUsd: 1 }),
      agent({ toolUseId: 't2' }),
      agent({ agentId: 'c3', toolUseId: 't3', costUsd: 0.25 }),
    ]
    const costs = [
      { agentId: 'a1', costUsd: 5 },
      { agentId: 'b2', toolUseId: 't2', costUsd: 2 },
      { agentId: 'zz', costUsd: 100 }, // not one of the session's helpers
    ]
    expect(helperCostUsd(agents, costs)).toBeCloseTo(5 + 2 + 0.25)
    expect(helperCostUsd(agents, undefined)).toBeCloseTo(1.25)
  })

  it('counts team sidechains instead of helpers, never both', () => {
    const agents = [agent({ agentId: 'a1', costUsd: 1 })]
    expect(helperCostUsd(agents, [{ agentId: 'a1', costUsd: 5 }], [{ costUsd: 3 }, {}])).toBe(3)
    expect(helperCostUsd(agents, [{ agentId: 'a1', costUsd: 5 }], [])).toBe(5)
  })
})

describe('sessionCostWithHelpers / projectCostWithHelpers', () => {
  it('adds helpers to the main session, and a group sums its cards', () => {
    const withHelpers = session('s1', 8.02, [agent({ agentId: 'a1' })])
    const without = session('s2', 1.5)
    const costs = { s1: [{ agentId: 'a1', costUsd: 138.57 }] }
    expect(sessionCostWithHelpers(withHelpers, costs.s1)).toBeCloseTo(146.59)
    expect(sessionCostWithHelpers(without, undefined)).toBe(1.5)
    const project = { branches: [{ sessions: [withHelpers] }, { sessions: [without] }] }
    expect(projectCostWithHelpers(project, costs, {})).toBeCloseTo(148.09)
  })

  it('asks only for sessions that have helpers', () => {
    expect(
      helperCostIds([session('b', 0, [agent({})]), session('c', 0), session('a', 0, [agent({})])]),
    ).toEqual(['a', 'b'])
  })
})

describe('useHelperCostPolling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useHelperCostStore.setState({ costs: {}, sidechains: {} })
  })

  it('fetches every session with helpers in one request and fills the store', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ s1: [{ agentId: 'a1', costUsd: 2 }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const qc = new QueryClient()
    const sessions = [
      session('s1', 1, [agent({ agentId: 'a1' })]),
      session('s3', 1, [agent({})]),
      session('s2', 1),
    ]
    renderHook(() => useHelperCostPolling(sessions, 60_000), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client: qc }, children),
    })
    await waitFor(() => expect(useHelperCostStore.getState().costs.s1?.[0].costUsd).toBe(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sessions/subagents/costs?ids=s1%2Cs3')
  })
})
