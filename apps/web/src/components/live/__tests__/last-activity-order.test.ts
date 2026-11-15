import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { splitByGroup } from '../KanbanView'
import {
  DEFAULT_LIVE_FILTERS,
  defaultSortDir,
  filterLiveSessions,
  sortLiveSessions,
} from '../live-filter'
import { EMPTY_PANE_MEMORY, orderMonitorPanes } from '../monitor-pane-order'
import { KANBAN_SORT_DEFAULT_MIGRATED_KEY, KANBAN_SORT_STORAGE_KEY } from '../types'
import { keepsStableGroupOrder, loadSort, useKanbanGrouping } from '../use-kanban-grouping'
import type { LiveSession } from '../use-live-sessions'
import { makeLiveSession } from './make-live-session'

const ids = (sessions: LiveSession[]) => sessions.map((s) => s.id)

const needsYou: LiveSession['agentState'] = {
  group: 'needs_you',
  state: 'awaiting_input',
  label: 'Waiting',
  context: null,
}

describe('Live Monitor default order (LM2)', () => {
  it('defaults to last activity, most recent first', () => {
    expect(DEFAULT_LIVE_FILTERS.sort).toBe('last_active')
    expect(DEFAULT_LIVE_FILTERS.sortDir).toBe('desc')
    const sessions = [
      makeLiveSession({ id: 'old', lastActivityAt: 100 }),
      makeLiveSession({ id: 'new', lastActivityAt: 300 }),
      makeLiveSession({ id: 'mid', lastActivityAt: 200 }),
    ]
    expect(ids(filterLiveSessions(sessions, DEFAULT_LIVE_FILTERS))).toEqual(['new', 'mid', 'old'])
  })

  it('re-orders when a session gets new activity', () => {
    const a = makeLiveSession({ id: 'a', lastActivityAt: 100 })
    const b = makeLiveSession({ id: 'b', lastActivityAt: 200 })
    expect(ids(filterLiveSessions([a, b], DEFAULT_LIVE_FILTERS))).toEqual(['b', 'a'])
    const aBusy = { ...a, lastActivityAt: 300 }
    expect(ids(filterLiveSessions([aBusy, b], DEFAULT_LIVE_FILTERS))).toEqual(['a', 'b'])
  })

  it('other sort choices still work, ties going to the most recent either way', () => {
    const sessions = [
      makeLiveSession({ id: 'cheap-old', turnCount: 1, lastActivityAt: 100 }),
      makeLiveSession({ id: 'cheap-new', turnCount: 1, lastActivityAt: 200 }),
      makeLiveSession({ id: 'busy', turnCount: 9, lastActivityAt: 50 }),
    ]
    expect(ids(sortLiveSessions(sessions, 'turns', 'desc'))).toEqual([
      'busy',
      'cheap-new',
      'cheap-old',
    ])
    expect(ids(sortLiveSessions(sessions, 'turns', 'asc'))).toEqual([
      'cheap-new',
      'cheap-old',
      'busy',
    ])
  })

  it('picking last activity starts newest first, other fields ascending', () => {
    expect(defaultSortDir('last_active')).toBe('desc')
    expect(defaultSortDir('cost')).toBe('asc')
  })
})

describe('Board columns (LM2)', () => {
  it('lists each column most recently active first', () => {
    const sessions = [
      // Upstream put permission requests and warm caches first; now activity decides
      makeLiveSession({
        id: 'perm-old',
        lastActivityAt: 100,
        cacheStatus: 'warm',
        agentState: { ...needsYou, state: 'needs_permission' },
      }),
      makeLiveSession({ id: 'idle-new', lastActivityAt: 300, agentState: needsYou }),
      makeLiveSession({ id: 'run-old', lastActivityAt: 150, currentTurnStartedAt: 900 }),
      makeLiveSession({ id: 'run-new', lastActivityAt: 250, currentTurnStartedAt: 10 }),
    ]
    const split = splitByGroup(sessions)
    expect(ids(split.needs_you)).toEqual(['idle-new', 'perm-old'])
    expect(ids(split.autonomous)).toEqual(['run-new', 'run-old'])
  })
})

describe('Project + branch groups (LM2)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('re-order live by their most recently active session with the default sort', () => {
    const alpha = makeLiveSession({ id: 'a', projectDisplayName: 'alpha', lastActivityAt: 300 })
    const beta = makeLiveSession({ id: 'b', projectDisplayName: 'beta', lastActivityAt: 100 })
    const { result, rerender } = renderHook(
      ({ sessions }) => useKanbanGrouping(sessions, 'project-branch'),
      { initialProps: { sessions: [alpha, beta] } },
    )
    expect(result.current.sort).toBe('recent')
    expect(result.current.projectGroups.map((g) => g.projectName)).toEqual(['alpha', 'beta'])

    rerender({ sessions: [alpha, { ...beta, lastActivityAt: 500 }] })
    expect(result.current.projectGroups.map((g) => g.projectName)).toEqual(['beta', 'alpha'])
  })

  it('re-orders branches within a project and sessions within a branch', () => {
    const main = makeLiveSession({ id: 'm1', gitBranch: 'main', lastActivityAt: 400 })
    const feat1 = makeLiveSession({ id: 'f1', gitBranch: 'feat', lastActivityAt: 100 })
    const feat2 = makeLiveSession({ id: 'f2', gitBranch: 'feat', lastActivityAt: 200 })
    const { result, rerender } = renderHook(
      ({ sessions }) => useKanbanGrouping(sessions, 'project-branch'),
      { initialProps: { sessions: [main, feat1, feat2] } },
    )
    const branches = () => result.current.projectGroups[0].branches
    expect(branches().map((b) => b.branchName)).toEqual(['main', 'feat'])
    expect(ids(branches()[1].sessions)).toEqual(['f2', 'f1'])

    rerender({ sessions: [main, { ...feat1, lastActivityAt: 600 }, feat2] })
    expect(branches().map((b) => b.branchName)).toEqual(['feat', 'main'])
    expect(ids(branches()[0].sessions)).toEqual(['f1', 'f2'])
  })

  it('keeps the other sort choices working', () => {
    const zed = makeLiveSession({ id: 'z', projectDisplayName: 'zed', lastActivityAt: 900 })
    const abc = makeLiveSession({ id: 'a', projectDisplayName: 'abc', lastActivityAt: 100 })
    const { result } = renderHook(() => useKanbanGrouping([zed, abc], 'project-branch'))
    act(() => result.current.setSort('alphabetical'))
    expect(result.current.projectGroups.map((g) => g.projectName)).toEqual(['abc', 'zed'])
    expect(keepsStableGroupOrder('cost')).toBe(true)
    expect(keepsStableGroupOrder('recent')).toBe(false)
  })
})

describe('stored Sort choice (LM2)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('drops a choice stored before the change once, so the new default shows', () => {
    localStorage.setItem(KANBAN_SORT_STORAGE_KEY, 'alphabetical')
    expect(loadSort()).toBe('recent')
    expect(localStorage.getItem(KANBAN_SORT_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(KANBAN_SORT_DEFAULT_MIGRATED_KEY)).toBe('1')
  })

  it('keeps choices made after the change', () => {
    loadSort()
    localStorage.setItem(KANBAN_SORT_STORAGE_KEY, 'cost')
    expect(loadSort()).toBe('cost')
  })
})

describe('Monitor panes (LM2)', () => {
  const s = (id: string, lastActivityAt: number) => makeLiveSession({ id, lastActivityAt })

  it('shows the most recently active first without moving rendered panes', () => {
    const first = orderMonitorPanes([s('a', 100), s('b', 200)], [], EMPTY_PANE_MEMORY, 8)
    expect(ids(first.ranked)).toEqual(['b', 'a'])
    expect(ids(first.domOrder)).toEqual(['a', 'b'])

    const next = orderMonitorPanes([s('a', 300), s('b', 200)], [], first.next, 8)
    expect(ids(next.ranked)).toEqual(['a', 'b'])
    expect(ids(next.domOrder)).toEqual(['a', 'b'])
    expect(next.rank.get('a')).toBe(0)
    expect(next.rank.get('b')).toBe(1)
  })

  it('puts "Move to front" choices first', () => {
    const order = orderMonitorPanes([s('a', 100), s('b', 200)], ['a'], EMPTY_PANE_MEMORY, 8)
    expect(ids(order.ranked)).toEqual(['a', 'b'])
  })

  it('a session that gets busy takes the slot of the least recently active pane', () => {
    const first = orderMonitorPanes(
      [s('a', 100), s('b', 200), s('c', 300)],
      [],
      EMPTY_PANE_MEMORY,
      2,
    )
    expect(ids(first.ranked)).toEqual(['c', 'b'])
    // 'a' gets busy: it replaces 'b' (the quietest shown); 'c' stays put in the page
    const busy = orderMonitorPanes([s('a', 900), s('b', 200), s('c', 300)], [], first.next, 2)
    expect(ids(busy.ranked)).toEqual(['a', 'c'])
    expect(ids(busy.domOrder)).toEqual(['a', 'c'])
    // when 'a' ends, its slot goes back to 'b'
    const ended = orderMonitorPanes([s('b', 200), s('c', 300)], [], busy.next, 2)
    expect(ids(ended.ranked)).toEqual(['c', 'b'])
  })

  it('on equal activity a pane already shown keeps its slot', () => {
    const first = orderMonitorPanes([s('a', 100), s('b', 100)], [], EMPTY_PANE_MEMORY, 1)
    const shown = ids(first.ranked)[0]
    const other = shown === 'a' ? 'b' : 'a'
    const again = orderMonitorPanes([s(other, 100), s(shown as string, 100)], [], first.next, 1)
    expect(ids(again.ranked)).toEqual([shown])
  })

  it('never swaps out a "Move to front" pane', () => {
    const order = orderMonitorPanes([s('a', 100), s('b', 900)], ['a'], EMPTY_PANE_MEMORY, 1)
    expect(ids(order.ranked)).toEqual(['a'])
  })
})
