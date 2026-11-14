import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { TIMELINE_OPEN_KEY, readTimelineOpen } from '../../lib/subagent-timeline-pref'
import { CollapsibleTimeline } from './CollapsibleTimeline'

beforeEach(() => {
  localStorage.removeItem(TIMELINE_OPEN_KEY)
})

describe('readTimelineOpen', () => {
  it('is closed with nothing stored, open for "1", closed for "0"', () => {
    expect(readTimelineOpen()).toBe(false)
    localStorage.setItem(TIMELINE_OPEN_KEY, '1')
    expect(readTimelineOpen()).toBe(true)
    localStorage.setItem(TIMELINE_OPEN_KEY, '0')
    expect(readTimelineOpen()).toBe(false)
  })
})

describe('CollapsibleTimeline', () => {
  it('is collapsed by default: the chart is not rendered', () => {
    render(<CollapsibleTimeline>chart</CollapsibleTimeline>)
    expect(screen.getByTestId('subagent-timeline-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('chart')).toBeNull()
  })

  it('opens and closes on click, and remembers the choice across remounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<CollapsibleTimeline>chart</CollapsibleTimeline>)
    await user.click(screen.getByTestId('subagent-timeline-toggle'))
    expect(screen.getByText('chart')).toBeInTheDocument()
    expect(localStorage.getItem(TIMELINE_OPEN_KEY)).toBe('1')
    unmount()

    // A reload: still open.
    render(<CollapsibleTimeline>chart</CollapsibleTimeline>)
    expect(screen.getByText('chart')).toBeInTheDocument()
    await user.click(screen.getByTestId('subagent-timeline-toggle'))
    expect(screen.queryByText('chart')).toBeNull()
    expect(localStorage.getItem(TIMELINE_OPEN_KEY)).toBe('0')
  })
})
