import { useEffect, useState } from 'react'
import type { SubAgentInfo } from '../types/generated/SubAgentInfo'

/**
 * Context-window usage of one sub-agent, read by the server from the
 * sub-agent's own transcript (`subagents/agent-{id}.jsonl`).
 * Context of a request = input + cache read + cache creation tokens.
 */
export interface SubAgentContext {
  agentId: string
  toolUseId?: string
  model?: string
  /** Effort level of the latest request (`low` … `max`), when recorded. */
  effort?: string
  requestCount: number
  startContextTokens: number
  currentContextTokens: number
  peakContextTokens: number
  lastActivityAt?: number
  /**
   * Cost of the sub-agent's own requests at Anthropic list prices (USD), from
   * its transcript usage; cache writes priced by their 5m/1h split.
   */
  costUsd?: number
  /** Some requests used a model with no known price (left out of costUsd). */
  hasUnpricedUsage?: boolean
}

/**
 * Cost of one sub-agent: from its own transcript when known, else the cost
 * the parent transcript reported for it (foreground agents only).
 */
export function subAgentCostUsd(
  agent: Pick<SubAgentInfo, 'agentId' | 'toolUseId' | 'costUsd'>,
  contexts: SubAgentContext[] | undefined,
): number | null {
  const fromTranscript = findSubAgentContext(agent, contexts)?.costUsd
  if (fromTranscript != null) return fromTranscript
  return agent.costUsd ?? null
}

/** Sub-agents with `costUsd` filled from their transcripts where known. */
export function withTranscriptCosts(
  agents: SubAgentInfo[] | undefined,
  contexts: SubAgentContext[] | undefined,
): SubAgentInfo[] | undefined {
  if (!agents || !contexts || contexts.length === 0) return agents
  return agents.map((a) => {
    const cost = subAgentCostUsd(a, contexts)
    return cost === (a.costUsd ?? null) ? a : { ...a, costUsd: cost }
  })
}

/** Tooltip text for list-price figures (the owner is on a subscription). */
export const LIST_PRICE_TITLE =
  'List-price equivalent: what these tokens would cost at Anthropic API rates. Not billed on a subscription.'

/** Find the context entry for a sub-agent: by agentId, else by spawning toolUseId. */
export function findSubAgentContext(
  agent: Pick<SubAgentInfo, 'agentId' | 'toolUseId'>,
  contexts: SubAgentContext[] | undefined,
): SubAgentContext | undefined {
  if (!contexts || contexts.length === 0) return undefined
  if (agent.agentId) {
    const byId = contexts.find((c) => c.agentId === agent.agentId)
    if (byId) return byId
  }
  return contexts.find((c) => c.toolUseId != null && c.toolUseId === agent.toolUseId)
}

/**
 * Fetch per-sub-agent context usage for a session.
 * Polls every `pollMs` while `live` is true; fetches once otherwise.
 */
export function useSubAgentContext(
  sessionId: string,
  enabled: boolean,
  live: boolean,
  pollMs = 5000,
  timeoutMs = 15000,
): SubAgentContext[] | undefined {
  const [data, setData] = useState<SubAgentContext[] | undefined>(undefined)

  useEffect(() => {
    if (!enabled || !sessionId) return
    let cancelled = false
    // In-flight guard: a poll tick is skipped while the previous request runs.
    // Each request is aborted after `timeoutMs`, so a stalled request cannot
    // hold the guard forever and freeze the figures.
    let inFlight = false
    let current: AbortController | null = null
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/subagents/context`
    const load = () => {
      if (inFlight) return
      inFlight = true
      const controller = new AbortController()
      current = controller
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      fetch(url, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : undefined))
        .then((json) => {
          if (!cancelled && Array.isArray(json)) setData(json as SubAgentContext[])
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
    if (!live) {
      return () => {
        cancelled = true
        current?.abort()
      }
    }
    const timer = setInterval(load, pollMs)
    return () => {
      cancelled = true
      clearInterval(timer)
      current?.abort()
    }
  }, [sessionId, enabled, live, pollMs])

  return data
}
