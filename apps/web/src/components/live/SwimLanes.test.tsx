import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { type SubAgentContext, findSubAgentContext } from '../../hooks/use-subagent-context'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'
import {
  SubAgentCacheTimer,
  SubAgentContextRow,
  SwimLanes,
  subAgentModelLabel,
  subAgentWindowSize,
} from './SwimLanes'

// Helper to create minimal SubAgentInfo fixture
function makeSubAgent(overrides?: Partial<SubAgentInfo>): SubAgentInfo {
  return {
    toolUseId: 'toolu_123',
    agentType: 'test',
    description: 'Test agent',
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    costUsd: null,
    durationMs: null,
    toolUseCount: null,
    agentId: null,
    ...overrides,
  }
}

describe('SwimLanes', () => {
  describe('empty state', () => {
    it('returns null when no sub-agents', () => {
      const { container } = render(<SwimLanes subAgents={[]} sessionActive={true} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('rendering sub-agents', () => {
    it('renders a single running agent', () => {
      const agent = makeSubAgent({
        agentType: 'search',
        description: 'Searching for files',
      })
      render(<SwimLanes subAgents={[agent]} sessionActive={true} />)

      expect(screen.getByText('search')).toBeInTheDocument()
      expect(screen.getByText('Searching for files')).toBeInTheDocument()
    })

    it('renders multiple agents', () => {
      const agents = [
        makeSubAgent({
          toolUseId: '1',
          agentType: 'search',
          description: 'Agent 1',
        }),
        makeSubAgent({
          toolUseId: '2',
          agentType: 'edit',
          description: 'Agent 2',
        }),
      ]
      render(<SwimLanes subAgents={agents} sessionActive={true} />)

      expect(screen.getByText('search')).toBeInTheDocument()
      expect(screen.getByText('edit')).toBeInTheDocument()
      expect(screen.getByText('Agent 1')).toBeInTheDocument()
      expect(screen.getByText('Agent 2')).toBeInTheDocument()
    })

    it('shows ERR indicator for error status', () => {
      const agent = makeSubAgent({
        status: 'error',
        completedAt: Date.now(),
      })
      render(<SwimLanes subAgents={[agent]} sessionActive={false} />)

      expect(screen.getByText('ERR')).toBeInTheDocument()
    })

    it('shows metrics inline for completed agents', () => {
      const agent = makeSubAgent({
        status: 'complete',
        completedAt: Date.now(),
        costUsd: 0.0342,
        durationMs: 5000,
        toolUseCount: 3,
        agentId: 'agent-123',
      })
      render(<SwimLanes subAgents={[agent]} sessionActive={false} />)

      // Row cost (the header total also reads $0.03 with one agent).
      expect(screen.getByTestId('subagent-cost').textContent).toBe('$0.03')
      expect(screen.getByTestId('subagent-cost-total').textContent).toContain('$0.03')
      expect(screen.getByText('5s')).toBeInTheDocument()
      expect(screen.getByText('3 tool calls')).toBeInTheDocument()
    })

    it('handles singular tool call count', () => {
      const agent = makeSubAgent({
        status: 'complete',
        completedAt: Date.now(),
        toolUseCount: 1,
      })
      render(<SwimLanes subAgents={[agent]} sessionActive={false} />)

      expect(screen.getByText('1 tool call')).toBeInTheDocument()
    })
  })

  describe('drill-down click', () => {
    it('calls onDrillDown when clicking a row with agentId', async () => {
      const user = userEvent.setup()
      const onDrillDown = vi.fn()
      const agent = makeSubAgent({
        status: 'complete',
        completedAt: Date.now(),
        agentId: 'agent-abc',
        agentType: 'search',
        description: 'Find files',
      })
      render(<SwimLanes subAgents={[agent]} onDrillDown={onDrillDown} />)

      await user.click(screen.getByText('Find files'))
      expect(onDrillDown).toHaveBeenCalledWith('agent-abc', 'search', 'Find files')
    })

    it('does not call onDrillDown when agent has no agentId', async () => {
      const user = userEvent.setup()
      const onDrillDown = vi.fn()
      const agent = makeSubAgent({
        status: 'running',
        agentId: null,
        description: 'Still starting',
      })
      render(<SwimLanes subAgents={[agent]} onDrillDown={onDrillDown} />)

      await user.click(screen.getByText('Still starting'))
      expect(onDrillDown).not.toHaveBeenCalled()
    })

    it('calls onDrillDown for running agents with agentId', async () => {
      const user = userEvent.setup()
      const onDrillDown = vi.fn()
      const agent = makeSubAgent({
        status: 'running',
        agentId: 'agent-live',
        agentType: 'explore',
        description: 'Exploring codebase',
      })
      render(<SwimLanes subAgents={[agent]} onDrillDown={onDrillDown} />)

      await user.click(screen.getByText('Exploring codebase'))
      expect(onDrillDown).toHaveBeenCalledWith('agent-live', 'explore', 'Exploring codebase')
    })
  })

  describe('sorting', () => {
    it('sorts running agents before completed', () => {
      const agents = [
        makeSubAgent({
          toolUseId: '1',
          status: 'complete',
          completedAt: Date.now(),
          description: 'Completed first',
        }),
        makeSubAgent({
          toolUseId: '2',
          status: 'running',
          startedAt: Date.now(),
          description: 'Running second',
        }),
      ]
      render(<SwimLanes subAgents={agents} sessionActive={true} />)

      const descriptions = screen.getAllByText(/Completed first|Running second/)
      expect(descriptions[0]).toHaveTextContent('Running second')
      expect(descriptions[1]).toHaveTextContent('Completed first')
    })

    it('sorts completed agents by completedAt desc', () => {
      const now = Date.now()
      const agents = [
        makeSubAgent({
          toolUseId: '1',
          status: 'complete',
          completedAt: now - 2000,
          description: 'Older',
        }),
        makeSubAgent({
          toolUseId: '2',
          status: 'complete',
          completedAt: now,
          description: 'Newer',
        }),
      ]
      render(<SwimLanes subAgents={agents} sessionActive={false} />)

      const descriptions = screen.getAllByText(/Older|Newer/)
      expect(descriptions[0]).toHaveTextContent('Newer')
      expect(descriptions[1]).toHaveTextContent('Older')
    })

    it('sorts running agents by startedAt asc', () => {
      const now = Date.now()
      const agents = [
        makeSubAgent({
          toolUseId: '1',
          status: 'running',
          startedAt: now,
          description: 'Started later',
        }),
        makeSubAgent({
          toolUseId: '2',
          status: 'running',
          startedAt: now - 2000,
          description: 'Started earlier',
        }),
      ]
      render(<SwimLanes subAgents={agents} sessionActive={true} />)

      const descriptions = screen.getAllByText(/Started earlier|Started later/)
      expect(descriptions[0]).toHaveTextContent('Started earlier')
      expect(descriptions[1]).toHaveTextContent('Started later')
    })
  })

  describe('sessionActive prop', () => {
    it('accepts sessionActive=true with running agents', () => {
      const agent = makeSubAgent({ status: 'running' })
      render(<SwimLanes subAgents={[agent]} sessionActive={true} />)

      expect(screen.getByText('Test agent')).toBeInTheDocument()
    })

    it('accepts sessionActive=false with completed agents', () => {
      const agent = makeSubAgent({
        status: 'complete',
        completedAt: Date.now(),
      })
      render(<SwimLanes subAgents={[agent]} sessionActive={false} />)

      expect(screen.getByText('Test agent')).toBeInTheDocument()
    })

    it('accepts sessionActive=false with error agents', () => {
      const agent = makeSubAgent({ status: 'error', completedAt: Date.now() })
      render(<SwimLanes subAgents={[agent]} sessionActive={false} />)

      expect(screen.getByText('Test agent')).toBeInTheDocument()
      expect(screen.getByText('ERR')).toBeInTheDocument()
    })
  })

  describe('scrolling behavior', () => {
    it('has no inner height cap or scroll (the tab scrolls it)', () => {
      const agents = Array.from({ length: 6 }, (_, i) =>
        makeSubAgent({ toolUseId: `${i}`, description: `Agent ${i}` }),
      )
      const { container } = render(<SwimLanes subAgents={agents} sessionActive={true} />)

      const wrapper = container.firstElementChild
      expect(wrapper?.className).not.toContain('overflow-y-auto')
      expect(wrapper?.className).not.toContain('max-h-')
    })
  })

  describe('context window', () => {
    const ctx = (overrides?: Partial<SubAgentContext>): SubAgentContext => ({
      agentId: 'abc1',
      toolUseId: 'toolu_spawn',
      model: 'claude-test-1',
      requestCount: 4,
      startContextTokens: 9_200,
      currentContextTokens: 41_000,
      peakContextTokens: 45_500,
      ...overrides,
    })

    it('shows start, now and peak for a finished agent matched by agentId', () => {
      const agent = makeSubAgent({
        status: 'complete',
        agentId: 'abc1',
        toolUseId: 'other',
      })
      render(<SwimLanes subAgents={[agent]} contexts={[ctx()]} />)
      const row = screen.getByTestId('subagent-context')
      expect(row.textContent).toContain('start 9.2k')
      expect(row.textContent).toContain('now 41.0k')
      expect(row.textContent).toContain('peak 45.5k')
      expect(row.textContent).toContain('4 reqs')
      // Window from the same lookup as the main Context Window panel.
      expect(row.textContent).toContain('200.0k')
      expect(row.textContent).toContain('21%')
    })

    it('matches a running agent with no agentId yet by its spawning toolUseId', () => {
      const agent = makeSubAgent({ toolUseId: 'toolu_spawn', agentId: null })
      render(<SwimLanes subAgents={[agent]} contexts={[ctx({ agentId: 'zzz' })]} />)
      expect(screen.getByTestId('subagent-context').textContent).toContain('now 41.0k')
    })

    it('uses a 1M window when the transcript model carries the [1m] marker', () => {
      const agent = makeSubAgent({ agentId: 'abc1' })
      render(
        <SwimLanes
          subAgents={[agent]}
          contexts={[
            ctx({
              model: 'claude-test-1[1m]',
              currentContextTokens: 170_000,
              peakContextTokens: 170_000,
            }),
          ]}
        />,
      )
      const text = screen.getByTestId('subagent-context').textContent ?? ''
      expect(text).toContain('1.0M')
      expect(text).toContain('17%')
      expect(text).not.toContain('85%')
    })

    it('shows the model and effort level at the start of the context line', () => {
      const agent = makeSubAgent({ agentId: 'abc1' })
      render(
        <SwimLanes
          subAgents={[agent]}
          contexts={[ctx({ model: 'claude-fable-5-2', effort: 'high' })]}
        />,
      )
      expect(screen.getByTestId('subagent-model').textContent).toBe('Fable 5.2')
      expect(screen.getByTestId('subagent-effort').textContent).toBe('high effort')
      const text = screen.getByTestId('subagent-context').textContent ?? ''
      expect(text.indexOf('Fable 5.2')).toBeLessThan(text.indexOf('ctx'))
    })

    it('leaves out effort when the transcript does not record it', () => {
      const agent = makeSubAgent({ agentId: 'abc1' })
      render(<SwimLanes subAgents={[agent]} contexts={[ctx({ model: 'claude-opus-5-5' })]} />)
      expect(screen.getByTestId('subagent-model').textContent).toBe('Opus 5.5')
      expect(screen.queryByTestId('subagent-effort')).toBeNull()
    })

    it('subAgentModelLabel shortens ids and drops the [1m] marker', () => {
      expect(subAgentModelLabel('claude-opus-5-5')).toBe('Opus 5.5')
      expect(subAgentModelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
      expect(subAgentModelLabel('claude-opus-4-8[1m]')).toBe('Opus 4.8')
      expect(subAgentModelLabel('gpt-made-up')).toBe('gpt-made-up')
      expect(subAgentModelLabel(undefined)).toBeNull()
      expect(subAgentModelLabel('')).toBeNull()
    })

    it('shows tokens without % when no model (so no window) is known', () => {
      const agent = makeSubAgent({ agentId: 'abc1' })
      render(<SwimLanes subAgents={[agent]} contexts={[ctx({ model: undefined })]} />)
      const text = screen.getByTestId('subagent-context').textContent ?? ''
      expect(text).toContain('now 41.0k')
      expect(text).not.toContain('%')
    })

    it('subAgentWindowSize follows the main panel lookup', () => {
      expect(subAgentWindowSize(ctx())).toBe(200_000)
      expect(subAgentWindowSize(ctx({ model: 'x-context-1m' }))).toBe(1_000_000)
      expect(subAgentWindowSize(ctx({ peakContextTokens: 250_000 }))).toBe(1_000_000)
      expect(subAgentWindowSize(ctx({ model: undefined }))).toBeNull()
    })

    it('shows a bar and percentage when the window size is known', () => {
      render(
        <SubAgentContextRow
          ctx={ctx({
            currentContextTokens: 170_000,
            peakContextTokens: 170_000,
          })}
          windowSize={1_000_000}
        />,
      )
      const text = screen.getByTestId('subagent-context').textContent ?? ''
      expect(text).toContain('1.0M')
      expect(text).toContain('17%')
    })

    it('uses the model window for current models from the first request (no 200k guess)', () => {
      expect(subAgentWindowSize(ctx({ model: 'claude-opus-5-5' }))).toBe(1_000_000)
      expect(subAgentWindowSize(ctx({ model: 'claude-fable-5-2' }))).toBe(1_000_000)
      expect(subAgentWindowSize(ctx({ model: 'claude-haiku-5-5' }))).toBe(1_000_000)
      expect(subAgentWindowSize(ctx({ model: 'claude-sonnet-5-5' }))).toBe(1_000_000)
      const agent = makeSubAgent({ status: 'complete', agentId: 'abc1' })
      render(
        <SwimLanes
          subAgents={[agent]}
          contexts={[ctx({ model: 'claude-opus-5-5', currentContextTokens: 150_000 })]}
        />,
      )
      const text = screen.getByTestId('subagent-context').textContent ?? ''
      expect(text).toContain('1.0M')
      expect(text).toContain('15%')
    })

    it('shows each row cost from the transcript and a total, labelled list price', () => {
      const agents = [
        makeSubAgent({
          status: 'complete',
          agentId: 'abc1',
          toolUseId: 't1',
          costUsd: null,
        }),
        makeSubAgent({ status: 'running', agentId: 'abc2', toolUseId: 't2' }),
      ]
      render(
        <SwimLanes
          subAgents={agents}
          contexts={[
            ctx({ costUsd: 1.25 }),
            ctx({ agentId: 'abc2', toolUseId: 't2', costUsd: 0.5 }),
          ]}
        />,
      )
      const costs = screen.getAllByTestId('subagent-cost').map((e) => e.textContent)
      expect(costs).toContain('$0.50 so far')
      expect(costs.some((c) => c?.startsWith('$1.25'))).toBe(true)
      const total = screen.getByTestId('subagent-cost-total')
      expect(total.textContent).toContain('$1.75')
      expect(total.textContent).toContain('list price')
      expect(total.getAttribute('title')).toContain('List-price equivalent')
    })

    it('shows the cost on an error row too (background agents cut off by session end)', () => {
      const agent = makeSubAgent({
        status: 'error',
        agentId: 'abc1',
        errorReason: 'Session ended',
      })
      render(<SwimLanes subAgents={[agent]} contexts={[ctx({ costUsd: 12.08 })]} />)
      expect(screen.getByTestId('subagent-cost').textContent).toBe('$12.08')
      expect(screen.getByText('Session ended')).toBeInTheDocument()
    })

    it('falls back to the parent-reported cost when the transcript has none', () => {
      const agent = makeSubAgent({
        status: 'complete',
        agentId: 'abc1',
        costUsd: 0.3,
      })
      render(<SwimLanes subAgents={[agent]} contexts={[ctx({ costUsd: undefined })]} />)
      expect(screen.getByTestId('subagent-cost').textContent).toBe('$0.30')
    })

    it('shows nothing when no context is known', () => {
      const agent = makeSubAgent({ agentId: 'abc1' })
      render(<SwimLanes subAgents={[agent]} contexts={[ctx({ requestCount: 0 })]} />)
      expect(screen.queryByTestId('subagent-context')).toBeNull()
    })
  })
})

describe('findSubAgentContext', () => {
  it('prefers agentId and falls back to toolUseId', () => {
    const list: SubAgentContext[] = [
      {
        agentId: 'a',
        toolUseId: 't1',
        requestCount: 1,
        startContextTokens: 1,
        currentContextTokens: 1,
        peakContextTokens: 1,
      },
      {
        agentId: 'b',
        toolUseId: 't2',
        requestCount: 1,
        startContextTokens: 2,
        currentContextTokens: 2,
        peakContextTokens: 2,
      },
    ]
    expect(findSubAgentContext({ agentId: 'b', toolUseId: 't1' }, list)?.agentId).toBe('b')
    expect(findSubAgentContext({ agentId: null, toolUseId: 't1' }, list)?.agentId).toBe('a')
    expect(findSubAgentContext({ agentId: 'x', toolUseId: 'nope' }, list)).toBeUndefined()
    expect(findSubAgentContext({ agentId: 'a', toolUseId: 't1' }, undefined)).toBeUndefined()
  })
})

describe('SubAgentCacheTimer', () => {
  const base: SubAgentContext = {
    agentId: 'a',
    requestCount: 3,
    startContextTokens: 1000,
    currentContextTokens: 2000,
    peakContextTokens: 2000,
  }

  it('counts down a 1h cache from the latest request', () => {
    const now = Math.floor(Date.now() / 1000)
    render(
      <SubAgentCacheTimer ctx={{ ...base, lastActivityAt: now - 600, cacheTtlSeconds: 3600 }} />,
    )
    const text = screen.getByTestId('subagent-cache').textContent ?? ''
    expect(text).toMatch(/cache (50:00|49:5\d) left \(1h\)/)
  })

  it('treats an unknown lifetime as 5 minutes and shows expired', () => {
    const now = Math.floor(Date.now() / 1000)
    render(<SubAgentCacheTimer ctx={{ ...base, lastActivityAt: now - 600 }} />)
    expect(screen.getByTestId('subagent-cache').textContent).toBe('cache expired (5m)')
  })

  it('is part of the context row when the latest request time is known', () => {
    const now = Math.floor(Date.now() / 1000)
    render(<SubAgentContextRow ctx={{ ...base, lastActivityAt: now, cacheTtlSeconds: 300 }} />)
    expect(screen.getByTestId('subagent-context').textContent).toContain('cache 5:00 left (5m)')
  })

  it('is left out when the latest request time is unknown', () => {
    render(<SubAgentContextRow ctx={base} />)
    expect(screen.queryByTestId('subagent-cache')).toBeNull()
  })
})
