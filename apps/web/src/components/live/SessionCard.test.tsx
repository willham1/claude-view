import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionCard } from './SessionCard'
import type { LiveSession } from './use-live-sessions'

function createMockSession(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: 'session-1',
    project: 'test-project',
    projectDisplayName: 'test-project',
    projectPath: '/Users/test/dev/test-project',
    filePath: '/tmp/session-1.jsonl',
    status: 'paused',
    agentState: {
      group: 'needs_you',
      state: 'awaiting_input',
      label: 'Waiting for your next message',
      context: null,
    },
    gitBranch: 'main',
    worktreeBranch: null,
    isWorktree: false,
    effectiveBranch: 'main',
    pid: null,
    title: 'First human prompt',
    lastUserMessage: 'Latest human prompt',
    currentActivity: '',
    turnCount: 3,
    startedAt: 1_700_000_000,
    lastActivityAt: 1_700_000_120,
    model: 'claude-sonnet-4',
    currentTurnStartedAt: null,
    lastTurnTaskSeconds: null,
    tokens: {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hrTokens: 0,
      totalTokens: 1_500,
    },
    contextWindowTokens: 1_500,
    cost: {
      totalUsd: 0.42,
      inputCostUsd: 0.2,
      outputCostUsd: 0.2,
      cacheReadCostUsd: 0,
      cacheCreationCostUsd: 0,
      cacheSavingsUsd: 0,
      hasUnpricedUsage: false,
      unpricedInputTokens: 0,
      unpricedOutputTokens: 0,
      unpricedCacheReadTokens: 0,
      unpricedCacheCreationTokens: 0,
      pricedTokenCoverage: 1,
      totalCostSource: 'computed_priced_tokens_full',
    },
    cacheStatus: 'warm',
    subAgents: [],
    teamName: null,
    progressItems: [],
    toolsUsed: [],
    lastCacheHitAt: null,
    cacheTtlSeconds: null,
    startContextTokens: 0,
    peakContextTokens: 0,
    requestCount: 0,
    compactCount: 0,
    slug: null,
    closedAt: null,
    control: null,
    editCount: 0,
    hookEvents: [],
    phase: { current: null, labels: [], dominant: null, freshness: 'fresh' as const },
    ...overrides,
  }
}

function renderCard(session: LiveSession) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SessionCard session={session} currentTime={1_700_000_130} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('live SessionCard', () => {
  it('uses the last user message as the card title when available', () => {
    const { container } = renderCard(
      createMockSession({
        title: 'First human prompt about setup',
        lastUserMessage: 'Latest human prompt about auth bug',
      }),
    )

    const title = container.querySelector('p.text-sm.font-medium')
    expect(title).toBeInTheDocument()
    expect(title).toHaveTextContent('Latest human prompt about auth bug')
    expect(title).not.toHaveTextContent('First human prompt about setup')
  })
})

describe('SessionCard pulse dot', () => {
  it('shows pulse dot for autonomous (running) sessions', () => {
    const session = createMockSession({
      status: 'working',
      agentState: { state: 'tool_use', group: 'autonomous', label: 'Working', context: null },
    })
    renderCard(session)
    expect(screen.getByTestId('pulse-dot')).toBeInTheDocument()
  })

  it('does not show pulse dot for waiting sessions', () => {
    const session = createMockSession({
      agentState: { state: 'awaiting_input', group: 'needs_you', label: 'Waiting', context: null },
    })
    renderCard(session)
    expect(screen.queryByTestId('pulse-dot')).not.toBeInTheDocument()
  })
})

describe('SessionCard sub-agent pills', () => {
  it('shows SubAgentPills when session has sub-agents', () => {
    const session = createMockSession({
      subAgents: [
        {
          toolUseId: 'toolu_01',
          agentType: 'Explore',
          description: 'Search',
          status: 'running',
          startedAt: 1_700_000_000,
          currentActivity: 'Read',
        },
        {
          toolUseId: 'toolu_02',
          agentType: 'code-reviewer',
          description: 'Review',
          status: 'complete',
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_030,
          durationMs: 30000,
        },
      ],
    })
    renderCard(session)
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByText('code-reviewer')).toBeInTheDocument()
  })

  it('does not show SubAgentPills when no sub-agents', () => {
    const session = createMockSession({ subAgents: undefined })
    renderCard(session)
    expect(screen.queryByText(/agents/)).not.toBeInTheDocument()
  })

  // Issue #62: the Agents list must show running + newest first, so the
  // `+N more` overflow hides the OLDEST agents, not the active ones.
  it('orders the Agents list running + newest first and overflows the oldest', () => {
    const session = createMockSession({
      subAgents: [
        {
          toolUseId: 'a1',
          agentType: 'a-oldest',
          description: 'd',
          status: 'complete',
          startedAt: 1_000,
        },
        {
          toolUseId: 'a2',
          agentType: 'b-mid',
          description: 'd',
          status: 'complete',
          startedAt: 2_000,
        },
        {
          toolUseId: 'a3',
          agentType: 'c-newer',
          description: 'd',
          status: 'complete',
          startedAt: 3_000,
        },
        {
          toolUseId: 'a4',
          agentType: 'd-live',
          description: 'd',
          status: 'running',
          startedAt: 1_500,
        },
      ],
    })
    renderCard(session)

    const live = screen.getByText('d-live')
    const newer = screen.getByText('c-newer')
    // Running agent renders before the newest completed agent in the DOM.
    expect(live.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('b-mid')).toBeInTheDocument()
    // Oldest is pushed into the "+1 more" overflow, not rendered as a row.
    expect(screen.queryByText('a-oldest')).not.toBeInTheDocument()
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })
})

// Issue #61: a Plan-mode badge, confidence-gated. It must appear ONLY when
// the session is actually in plan mode — never guessed. Any other mode, or
// no reported mode, shows nothing (寧願唔顯示，都唔顯示錯嘅嘢).
describe('SessionCard plan mode badge', () => {
  it('shows the Plan badge when permissionMode is "plan"', () => {
    renderCard(createMockSession({ permissionMode: 'plan' }))
    expect(screen.getByText('Plan')).toBeInTheDocument()
  })

  it('does NOT show the Plan badge for non-plan modes', () => {
    renderCard(createMockSession({ permissionMode: 'default' }))
    expect(screen.queryByText('Plan')).not.toBeInTheDocument()
  })

  it('does NOT show the Plan badge for acceptEdits/bypassPermissions', () => {
    renderCard(createMockSession({ permissionMode: 'bypassPermissions' }))
    expect(screen.queryByText('Plan')).not.toBeInTheDocument()
  })

  it('does NOT show the Plan badge when permissionMode is absent', () => {
    renderCard(createMockSession({ permissionMode: undefined }))
    expect(screen.queryByText('Plan')).not.toBeInTheDocument()
  })
})

describe('SessionCard interaction display', () => {
  it('renders SessionInteractionCard compact preview when pendingInteraction is present', () => {
    const session = createMockSession({
      pendingInteraction: {
        variant: 'permission',
        requestId: 'req-001',
        preview: 'Allow file write to src/main.rs?',
      },
    })
    renderCard(session)
    // CompactInteractionPreview shows the preview text while full data loads
    expect(screen.getByText(/Allow file write/)).toBeInTheDocument()
  })

  it('does not render interaction card when pendingInteraction is absent', () => {
    const session = createMockSession({
      pendingInteraction: undefined,
    })
    renderCard(session)
    expect(screen.queryByText(/Allow file write/)).not.toBeInTheDocument()
  })

  it('does not render interaction card when pendingInteraction is null', () => {
    const session = createMockSession({
      pendingInteraction: null,
    })
    renderCard(session)
    // No interaction-related UI should be present
    expect(screen.queryByText(/Permission/i)).not.toBeInTheDocument()
  })
})

// LM4: every card shows the same detail lines whatever the session's state,
// at least what a helper's row in the Sub-Agents tab shows.
describe('SessionCard details (LM4)', () => {
  // Frozen clock: the countdown must not tick between building the mock and rendering.
  const nowSecs = 1_800_000_000
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(nowSecs * 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const detailed = {
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    contextWindowTokens: 50_000,
    startContextTokens: 20_000,
    peakContextTokens: 90_000,
    requestCount: 42,
    turnCount: 7,
    lastCacheHitAt: nowSecs - 600,
    cacheTtlSeconds: 3600,
  } satisfies Partial<LiveSession>
  const running = {
    status: 'working',
    agentState: { state: 'acting', group: 'autonomous', label: 'Working', context: null },
  } satisfies Partial<LiveSession>
  const awaiting = {
    status: 'paused',
    agentState: {
      state: 'awaiting_input',
      group: 'needs_you',
      label: 'Waiting for your next message',
      context: null,
    },
  } satisfies Partial<LiveSession>

  for (const [name, state] of [
    ['running', running],
    ['awaiting input', awaiting],
  ] as const) {
    it(`shows model, effort, requests, turns, cache and context on a ${name} card`, () => {
      renderCard(createMockSession({ ...detailed, ...state }))
      expect(screen.getByTestId('card-model')).toHaveTextContent('Opus 5.5')
      expect(screen.getByTestId('card-effort')).toHaveTextContent('xhigh effort')
      const modelLine = screen.getByTestId('card-model-line')
      expect(modelLine).toHaveTextContent('42 reqs')
      expect(modelLine).toHaveTextContent('7 turns')
      // "turns" counts transcript user lines (tool results too): the hover says so.
      expect(screen.getByText('7 turns')).toHaveAttribute(
        'title',
        expect.stringContaining('tool results'),
      )
      expect(screen.getByTestId('card-cache')).toHaveTextContent('cache 50:00 left (1h)')
      const ctx = screen.getByTestId('card-context-line')
      expect(ctx).toHaveTextContent('start 20.0k')
      expect(ctx).toHaveTextContent('now 50.0k')
      expect(ctx).toHaveTextContent('peak 90.0k')
      expect(ctx).toHaveTextContent('1.0M')
      expect(ctx).toHaveTextContent('5%')
    })
  }

  it('shows the model once: the state line leaves it to the details', () => {
    renderCard(createMockSession({ ...detailed, ...running }))
    expect(screen.getAllByText(/Opus 5\.5|opus/i)).toHaveLength(1)
  })

  it('says the cache has expired, and shows a dash before any cache activity', () => {
    const { unmount } = renderCard(
      createMockSession({ ...detailed, ...awaiting, lastCacheHitAt: nowSecs - 7200 }),
    )
    expect(screen.getByTestId('card-cache')).toHaveTextContent('cache expired (1h)')
    unmount()
    renderCard(createMockSession({ ...detailed, ...awaiting, lastCacheHitAt: null }))
    expect(screen.getByTestId('card-cache')).toHaveTextContent('cache –')
  })

  it('leaves out what is unknown: no effort, no requests, no context yet', () => {
    renderCard(
      createMockSession({
        ...awaiting,
        model: null,
        effort: undefined,
        requestCount: undefined as unknown as number,
        contextWindowTokens: 0,
        turnCount: 0,
      }),
    )
    expect(screen.getByTestId('card-model')).toHaveTextContent('model –')
    expect(screen.queryByTestId('card-effort')).not.toBeInTheDocument()
    expect(screen.getByTestId('card-model-line')).not.toHaveTextContent('req')
    expect(screen.queryByTestId('card-context-line')).not.toBeInTheDocument()
  })

  it('shows only "now" when the server reports no start or peak (older server)', () => {
    renderCard(
      createMockSession({
        ...detailed,
        ...running,
        startContextTokens: 0,
        peakContextTokens: 0,
      }),
    )
    const ctx = screen.getByTestId('card-context-line')
    expect(ctx).toHaveTextContent('now 50.0k')
    expect(ctx).not.toHaveTextContent('start')
    expect(ctx).not.toHaveTextContent('peak')
  })

  it('counts helpers by status', () => {
    renderCard(
      createMockSession({
        ...detailed,
        ...awaiting,
        subAgents: [
          {
            toolUseId: 'a',
            agentType: 'builder',
            description: 'x',
            status: 'running',
            startedAt: 1,
          },
          {
            toolUseId: 'b',
            agentType: 'reviewer',
            description: 'y',
            status: 'complete',
            startedAt: 1,
          },
          { toolUseId: 'c', agentType: 'Explore', description: 'z', status: 'error', startedAt: 1 },
        ],
      }),
    )
    expect(screen.getByTestId('card-helpers-line')).toHaveTextContent(
      'helpers 1 running, 1 done, 1 failed',
    )
  })
})

// The session's pinned `/goal` (the Stop-hook condition) must surface on the card so
// you can see what each live session is driving toward — shown ONLY when actually set
// (寧願唔顯示，都唔顯示錯嘅嘢: better nothing than a wrong/absent goal).
describe('SessionCard goal', () => {
  it('renders the goal text when session.goal is set', () => {
    renderCard(createMockSession({ goal: 'finish the e2e and verify it in prod' }))
    expect(screen.getByText('finish the e2e and verify it in prod')).toBeInTheDocument()
  })

  it('does NOT render a goal pill when session.goal is absent', () => {
    renderCard(createMockSession({ goal: undefined }))
    expect(screen.queryByText('finish the e2e and verify it in prod')).not.toBeInTheDocument()
  })

  it('does NOT render a goal pill when session.goal is null', () => {
    renderCard(createMockSession({ goal: null }))
    expect(screen.queryByText(/finish the e2e/)).not.toBeInTheDocument()
  })
})
