import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonitorGrid } from '../MonitorGrid'
import type { LiveSession } from '../use-live-sessions'
import { makeLiveSession } from './make-live-session'

/** IntersectionObserver stub that records which pane ids are being observed. */
function stubIntersectionObserver() {
  const observed = new Set<string>()
  class StubIntersectionObserver {
    private targets: Element[] = []
    observe(el: Element) {
      this.targets.push(el)
      observed.add((el as HTMLElement).dataset.paneId ?? '')
    }
    unobserve() {}
    disconnect() {
      for (const el of this.targets) observed.delete((el as HTMLElement).dataset.paneId ?? '')
      this.targets = []
    }
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver)
  return observed
}

const grid = (sessions: LiveSession[]) => (
  <MonitorGrid sessions={sessions} gridOverride={null} compactHeaders={false}>
    {sessions.map((s) => (
      <div key={s.id} data-pane-id={s.id} />
    ))}
  </MonitorGrid>
)

describe('MonitorGrid visibility (LM2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('observes a pane that replaces another at the same count', () => {
    const observed = stubIntersectionObserver()
    const a = makeLiveSession({ id: 'a' })
    const b = makeLiveSession({ id: 'b' })
    const c = makeLiveSession({ id: 'c' })
    const { rerender } = render(grid([a, b]))
    expect([...observed].sort()).toEqual(['a', 'b'])
    rerender(grid([a, c]))
    expect([...observed].sort()).toEqual(['a', 'c'])
  })
})
