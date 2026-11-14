import { type SubAgentContext, findSubAgentContext } from '../../hooks/use-subagent-context'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'

/**
 * When a sub-agent was last active (unix seconds): the latest of its latest
 * request (from its own transcript), its completion and its start.
 */
export function subAgentLastActiveAt(agent: SubAgentInfo, contexts?: SubAgentContext[]): number {
  const ctx = findSubAgentContext(agent, contexts)
  return Math.max(agent.startedAt ?? 0, agent.completedAt ?? 0, ctx?.lastActivityAt ?? 0)
}

/**
 * Orders sub-agents for the Sub-Agents tab: most recently active first.
 * Ties go to running agents, then keep spawn order. Pure and non-mutating.
 */
export function sortSubAgentsByLastActive(
  subAgents: SubAgentInfo[],
  contexts?: SubAgentContext[],
): SubAgentInfo[] {
  const keyed = subAgents.map((a, i) => ({ a, i, t: subAgentLastActiveAt(a, contexts) }))
  keyed.sort((x, y) => {
    if (y.t !== x.t) return y.t - x.t
    const run = (x.a.status === 'running' ? 0 : 1) - (y.a.status === 'running' ? 0 : 1)
    if (run !== 0) return run
    return x.i - y.i
  })
  return keyed.map((k) => k.a)
}

/**
 * Orders sub-agents for compact card display: running (active) agents first,
 * then newest-spawned first within each tier.
 *
 * Sub-agents arrive appended in spawn order (oldest-first), so a naive
 * `slice(0, N)` surfaces the oldest agents and pushes the ones currently
 * doing work into the `+N more` overflow. Sorting active + newest first means
 * the visible slice always shows the most relevant agents and the overflow
 * hides the *oldest* ones instead.
 *
 * Pure and non-mutating — sub-agent lists arrive as React props / store-owned
 * data and must never be sorted in place. `Array.prototype.sort` is stable
 * (ES2019+), so agents sharing a tier and `startedAt` keep their spawn order.
 *
 * @see https://github.com/tombelieber/claude-view/issues/62
 */
export function sortSubAgentsForCard(subAgents: SubAgentInfo[]): SubAgentInfo[] {
  const runningRank = (a: SubAgentInfo): number => (a.status === 'running' ? 0 : 1)
  return [...subAgents].sort((a, b) => {
    const tier = runningRank(a) - runningRank(b)
    if (tier !== 0) return tier
    return b.startedAt - a.startedAt
  })
}
