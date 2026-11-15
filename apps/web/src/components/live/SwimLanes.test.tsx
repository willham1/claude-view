import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { type SubAgentContext, findSubAgentContext } from '../../hooks/use-subagent-context'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'
import {
  SubAgentCacheTimer,
  SubAgentContextRow,
  SwimLanes,
  agentTypeColor,
  subAgentActivity,
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

      await user.click(screen.getByTestId('subagent-row'))
      expect(onDrillDown).toHaveBeenCalledWith('agent-abc', 'search', 'Find files')
    })

    it('opens from the Open button', async () => {
      const user = userEvent.setup()
      const onDrillDown = vi.fn()
      const agent = makeSubAgent({
        agentId: 'agent-abc',
        agentType: 'search',
        description: 'Find files',
      })
      render(<SwimLanes subAgents={[agent]} onDrillDown={onDrillDown} />)

      await user.click(screen.getByRole('button', { name: /Open search: Find files/ }))
      expect(onDrillDown).toHaveBeenCalledTimes(1)
    })

    it('clicking the task title does not open the helper (so it can be selected and copied)', async () => {
      const user = userEvent.setup()
      const onDrillDown = vi.fn()
      const agent = makeSubAgent({ agentId: 'agent-abc', description: 'Copy me' })
      render(<SwimLanes subAgents={[agent]} onDrillDown={onDrillDown} />)

      const title = screen.getByTestId('subagent-title')
      expect(title.className).toContain('select-text')
      await user.click(title)
      await user.dblClick(title)
      expect(onDrillDown).not.toHaveBeenCalled()
    })

    it('a click that ends a text selection does not open the helper', () => {
      const onDrillDown = vi.fn()
      const agent = makeSubAgent({ agentId: 'agent-abc', description: 'Copy me' })
      render(<SwimLanes subAgents={[agent]} onDrillDown={onDrillDown} />)

      const range = document.createRange()
      range.selectNodeContents(screen.getByTestId('subagent-title'))
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      screen.getByTestId('subagent-row').click()
      expect(onDrillDown).not.toHaveBeenCalled()
      window.getSelection()?.removeAllRanges()
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

      await user.click(screen.getByTestId('subagent-row'))
      expect(screen.queryByRole('button', { name: /Open/ })).toBeNull()
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

      await user.click(screen.getByTestId('subagent-row'))
      expect(onDrillDown).toHaveBeenCalledWith('agent-live', 'explore', 'Exploring codebase')
    })
  })

  describe('sorting', () => {
    // Timestamps are unix seconds, as from the server.
    it('on equal last activity, puts running agents before completed', () => {
      const agents = [
        makeSubAgent({
          toolUseId: '1',
          status: 'complete',
          startedAt: 900,
          completedAt: 1000,
          description: 'Completed first',
        }),
        makeSubAgent({
          toolUseId: '2',
          status: 'running',
          startedAt: 1000,
          description: 'Running second',
        }),
      ]
      render(<SwimLanes subAgents={agents} sessionActive={true} />)

      const descriptions = screen.getAllByText(/Completed first|Running second/)
      expect(descriptions[0]).toHaveTextContent('Running second')
      expect(descriptions[1]).toHaveTextContent('Completed first')
    })

    it('sorts completed agents by completedAt desc', () => {
      const now = 10_000
      const agents = [
        makeSubAgent({
          toolUseId: '1',
          status: 'complete',
          startedAt: 100,
          completedAt: now - 2000,
          description: 'Older',
        }),
        makeSubAgent({
          toolUseId: '2',
          status: 'complete',
          startedAt: 50,
          completedAt: now,
          description: 'Newer',
        }),
      ]
      render(<SwimLanes subAgents={agents} sessionActive={false} />)

      const descriptions = screen.getAllByText(/Older|Newer/)
      expect(descriptions[0]).toHaveTextContent('Newer')
      expect(descriptions[1]).toHaveTextContent('Older')
    })

    it('puts the most recently active helper first, using transcript activity', () => {
      const agents = [
        makeSubAgent({
          toolUseId: '1',
          agentId: 'a1',
          status: 'running',
          startedAt: 100,
          description: 'Started first',
        }),
        makeSubAgent({
          toolUseId: '2',
          agentId: 'a2',
          status: 'running',
          startedAt: 200,
          description: 'Started second',
        }),
      ]
      const ctx = (agentId: string, lastActivityAt: number): SubAgentContext => ({
        agentId,
        requestCount: 1,
        startContextTokens: 1,
        currentContextTokens: 1,
        peakContextTokens: 1,
        lastActivityAt,
      })
      const { rerender } = render(
        <SwimLanes subAgents={agents} contexts={[ctx('a1', 150), ctx('a2', 210)]} />,
      )
      let titles = screen.getAllByTestId('subagent-title')
      expect(titles.map((t) => t.textContent)).toEqual(['Started second', 'Started first'])

      // The first helper does something new: it moves to the top.
      rerender(<SwimLanes subAgents={agents} contexts={[ctx('a1', 300), ctx('a2', 210)]} />)
      titles = screen.getAllByTestId('subagent-title')
      expect(titles.map((t) => t.textContent)).toEqual(['Started first', 'Started second'])
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

describe('subAgentActivity and the progress bar', () => {
  const now = 1_000_000
  const ctx = (lastActivityAt: number): SubAgentContext => ({
    agentId: 'abc1234',
    requestCount: 3,
    startContextTokens: 1000,
    currentContextTokens: 2000,
    peakContextTokens: 2000,
    lastActivityAt,
    cacheTtlSeconds: 3600,
  })

  it('is active within 2 minutes, idle while the cache is warm, expired after', () => {
    expect(subAgentActivity(ctx(now - 30), now)).toBe('active')
    expect(subAgentActivity(ctx(now - 600), now)).toBe('idle')
    expect(subAgentActivity(ctx(now - 4000), now)).toBe('expired')
    expect(subAgentActivity(undefined, now)).toBe('unknown')
  })

  const fill = (bar: HTMLElement) =>
    bar.querySelector('[data-testid="subagent-progress-fill"]') as HTMLElement

  it('colours the bar by state and stops it once the cache has expired', () => {
    const t = Math.floor(Date.now() / 1000)
    const agents = [
      makeSubAgent({ toolUseId: 't1', agentId: 'live1234' }),
      makeSubAgent({ toolUseId: 't2', agentId: 'idle1234' }),
      makeSubAgent({ toolUseId: 't3', agentId: 'dead1234' }),
      makeSubAgent({ toolUseId: 't4', agentId: 'none1234' }),
    ]
    const contexts = [
      { ...ctx(t - 10), agentId: 'live1234' },
      { ...ctx(t - 900), agentId: 'idle1234' },
      { ...ctx(t - 5000), agentId: 'dead1234' },
    ]
    render(<SwimLanes subAgents={agents} contexts={contexts} />)
    const bars = screen.getAllByTestId('subagent-progress')
    const byActivity = Object.fromEntries(bars.map((b) => [b.dataset.activity, b]))
    expect(fill(byActivity.active).className).toContain('bg-blue-')
    expect(fill(byActivity.active).style.animation).toContain('swimlane-progress')
    expect(fill(byActivity.idle).className).toContain('bg-amber-')
    expect(fill(byActivity.idle).style.animation).toContain('swimlane-progress')
    expect(fill(byActivity.expired).className).toContain('bg-gray-')
    expect(fill(byActivity.expired).style.animation).toBe('')
    // No transcript data yet: the plain blue moving bar, as before this change.
    expect(fill(byActivity.unknown).className).toContain('bg-blue-')
    expect(fill(byActivity.unknown).style.animation).toContain('swimlane-progress')
    expect(byActivity.idle.title).toMatch(/^Quiet/)
    expect(byActivity.expired.title).toMatch(/^Stalled/)
  })

  it('colours the activity dot the same way and stops its pulse once the cache has expired', () => {
    const t = Math.floor(Date.now() / 1000)
    const agents = [
      makeSubAgent({ toolUseId: 't1', agentId: 'live1234', currentActivity: 'Reading a file' }),
      makeSubAgent({ toolUseId: 't2', agentId: 'idle1234', currentActivity: 'Running tests' }),
      makeSubAgent({ toolUseId: 't3', agentId: 'dead1234', currentActivity: 'Running a build' }),
    ]
    const contexts = [
      { ...ctx(t - 10), agentId: 'live1234' },
      { ...ctx(t - 900), agentId: 'idle1234' },
      { ...ctx(t - 5000), agentId: 'dead1234' },
    ]
    render(<SwimLanes subAgents={agents} contexts={contexts} />)
    // A helper showing its current activity has the dot instead of the bar.
    expect(screen.queryByTestId('subagent-progress')).toBeNull()
    const dots = Object.fromEntries(
      screen.getAllByTestId('subagent-activity-dot').map((d) => [d.dataset.activity, d]),
    )
    expect(dots.active.className).toContain('animate-pulse')
    expect(dots.active.className).toContain('bg-blue-')
    expect(dots.idle.className).toContain('animate-pulse')
    expect(dots.idle.className).toContain('bg-amber-')
    expect(dots.expired.className).not.toContain('animate-pulse')
    expect(dots.expired.className).toContain('bg-gray-')
  })

  it('moves the bar from working to quiet to stopped as time passes, with no new data', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2_000_000_000_000))
      const t = Math.floor(Date.now() / 1000)
      const agents = [makeSubAgent({ toolUseId: 't1', agentId: 'live1234' })]
      // 5-minute cache, latest request 10 s ago.
      const contexts = [{ ...ctx(t - 10), agentId: 'live1234', cacheTtlSeconds: 300 }]
      render(<SwimLanes subAgents={agents} contexts={contexts} />)
      const bar = () => screen.getByTestId('subagent-progress')
      expect(bar().dataset.activity).toBe('active')

      act(() => {
        vi.advanceTimersByTime(120_000)
      })
      expect(bar().dataset.activity).toBe('idle')
      expect(fill(bar()).style.animation).toContain('swimlane-progress')

      act(() => {
        vi.advanceTimersByTime(180_000)
      })
      expect(bar().dataset.activity).toBe('expired')
      expect(fill(bar()).style.animation).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('agentTypeColor', () => {
  it('gives each named helper type its own colour', () => {
    const named = ['builder', 'builder-browser', 'reviewer', 'senior-reviewer', 'Explore']
    expect(new Set(named.map(agentTypeColor)).size).toBe(named.length)
    expect(agentTypeColor('builder')).toContain('sky')
    expect(agentTypeColor('Explore')).toContain('emerald')
    expect(agentTypeColor(' EXPLORE ')).toBe(agentTypeColor('explore'))
  })

  it("gives unknown types a colour from the fallback set, never a named type's or the error red", () => {
    const named = ['builder', 'builder-browser', 'reviewer', 'senior-reviewer', 'Explore'].map(
      agentTypeColor,
    )
    const unknown = ['custom-x', 'my-agent', 'statusline-setup', 'zz', 'a', 'data-cruncher']
    const colours = unknown.map(agentTypeColor)
    for (const c of colours) {
      expect(c).toMatch(/^text-[a-z]+-\d+ dark:text-[a-z]+-\d+$/)
      expect(named).not.toContain(c)
      expect(c).not.toMatch(/red|rose/)
    }
    // Different names do land on different colours (not one constant).
    expect(new Set(colours).size).toBeGreaterThan(1)
    // Pinned value: the same name must keep its colour across reloads and releases.
    expect(agentTypeColor('custom-x')).toBe('text-stone-600 dark:text-stone-300')
  })

  it('shows the type label in its colour', () => {
    render(<SwimLanes subAgents={[makeSubAgent({ agentType: 'reviewer' })]} />)
    expect(screen.getByTestId('subagent-type').className).toContain('text-violet-')
  })
})
