import { useNowSeconds } from '../../hooks/use-now-seconds'
import {
  cacheRemainingSeconds,
  cacheRemainingTextColor,
  effectiveCacheTtl,
  formatCacheRemaining,
  formatCacheTtl,
} from '../../lib/cache-ttl'
import { getContextLimit } from '../../lib/model-context-windows'
import { cn } from '../../lib/utils'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'
import { formatTokensCompact } from '../spinner/constants'
import type { SessionPanelData } from './session-panel-data'

type GlanceData = Pick<
  SessionPanelData,
  | 'lastCacheHitAt'
  | 'cacheStatus'
  | 'cacheTtlSeconds'
  | 'contextWindowTokens'
  | 'model'
  | 'statuslineUsedPct'
  | 'statuslineContextWindowSize'
  | 'turnCount'
>

interface SessionGlanceStripProps {
  data: GlanceData
  subAgents: SubAgentInfo[]
  /** Live session: the cache countdown ticks; history shows no cache timer. */
  isLive: boolean
}

/**
 * One-line summary of the main session for the Sub-Agents tab, so the
 * prompt-cache timer, context fill and helper counts sit on the same screen
 * as the helper list.
 */
export function SessionGlanceStrip({ data, subAgents, isLive }: SessionGlanceStripProps) {
  const last = data.lastCacheHitAt ?? null
  const hasCache = isLive && last != null && last > 0
  const now = useNowSeconds(hasCache)
  const ttl = effectiveCacheTtl(data.cacheTtlSeconds)
  const remaining = hasCache ? cacheRemainingSeconds(last, ttl, now) : 0
  const ttlLabel = formatCacheTtl(ttl)

  const ctxTokens = data.contextWindowTokens ?? 0
  const limit = getContextLimit(data.model, ctxTokens, data.statuslineContextWindowSize)
  const ctxPct =
    ctxTokens > 0 ? Math.min(data.statuslineUsedPct ?? (ctxTokens / limit) * 100, 100) : null

  const running = subAgents.filter((a) => a.status === 'running').length
  const failed = subAgents.filter((a) => a.status === 'error').length
  const done = subAgents.length - running - failed

  const dot = <span className="text-gray-300 dark:text-gray-600">&middot;</span>

  return (
    <div
      className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-3 py-2 space-y-1.5"
      data-testid="session-glance"
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-mono text-gray-500 dark:text-gray-400 [&>span]:whitespace-nowrap">
        <span className="uppercase tracking-wide text-gray-500 dark:text-gray-500">Main</span>
        {hasCache && (
          <span
            className={cn('font-medium', cacheRemainingTextColor(remaining, ttl))}
            data-testid="session-glance-cache"
            title={
              remaining > 0
                ? `Main session's prompt cache (${ttlLabel} lifetime) is warm: your next message within this time reuses it (cheaper, faster).`
                : `Main session's prompt cache (${ttlLabel} lifetime) has expired: your next message re-sends the whole context at the higher cache-write price.`
            }
          >
            cache {remaining > 0 ? `${formatCacheRemaining(remaining)} left` : 'expired'} (
            {ttlLabel})
          </span>
        )}
        {hasCache && ctxPct != null && dot}
        {ctxPct != null && (
          <span title="Main session context window: tokens sent with the latest request">
            ctx {formatTokensCompact(ctxTokens)} / {formatTokensCompact(limit)}{' '}
            <span className="text-gray-700 dark:text-gray-300 tabular-nums">
              {Math.round(ctxPct)}%
            </span>
          </span>
        )}
        {data.turnCount > 0 && (
          <>
            {dot}
            <span>
              {data.turnCount} turn{data.turnCount !== 1 ? 's' : ''}
            </span>
          </>
        )}
        {dot}
        <span title="Sub-agents (helpers) in this session">
          helpers{' '}
          {running > 0 && (
            <span className="text-green-600 dark:text-green-400">{running} running</span>
          )}
          {running > 0 && (done > 0 || failed > 0) && ', '}
          {done > 0 && <span>{done} done</span>}
          {done > 0 && failed > 0 && ', '}
          {failed > 0 && <span className="text-red-500 dark:text-red-400">{failed} failed</span>}
        </span>
      </div>
      {hasCache && (
        <div className="h-1 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
          {remaining > 0 && (
            <div
              className={cn(
                'h-full rounded-full transition-all duration-1000',
                remaining / ttl < 0.2
                  ? 'bg-red-500'
                  : remaining / ttl < 0.6
                    ? 'bg-amber-500'
                    : 'bg-green-500',
              )}
              style={{ width: `${(remaining / ttl) * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  )
}
