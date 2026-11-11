import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'
import { SessionGlanceStrip } from './SessionGlanceStrip'

function agent(status: SubAgentInfo['status'], id: string): SubAgentInfo {
  return {
    toolUseId: id,
    agentType: 'builder',
    description: id,
    status,
    startedAt: 1,
    completedAt: null,
    costUsd: null,
    durationMs: null,
    toolUseCount: null,
    agentId: null,
  }
}

const now = () => Math.floor(Date.now() / 1000)

describe('SessionGlanceStrip', () => {
  const data = {
    lastCacheHitAt: 0,
    cacheStatus: 'warm' as const,
    cacheTtlSeconds: 3600,
    contextWindowTokens: 212_600,
    model: 'claude-opus-5-5',
    statuslineUsedPct: null,
    statuslineContextWindowSize: null,
    turnCount: 72,
  }

  it('shows the main cache countdown, context and helper counts', () => {
    render(
      <SessionGlanceStrip
        data={{ ...data, lastCacheHitAt: now() - 60 }}
        subAgents={[agent('running', 'a'), agent('complete', 'b'), agent('error', 'c')]}
        isLive
      />,
    )
    const text = screen.getByTestId('session-glance').textContent ?? ''
    expect(screen.getByTestId('session-glance-cache').textContent).toMatch(
      /cache 5[89]:\d\d left \(\s*1h\)/,
    )
    expect(text).toContain('ctx 212.6k / 1.0M 21%')
    expect(text).toContain('72 turns')
    expect(text).toContain('1 running, 1 done, 1 failed')
  })

  it('shows expired once the lifetime has passed', () => {
    render(
      <SessionGlanceStrip
        data={{ ...data, lastCacheHitAt: now() - 4000 }}
        subAgents={[agent('complete', 'a')]}
        isLive
      />,
    )
    expect(screen.getByTestId('session-glance-cache').textContent).toContain('cache expired')
  })

  it('has no cache timer for a session that is not live', () => {
    render(
      <SessionGlanceStrip
        data={{ ...data, lastCacheHitAt: now() }}
        subAgents={[agent('complete', 'a')]}
        isLive={false}
      />,
    )
    expect(screen.queryByTestId('session-glance-cache')).toBeNull()
  })
})
