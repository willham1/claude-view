import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListView } from '../ListView'
import { makeLiveSession } from './make-live-session'

const rowIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr[data-session-id]')).map((r) =>
    r.getAttribute('data-session-id'),
  )

describe('ListView order (LM2)', () => {
  const sessions = [
    makeLiveSession({ id: 'old', lastActivityAt: 100, turnCount: 1 }),
    makeLiveSession({ id: 'new', lastActivityAt: 300, turnCount: 9 }),
    makeLiveSession({ id: 'mid', lastActivityAt: 200, turnCount: 5 }),
  ]

  it('lists the most recently active session first by default', () => {
    const { container } = render(
      <ListView sessions={sessions} selectedId={null} onSelect={() => {}} />,
    )
    expect(rowIds(container)).toEqual(['new', 'mid', 'old'])
  })

  it('still sorts by another column when its header is clicked', () => {
    const { container } = render(
      <ListView sessions={sessions} selectedId={null} onSelect={() => {}} />,
    )
    fireEvent.click(screen.getByText('Turns'))
    expect(rowIds(container)).toEqual(['old', 'mid', 'new'])
    fireEvent.click(screen.getByText('Turns'))
    expect(rowIds(container)).toEqual(['new', 'mid', 'old'])
  })
})
