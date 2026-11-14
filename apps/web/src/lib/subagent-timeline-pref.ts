/** localStorage key for the Sub-Agents tab timeline's open/closed choice. */
export const TIMELINE_OPEN_KEY = 'claude-view:subagents-timeline-open'

/** Whether the Sub-Agents tab's timeline is open. Default (nothing stored): collapsed. */
export function readTimelineOpen(): boolean {
  try {
    return localStorage.getItem(TIMELINE_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Remember the timeline's open/closed choice across reloads. */
export function writeTimelineOpen(open: boolean) {
  try {
    localStorage.setItem(TIMELINE_OPEN_KEY, open ? '1' : '0')
  } catch {
    // storage unavailable: the choice lasts until reload
  }
}
