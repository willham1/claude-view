import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListView } from '../ListView'
import { makeLiveSession } from './make-live-session'

const rowIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr[data-session-id]')).map((r) =>
    r.getAttribute('data-session-id'),
  )

describe('ListView order (LM2)', () => {
  // Turn counts deliberately don't follow activity, so each order is distinct
  const sessions = [
    makeLiveSession({ id: 'old', lastActivityAt: 100, turnCount: 5 }),
    makeLiveSession({ id: 'new', lastActivityAt: 300, turnCount: 1 }),
    makeLiveSession({ id: 'mid', lastActivityAt: 200, turnCount: 9 }),
  ]

  const renderList = () =>
    render(<ListView sessions={sessions} selectedId={null} onSelect={() => {}} />)

  it('lists the most recently active session first by default', () => {
    const { container } = renderList()
    expect(rowIds(container)).toEqual(['new', 'mid', 'old'])
  })

  it('still sorts by another column when its header is clicked', () => {
    const { container } = renderList()
    fireEvent.click(screen.getByText('Turns'))
    expect(rowIds(container)).toEqual(['new', 'old', 'mid'])
    fireEvent.click(screen.getByText('Turns'))
    expect(rowIds(container)).toEqual(['mid', 'old', 'new'])
  })

  it('picking Last Active again from another column starts newest first', () => {
    const { container } = renderList()
    fireEvent.click(screen.getByText('Turns'))
    fireEvent.click(screen.getByText('Last Active'))
    expect(rowIds(container)).toEqual(['new', 'mid', 'old'])
    fireEvent.click(screen.getByText('Last Active'))
    expect(rowIds(container)).toEqual(['old', 'mid', 'new'])
  })
})
