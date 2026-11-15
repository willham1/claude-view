import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLiveSessionFilters } from '../use-live-session-filters'

/** Renders the hook against a fake address bar that updates on each setSearchParams. */
function setup(initial = '') {
  let params = new URLSearchParams(initial)
  const setSearchParams = (next: URLSearchParams) => {
    params = next
    rerender({ p: params })
  }
  const { result, rerender } = renderHook(({ p }) => useLiveSessionFilters(p, setSearchParams), {
    initialProps: { p: params },
  })
  return { result, current: () => params }
}

describe('useLiveSessionFilters setSort (LM2)', () => {
  it('from an empty address, picking last active gives newest first', () => {
    const { result, current } = setup()
    expect(result.current[0].sort).toBe('last_active')
    expect(result.current[0].sortDir).toBe('desc')
    result.current[1].setSort('last_active')
    expect(current().get('sort')).toBe('last_active')
    expect(current().get('dir')).toBe('desc')
    expect(result.current[0].sortDir).toBe('desc')
  })

  it('picking it again flips the direction, other fields start ascending', () => {
    const { result, current } = setup()
    result.current[1].setSort('last_active')
    result.current[1].setSort('last_active')
    expect(current().get('dir')).toBe('asc')
    result.current[1].setSort('cost')
    expect(current().get('dir')).toBe('asc')
    result.current[1].setSort('last_active')
    expect(current().get('dir')).toBe('desc')
  })

  it('an old setSort (as the command palette keeps) still reads the latest address', () => {
    const { result, current } = setup()
    const staleSetSort = result.current[1].setSort
    result.current[1].setSort('cost')
    staleSetSort('cost')
    expect(current().get('sort')).toBe('cost')
    expect(current().get('dir')).toBe('desc')
    staleSetSort('last_active')
    expect(current().get('dir')).toBe('desc')
  })
})
