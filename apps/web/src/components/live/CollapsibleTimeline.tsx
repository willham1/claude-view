import { ChevronDown, ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { readTimelineOpen, writeTimelineOpen } from '../../lib/subagent-timeline-pref'
import { cn } from '../../lib/utils'

/**
 * Bottom section of the Sub-Agents tab: a "Timeline" toggle line, collapsed
 * by default so the helper list gets the room. The open/closed choice is
 * remembered across reloads. When open, the content is sized to its rows,
 * at most 40% of the tab's height.
 */
export function CollapsibleTimeline({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => readTimelineOpen())
  const toggle = () => {
    const next = !open
    writeTimelineOpen(next)
    setOpen(next)
  }
  return (
    <div
      className={cn(
        'shrink-0 border-t border-gray-200 dark:border-gray-800',
        open && 'max-h-[40%] flex flex-col',
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid="subagent-timeline-toggle"
        className="flex items-center gap-1.5 w-full px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900/50"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Timeline
        <span className="text-gray-400 dark:text-gray-500 font-normal">(when each helper ran)</span>
      </button>
      {open && <div className="min-h-0 overflow-y-auto px-4 pb-4">{children}</div>}
    </div>
  )
}
