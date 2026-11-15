import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessGroupedContent } from './HarnessGroupedContent'
import { DELIVERY_PHASES } from './harness-phase-groups'
import { useHelperCostStore } from './helper-costs'
import type { ProjectGroup } from './use-kanban-grouping'
import type { LiveSession } from './use-live-sessions'

// The header is under test, not the cards.
vi.mock('./HarnessPhaseRow', () => ({ HarnessPhaseRow: () => null }))
vi.mock('./OpenInIdeButton', () => ({ OpenInIdeButton: () => null }))

function session(id: string, totalUsd: number, phase: string): LiveSession {
  return {
    id,
    cost: { totalUsd },
    subAgents: [
      { agentId: `${id}a`, toolUseId: `t-${id}`, agentType: 'builder', status: 'complete' },
    ],
    teamName: null,
    agentState: { group: 'autonomous', state: 'tool_use', label: '', context: null },
    lastActivityAt: 1,
    phase: { current: { phase }, labels: [], dominant: null, freshness: 'fresh' },
  } as unknown as LiveSession
}

describe('HarnessGroupedContent project header (LM7)', () => {
  afterEach(() => useHelperCostStore.setState({ costs: {}, sidechains: {} }))

  it('sums only the cards shown under it, helpers included', () => {
    const shown = session('s1', 1, 'building')
    const inNeedsYou = session('s2', 20, 'building')
    const inDesign = session('s3', 300, 'planning')
    useHelperCostStore.setState({
      costs: {
        s1: [{ agentId: 's1a', costUsd: 2.5 }],
        s2: [{ agentId: 's2a', costUsd: 40 }],
        s3: [{ agentId: 's3a', costUsd: 500 }],
      },
    })
    const project: ProjectGroup = {
      projectName: 'proj',
      projectPath: '',
      branches: [
        {
          branchName: 'main',
          sessions: [shown, inNeedsYou, inDesign],
          sessionCount: 3,
          maxActivityAt: 1,
        },
      ],
      totalSessionCount: 3,
      totalCostUsd: 321,
      maxActivityAt: 1,
    }
    render(
      <HarnessGroupedContent
        phases={DELIVERY_PHASES}
        projectGroups={[project]}
        excludeIds={new Set(['s2'])}
        isDesign={false}
        selectedId={null}
        onSelect={() => {}}
        currentTime={1}
        isCollapsed={() => false}
        toggleCollapse={() => {}}
      />,
    )
    // s1 alone: $1 main + $2.50 helper.
    expect(screen.getByText('$3.50')).toBeInTheDocument()
  })
})
