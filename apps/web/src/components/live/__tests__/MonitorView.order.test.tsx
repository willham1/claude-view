import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDockLayoutStore } from '../../../store/dock-layout-store'
import { useMonitorStore } from '../../../store/monitor-store'
import { MonitorView } from '../MonitorView'
import { autoGridCapacity } from '../monitor-pane-order'
import type { LiveSession } from '../use-live-sessions'
import { makeLiveSession } from './make-live-session'

// Heavy children replaced by plain markup: this test is about pane order only.
vi.mock('../../../hooks/use-auto-layout', () => ({ useAutoLayout: () => {} }))
vi.mock('../../../hooks/use-pane-zoom', () => ({ usePaneZoom: () => ({ toggleZoom: () => {} }) }))
vi.mock('../../cli-terminal/CliTerminal', () => ({ CliTerminal: () => null }))
vi.mock('../BlockTerminalPane', () => ({ BlockTerminalPane: () => null }))
vi.mock('../DockLayout', () => ({
  DockLayout: ({ sessions }: { sessions: LiveSession[] }) => (
    <div
      data-testid="dock"
      data-count={sessions.length}
      data-ids={sessions
        .map((s) => s.id)
        .sort()
        .join(',')}
    />
  ),
}))
vi.mock('../GridControls', () => ({ GridControls: () => null }))
vi.mock('../LayoutModeToggle', () => ({ LayoutModeToggle: () => null }))
vi.mock('../LayoutPresets', () => ({ LayoutPresets: () => null }))
vi.mock('../PaneContextMenu', () => ({ PaneContextMenu: () => null }))
vi.mock('../useAutoFill', () => ({ useAutoFill: () => new Set() }))
vi.mock('../useMonitorKeyboardShortcuts', () => ({ useMonitorKeyboardShortcuts: () => {} }))
vi.mock('../MonitorGrid', () => ({
  MonitorGrid: ({ children }: { children: ReactNode }) => <div data-testid="grid">{children}</div>,
}))
vi.mock('../MonitorPane', () => ({
  MonitorPane: ({ session }: { session: LiveSession }) => <div>{session.id}</div>,
}))

const panes = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-pane-id]')).map((el) => ({
    id: el.dataset.paneId,
    order: el.style.order,
  }))

describe('MonitorView pane order (LM2)', () => {
  it('keeps panes in place in the page and re-orders them on screen by activity', () => {
    const a = makeLiveSession({ id: 'a', lastActivityAt: 100 })
    const b = makeLiveSession({ id: 'b', lastActivityAt: 200 })
    const { container, rerender } = render(<MonitorView sessions={[a, b]} />)
    expect(panes(container)).toEqual([
      { id: 'a', order: '1' },
      { id: 'b', order: '0' },
    ])

    rerender(<MonitorView sessions={[{ ...a, lastActivityAt: 300 }, b]} />)
    expect(panes(container)).toEqual([
      { id: 'a', order: '0' },
      { id: 'b', order: '1' },
    ])
  })
})

describe('MonitorView capacity (LM2)', () => {
  /** ResizeObserver stub that reports the given content size as soon as it observes. */
  function stubResizeObserver(width: number, height: number) {
    class StubResizeObserver {
      private cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe() {
        this.cb(
          [{ contentRect: { width, height } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver)
  }

  const six = Array.from({ length: 6 }, (_, i) =>
    makeLiveSession({ id: `s${i}`, lastActivityAt: 100 + i }),
  )

  afterEach(() => {
    vi.unstubAllGlobals()
    useDockLayoutStore.setState({ monitorLayoutMode: 'auto-grid' })
    useMonitorStore.setState({ pinnedPaneIds: new Set() })
  })

  it('auto grid shows only the panes that fit, newest first', () => {
    stubResizeObserver(1216, 700)
    const { container } = render(<MonitorView sessions={six} />)
    const shown = panes(container)
    expect(shown).toHaveLength(4)
    expect(shown.map((p) => p.id).sort()).toEqual(['s2', 's3', 's4', 's5'])
  })

  it('auto grid keeps 8 until the container is measured', () => {
    stubResizeObserver(0, 0)
    const { container } = render(<MonitorView sessions={six} />)
    expect(panes(container)).toHaveLength(6)
  })

  it('custom layout keeps up to 8 whatever the size', () => {
    stubResizeObserver(500, 310)
    useDockLayoutStore.setState({ monitorLayoutMode: 'custom' })
    const { getByTestId } = render(<MonitorView sessions={six} />)
    expect(getByTestId('dock').dataset.count).toBe('6')
  })

  it('custom layout never swaps a panel for a busier session', () => {
    useDockLayoutStore.setState({ monitorLayoutMode: 'custom' })
    const nine = Array.from({ length: 9 }, (_, i) =>
      makeLiveSession({ id: `s${i}`, lastActivityAt: 100 + i }),
    )
    const { getByTestId, rerender } = render(<MonitorView sessions={nine} />)
    const before = getByTestId('dock').dataset.ids
    expect(before).toBe('s1,s2,s3,s4,s5,s6,s7,s8')
    // s0 becomes the newest while the others have been quiet for years
    const busy = [{ ...nine[0], lastActivityAt: Date.now() / 1000 }, ...nine.slice(1)]
    rerender(<MonitorView sessions={busy} />)
    expect(getByTestId('dock').dataset.ids).toBe(before)
  })

  it('auto grid keeps a pinned pane over a newer session', () => {
    stubResizeObserver(500, 310) // one slot
    useMonitorStore.setState({ pinnedPaneIds: new Set(['old']) })
    const sessions = [
      makeLiveSession({ id: 'old', lastActivityAt: 100 }),
      makeLiveSession({ id: 'new', lastActivityAt: Date.now() / 1000 }),
    ]
    const { container } = render(<MonitorView sessions={sessions} />)
    expect(panes(container).map((p) => p.id)).toEqual(['old'])
  })
})

describe('autoGridCapacity (LM2)', () => {
  it('counts the panes that fit without clipping', () => {
    // 2 columns of 480px (+4px gap) and 2 rows of 300px (+4px gap)
    expect(autoGridCapacity(1216, 700)).toBe(4)
    expect(autoGridCapacity(1000, 1000)).toBe(6)
    expect(autoGridCapacity(300, 200)).toBe(1)
  })

  it('is unknown until the container is measured', () => {
    expect(autoGridCapacity(0, 0)).toBeNull()
  })
})
