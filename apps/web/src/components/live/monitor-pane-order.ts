import { compareByLastActivityDesc } from './live-filter'
import type { LiveSession } from './use-live-sessions'

export interface MonitorPaneMemory {
  /** First-seen order of session ids (render order). */
  stableOrder: string[]
  /** Ids shown last time, so a pane isn't swapped out for one that is only as recent. */
  shown: string[]
}

export interface MonitorPaneOrder {
  /** Panes in display order: "Move to front" ones first, then most recently active. */
  ranked: LiveSession[]
  /** The same panes in first-seen order, for rendering without moving DOM nodes. */
  domOrder: LiveSession[]
  /** Display position (0 = first) per session id, for the CSS `order` property. */
  rank: Map<string, number>
  /** Memory to pass into the next call. */
  next: MonitorPaneMemory
}

export const EMPTY_PANE_MEMORY: MonitorPaneMemory = { stableOrder: [], shown: [] }

/** How long a shown pane must be quiet before a busier session may take its slot (useAutoFill's 5 minutes). */
export const SWAP_QUIET_SECONDS = 5 * 60

/** MonitorGrid's auto layout: columns at least 480px, rows at least 300px, 4px gaps. */
const MIN_PANE_WIDTH = 480
const MIN_PANE_HEIGHT = 300
const GRID_GAP = 4

/**
 * How many panes the auto grid shows without clipping any (its container hides
 * overflow, and a pane out of view unmounts its terminal). At least one; `null`
 * while the container hasn't been measured yet.
 */
export function autoGridCapacity(width: number, height: number): number | null {
  if (width <= 0 || height <= 0) return null
  const cols = Math.max(1, Math.floor((width + GRID_GAP) / (MIN_PANE_WIDTH + GRID_GAP)))
  const rows = Math.max(1, Math.floor((height + GRID_GAP) / (MIN_PANE_HEIGHT + GRID_GAP)))
  return cols * rows
}

/**
 * Orders the Monitor view's panes (fork, LM2): most recently active first, like the
 * Sub-Agents tab, with "Move to front" choices on top. At most `capacity` panes show.
 *
 * - Panes are rendered in first-seen order (`domOrder`) and placed with CSS `order`
 *   (`rank`), so re-ordering as activity arrives never moves a terminal's DOM node
 *   (upstream avoided that because it made xterm terminals flicker).
 * - Which panes show: "Move to front" choices, then pinned panes, then panes already
 *   shown, then free slots go to the most recently active.
 * - With `swap` on (the auto grid only), a newer session also takes the slot of the
 *   quietest shown pane, but only once that pane has been quiet for
 *   `SWAP_QUIET_SECONDS` (as upstream's auto-fill does), so panes don't trade places
 *   on every line a session writes. Pinned and "Move to front" panes are never
 *   swapped out. Custom (dock) layouts pass `swap: false`, so their panels change
 *   only when a session ends, as upstream.
 */
export function orderMonitorPanes(
  sessions: LiveSession[],
  manualOrder: string[],
  memory: MonitorPaneMemory,
  capacity: number,
  options: { pinned?: ReadonlySet<string>; swap?: boolean; nowSeconds?: number } = {},
): MonitorPaneOrder {
  const pinned = options.pinned ?? new Set<string>()
  const nowSeconds = options.nowSeconds ?? Date.now() / 1000
  const currentIds = new Set(sessions.map((s) => s.id))

  // First-seen order: prune departed sessions, append newly seen ones
  const stableOrder = memory.stableOrder.filter((id) => currentIds.has(id))
  const known = new Set(stableOrder)
  for (const s of sessions) {
    if (!known.has(s.id)) stableOrder.push(s.id)
  }

  const manualPos = new Map(manualOrder.filter((id) => currentIds.has(id)).map((id, i) => [id, i]))
  const candidates = [...sessions].sort((a, b) => {
    const am = manualPos.get(a.id) ?? Number.POSITIVE_INFINITY
    const bm = manualPos.get(b.id) ?? Number.POSITIVE_INFINITY
    if (am !== bm) return am - bm
    return compareByLastActivityDesc(a, b)
  })

  // Pick which panes show: manual choices, pinned panes, panes already shown, the rest
  const pick = new Set<string>()
  const add = (id: string) => {
    if (pick.size < capacity && currentIds.has(id)) pick.add(id)
  }
  for (const id of manualPos.keys()) add(id)
  for (const s of candidates) if (pinned.has(s.id)) add(s.id)
  for (const id of memory.shown) add(id)
  for (const s of candidates) add(s.id)

  // Auto grid: a newer session takes the slot of the quietest shown pane once that
  // pane has been quiet a while (only the leaving pane unmounts; the others stay).
  if (options.swap) {
    const protectedIds = (id: string) => manualPos.has(id) || pinned.has(id)
    const byId = new Map(sessions.map((s) => [s.id, s]))
    for (const s of candidates) {
      if (pick.has(s.id) || protectedIds(s.id)) continue
      let quietest: LiveSession | undefined
      for (const id of pick) {
        if (protectedIds(id)) continue
        const p = byId.get(id)
        if (p && (!quietest || p.lastActivityAt < quietest.lastActivityAt)) quietest = p
      }
      if (!quietest || s.lastActivityAt <= quietest.lastActivityAt) break
      if (nowSeconds - quietest.lastActivityAt < SWAP_QUIET_SECONDS) break
      pick.delete(quietest.id)
      pick.add(s.id)
    }
  }

  const ranked = candidates.filter((s) => pick.has(s.id))
  const rank = new Map(ranked.map((s, i) => [s.id, i]))
  const stablePos = new Map(stableOrder.map((id, i) => [id, i]))
  const domOrder = [...ranked].sort(
    (a, b) => (stablePos.get(a.id) ?? 0) - (stablePos.get(b.id) ?? 0),
  )

  return { ranked, domOrder, rank, next: { stableOrder, shown: ranked.map((s) => s.id) } }
}
