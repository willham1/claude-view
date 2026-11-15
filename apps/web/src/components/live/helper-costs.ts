/**
 * Session totals with helper cost (fork, LM7).
 *
 * A Live Monitor card shows the session's total: the main session plus its
 * helpers, the same figure as the session panel's header. Background helpers
 * report no usage to the parent transcript, so their cost comes from their own
 * transcripts. One request (`GET /api/sessions/subagents/costs?ids=…`) fetches
 * it for every session on the page that has helpers; the server reads only
 * transcripts that grew since its last read (per-file cache shared with the
 * Sub-Agents tab).
 */
import { useQueries } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { type SubAgentCost, subAgentCostUsd } from '../../hooks/use-subagent-context'
import { fetchTeamSidechains } from '../../hooks/use-teams'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'
import type { LiveSession } from './use-live-sessions'

/** Cost of a team member sidechain (only `costUsd` matters here). */
export interface SidechainCost {
  costUsd?: number | null
}

/**
 * Helper cost, by the Sub-Agents panel's rule: team sessions count their
 * member sidechains (the same files sub-agent costs come from), others each
 * sub-agent's cost from its own transcript, else what the parent transcript
 * reported for it. Never both.
 */
export function helperCostUsd(
  subAgents: SubAgentInfo[] | undefined,
  transcriptCosts: SubAgentCost[] | undefined,
  sidechains?: SidechainCost[] | null,
): number {
  if (sidechains && sidechains.length > 0) {
    return sidechains.reduce((s, sc) => s + (sc.costUsd ?? 0), 0)
  }
  return subAgents?.reduce((s, a) => s + (subAgentCostUsd(a, transcriptCosts) ?? 0), 0) ?? 0
}

/** Main session plus helpers: the figure a card and the panel header show. */
export function sessionCostWithHelpers(
  session: { cost?: { totalUsd: number } | null; subAgents?: SubAgentInfo[] },
  transcriptCosts: SubAgentCost[] | undefined,
  sidechains?: SidechainCost[] | null,
): number {
  return (
    (session.cost?.totalUsd ?? 0) + helperCostUsd(session.subAgents, transcriptCosts, sidechains)
  )
}

interface HelperCostState {
  /** Per sub-agent transcript cost, by parent session id. */
  costs: Record<string, SubAgentCost[]>
  /** Team member sidechains, by lead session id (team sessions only). */
  sidechains: Record<string, SidechainCost[]>
  setCosts: (costs: Record<string, SubAgentCost[]>) => void
  setSidechains: (sidechains: Record<string, SidechainCost[]>) => void
}

export const useHelperCostStore = create<HelperCostState>((set) => ({
  costs: {},
  sidechains: {},
  setCosts: (costs) => set({ costs }),
  setSidechains: (sidechains) => set({ sidechains }),
}))

/**
 * A project group header's figure: the sum of its (active) sessions' card
 * totals. The group's `totalCostUsd`, which the "cost" sort uses, is unchanged.
 */
export function projectCostWithHelpers(
  project: { branches: { sessions: LiveSession[] }[] },
  costs: Record<string, SubAgentCost[]>,
  sidechains: Record<string, SidechainCost[]>,
): number {
  let sum = 0
  for (const b of project.branches) {
    for (const s of b.sessions) sum += sessionCostWithHelpers(s, costs[s.id], sidechains[s.id])
  }
  return sum
}

/** The polled helper costs, for group headers. */
export function useHelperCostMaps() {
  const costs = useHelperCostStore((s) => s.costs)
  const sidechains = useHelperCostStore((s) => s.sidechains)
  return { costs, sidechains }
}

/** Ids of the sessions whose helper cost is worth fetching, sorted. */
export function helperCostIds(sessions: LiveSession[]): string[] {
  return sessions
    .filter((s) => (s.subAgents?.length ?? 0) > 0)
    .map((s) => s.id)
    .sort()
}

/**
 * Poll helper costs for `sessions` (mount once per page). One request every
 * `pollMs` for all sessions with helpers; a tick is skipped while one runs,
 * and a stalled request is aborted after `timeoutMs`. Team sessions' sidechains
 * come from the same React Query cache the card and panel use.
 */
export function useHelperCostPolling(sessions: LiveSession[], pollMs = 5000, timeoutMs = 15000) {
  const setCosts = useHelperCostStore((s) => s.setCosts)
  const setSidechains = useHelperCostStore((s) => s.setSidechains)
  const idsKey = helperCostIds(sessions).join(',')

  useEffect(() => {
    if (!idsKey) {
      setCosts({})
      return
    }
    let cancelled = false
    let inFlight = false
    let current: AbortController | null = null
    const url = `/api/sessions/subagents/costs?ids=${encodeURIComponent(idsKey)}`
    const load = () => {
      if (inFlight) return
      inFlight = true
      const controller = new AbortController()
      current = controller
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      fetch(url, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : undefined))
        .then((json) => {
          if (!cancelled && json && typeof json === 'object' && !Array.isArray(json)) {
            setCosts(json as Record<string, SubAgentCost[]>)
          }
        })
        .catch(() => {
          /* keep the last good data */
        })
        .finally(() => {
          clearTimeout(timeout)
          if (current === controller) current = null
          inFlight = false
        })
    }
    load()
    const timer = setInterval(load, pollMs)
    return () => {
      cancelled = true
      clearInterval(timer)
      current?.abort()
    }
  }, [idsKey, pollMs, timeoutMs, setCosts])

  // Team sessions: same query keys as useTeamSidechains, so no extra requests.
  const teamsKey = sessions
    .filter((s) => s.teamName)
    .map((s) => `${s.id}\n${s.teamName}`)
    .join('\t')
  const teams = useMemo(
    () =>
      teamsKey
        ? teamsKey.split('\t').map((pair) => {
            const [id, team] = pair.split('\n')
            return { id, team }
          })
        : [],
    [teamsKey],
  )
  const results = useQueries({
    queries: teams.map(({ id, team }) => ({
      queryKey: ['team-sidechains', team, id, 0],
      queryFn: () => fetchTeamSidechains(team, id),
      staleTime: 60_000,
    })),
  })
  const sidechainKey = results.map((r) => r.dataUpdatedAt).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when any query's data changes
  useEffect(() => {
    const next: Record<string, SidechainCost[]> = {}
    teams.forEach(({ id }, i) => {
      const data = results[i]?.data
      if (data) next[id] = data
    })
    setSidechains(next)
  }, [sidechainKey, teams, setSidechains])
}
