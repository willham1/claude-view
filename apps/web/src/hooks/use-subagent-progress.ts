import type { ConversationBlock } from '@claude-view/shared/types/blocks'
import { normalizeBlocks } from '@claude-view/shared/utils/normalize-block'
import { useEffect, useState } from 'react'

/** How often a running helper's transcript is re-read. */
export const PROGRESS_POLL_MS = 3000
/** Upper bound on blocks fetched for the feed (the server parses the whole file anyway). */
const MAX_BLOCKS = 100_000

interface UseSubAgentProgressResult {
  blocks: ConversationBlock[]
  isLoading: boolean
  error: string | null
}

/**
 * All of a sub-agent's transcript blocks, for the Progress feed. Re-fetched
 * every few seconds while `live` is true, so a running helper's feed grows as
 * it works. State updates only when the response changed.
 */
export function useSubAgentProgress(
  sessionId: string,
  agentId: string,
  live: boolean,
): UseSubAgentProgressResult {
  const [blocks, setBlocks] = useState<ConversationBlock[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let lastBody = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(agentId)}/messages?limit=${MAX_BLOCKS}&offset=0&format=block`

    const load = async () => {
      try {
        const r = await fetch(url)
        const body = await r.text()
        if (cancelled) return
        if (!r.ok) {
          let msg = `HTTP ${r.status}`
          try {
            msg = JSON.parse(body).error ?? msg
          } catch {
            // keep the status text
          }
          setError(msg)
        } else {
          // Any good response clears an earlier error, changed or not.
          setError(null)
          if (body !== lastBody) {
            lastBody = body
            setBlocks(normalizeBlocks(JSON.parse(body).blocks ?? []))
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          if (live) timer = setTimeout(load, PROGRESS_POLL_MS)
        }
      }
    }
    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, agentId, live])

  return { blocks, isLoading, error }
}
