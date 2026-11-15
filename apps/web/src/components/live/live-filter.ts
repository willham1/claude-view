import { GROUP_ORDER } from './types'
import { type LiveSession, sessionTotalCost } from './use-live-sessions'

export type LiveSortField = 'status' | 'last_active' | 'cost' | 'turns' | 'context' | 'project'
export type LiveSortDirection = 'asc' | 'desc'

export interface LiveSessionFilters {
  statuses: string[] // agent state groups to include (needs_you, autonomous)
  projects: string[] // project display names
  branches: string[] // git branch names
  search: string // text search query
  sort: LiveSortField
  sortDir: LiveSortDirection
}

export const DEFAULT_LIVE_FILTERS: LiveSessionFilters = {
  statuses: [],
  projects: [],
  branches: [],
  search: '',
  // Fork (LM2): most recently active first, like the Sub-Agents tab.
  sort: 'last_active',
  sortDir: 'desc',
}

/** Direction a sort field starts in when first picked: newest first for last activity. */
export function defaultSortDir(field: LiveSortField): LiveSortDirection {
  return field === 'last_active' ? 'desc' : 'asc'
}

/** Comparator: most recently active session first. Ties keep their input order. */
export function compareByLastActivityDesc(a: LiveSession, b: LiveSession): number {
  return b.lastActivityAt - a.lastActivityAt
}

/** Sessions ordered most recently active first. Pure and non-mutating. */
export function sortByLastActivity(sessions: LiveSession[]): LiveSession[] {
  return [...sessions].sort(compareByLastActivityDesc)
}

export function sortLiveSessions(
  sessions: LiveSession[],
  field: LiveSortField,
  dir: LiveSortDirection,
): LiveSession[] {
  return [...sessions].sort((a, b) => {
    let cmp = 0

    switch (field) {
      case 'status': {
        const aOrder = GROUP_ORDER[a.agentState.group]
        const bOrder = GROUP_ORDER[b.agentState.group]
        cmp = aOrder - bOrder
        break
      }
      case 'last_active':
        cmp = a.lastActivityAt - b.lastActivityAt
        break
      case 'cost':
        cmp = sessionTotalCost(a) - sessionTotalCost(b)
        break
      case 'turns':
        cmp = a.turnCount - b.turnCount
        break
      case 'context':
        cmp = a.contextWindowTokens - b.contextWindowTokens
        break
      case 'project':
        cmp = (a.projectDisplayName || a.project).localeCompare(b.projectDisplayName || b.project)
        break
    }

    if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
    // Tiebreaker: most recently active first, whichever the direction
    return compareByLastActivityDesc(a, b)
  })
}

export function filterLiveSessions(
  sessions: LiveSession[],
  filters: LiveSessionFilters,
): LiveSession[] {
  let result = sessions

  // Status filter
  if (filters.statuses.length > 0) {
    result = result.filter((s) => filters.statuses.includes(s.agentState.group))
  }

  // Project filter (worktree-aware: match projectPath OR projectDisplayName OR encoded project)
  if (filters.projects.length > 0) {
    result = result.filter((s) =>
      filters.projects.some(
        (p) => p === s.projectPath || p === (s.projectDisplayName || s.project),
      ),
    )
  }

  // Branch filter
  if (filters.branches.length > 0) {
    result = result.filter(
      (s) => s.effectiveBranch !== null && filters.branches.includes(s.effectiveBranch),
    )
  }

  // Text search
  const query = filters.search.trim().toLowerCase()
  if (query) {
    result = result.filter((s) => {
      const project = (s.projectDisplayName || s.project).toLowerCase()
      const branch = (s.effectiveBranch ?? '').toLowerCase()
      const message = s.lastUserMessage.toLowerCase()
      return project.includes(query) || branch.includes(query) || message.includes(query)
    })
  }

  // Sort
  return sortLiveSessions(result, filters.sort, filters.sortDir)
}
