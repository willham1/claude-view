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
  requestCount: number
  startContextTokens: number
  currentContextTokens: number
  peakContextTokens: number
  lastActivityAt?: number
}

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
): SubAgentContext[] | undefined {
  const [data, setData] = useState<SubAgentContext[] | undefined>(undefined)

  useEffect(() => {
    if (!enabled || !sessionId) return
    let cancelled = false
    // In-flight guard: a poll tick is skipped while the previous request runs.
    let inFlight = false
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/subagents/context`
    const load = () => {
      if (inFlight) return
      inFlight = true
      fetch(url)
        .then((r) => (r.ok ? r.json() : undefined))
        .then((json) => {
          if (!cancelled && Array.isArray(json)) setData(json as SubAgentContext[])
        })
        .catch(() => {
          /* keep the last good data */
        })
        .finally(() => {
          inFlight = false
        })
    }
    load()
    if (!live) {
      return () => {
        cancelled = true
      }
    }
    const timer = setInterval(load, pollMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, enabled, live, pollMs])

  return data
}
