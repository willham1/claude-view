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
import { CacheCountdownTooltip } from '../spinner/SessionSpinner'
import { formatTokensCompact } from '../spinner/constants'
import { subAgentModelLabel } from './SwimLanes'
import type { LiveSession } from './use-live-sessions'

type DetailFields = Pick<
  LiveSession,
  | 'model'
  | 'effort'
  | 'contextWindowTokens'
  | 'startContextTokens'
  | 'peakContextTokens'
  | 'requestCount'
  | 'turnCount'
  | 'lastCacheHitAt'
  | 'cacheTtlSeconds'
  | 'statuslineContextWindowSize'
  | 'statuslineUsedPct'
  | 'subAgents'
>

const DOT = <span className="text-gray-300 dark:text-gray-600">&middot;</span>

/** The main session's prompt-cache countdown, ticking every second. */
function CardCacheTimer({
  lastCacheHitAt,
  cacheTtlSeconds,
}: Pick<DetailFields, 'lastCacheHitAt' | 'cacheTtlSeconds'>) {
  const last = lastCacheHitAt ?? null
  const hasCache = last != null && last > 0
  const now = useNowSeconds(hasCache)
  if (!hasCache) {
    return (
      <span data-testid="card-cache" title="No prompt-cache activity yet">
        cache –
      </span>
    )
  }
  const ttl = effectiveCacheTtl(cacheTtlSeconds)
  const remaining = cacheRemainingSeconds(last, ttl, now)
  return (
    <CacheCountdownTooltip remaining={remaining} ttl={ttl}>
      <span
        className={cn('cursor-default', cacheRemainingTextColor(remaining, ttl))}
        data-testid="card-cache"
      >
        cache {remaining > 0 ? `${formatCacheRemaining(remaining)} left` : 'expired'} (
        {formatCacheTtl(ttl)})
      </span>
    </CacheCountdownTooltip>
  )
}

/**
 * Detail lines of a Live Monitor session card, the same whatever the
 * session's state (the owner asked for the Sub-Agents tab's level of detail):
 *
 * 1. model and effort level of the latest request, requests, turns, and the
 *    prompt-cache countdown;
 * 2. context window: at the first request, now, at its peak, against the
 *    window, with a percentage;
 * 3. helper counts, when the session has helpers.
 *
 * Every field is optional so a card from an older server still renders.
 */
export function SessionCardDetails({ session }: { session: DetailFields }) {
  const modelLabel = subAgentModelLabel(session.model ?? undefined)
  const requests = session.requestCount ?? 0
  const turns = session.turnCount ?? 0

  const now = session.contextWindowTokens ?? 0
  const start = session.startContextTokens ?? 0
  // 0 = not reported (a server from before LM4): leave start and peak out.
  const peakReported = session.peakContextTokens ?? 0
  const peak = peakReported > 0 ? Math.max(peakReported, now) : 0
  // Same window lookup as the card's context bar (ContextGauge), so both agree.
  const limit = getContextLimit(session.model, now, session.statuslineContextWindowSize)
  const pct = now > 0 ? Math.min(session.statuslineUsedPct ?? (now / limit) * 100, 100) : null

  const helpers = session.subAgents ?? []
  const running = helpers.filter((a) => a.status === 'running').length
  const failed = helpers.filter((a) => a.status === 'error').length
  const done = helpers.length - running - failed

  const lineCls =
    'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-mono text-gray-400 dark:text-gray-500 [&>span]:whitespace-nowrap'

  return (
    <div className="space-y-0.5 mb-2" data-testid="card-details">
      <div className={lineCls} data-testid="card-model-line">
        <span
          className="text-gray-600 dark:text-gray-300"
          data-testid="card-model"
          title={session.model ? `Model of the latest request: ${session.model}` : undefined}
        >
          {modelLabel ?? 'model –'}
        </span>
        {session.effort && (
          <span data-testid="card-effort" title="Effort level of the latest request">
            {session.effort} effort
          </span>
        )}
        {requests > 0 && (
          <>
            {DOT}
            <span title="Model requests in this session">
              {requests} req{requests !== 1 ? 's' : ''}
            </span>
          </>
        )}
        {turns > 0 && (
          <>
            {DOT}
            <span title="Your prompts in this session">
              {turns} turn{turns !== 1 ? 's' : ''}
            </span>
          </>
        )}
        {DOT}
        <CardCacheTimer
          lastCacheHitAt={session.lastCacheHitAt}
          cacheTtlSeconds={session.cacheTtlSeconds}
        />
      </div>

      {now > 0 && (
        <div
          className={lineCls}
          data-testid="card-context-line"
          title="Context window: tokens sent with a request (input + cache read + cache write)"
        >
          <span className="text-gray-500 dark:text-gray-400">ctx</span>
          {start > 0 && (
            <>
              <span>start {formatTokensCompact(start)}</span>
              {DOT}
            </>
          )}
          <span className="text-gray-700 dark:text-gray-300">now {formatTokensCompact(now)}</span>
          {peak > 0 && (
            <>
              {DOT}
              <span>peak {formatTokensCompact(peak)}</span>
            </>
          )}
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span>{formatTokensCompact(limit)}</span>
          {pct != null && (
            <span className="tabular-nums text-gray-600 dark:text-gray-300">
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}

      {helpers.length > 0 && (
        // No nowrap here: "helpers 3 running, 1 done, 1 failed" wraps on a narrow card.
        <div
          className="text-xs font-mono text-gray-400 dark:text-gray-500"
          data-testid="card-helpers-line"
        >
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
      )}
    </div>
  )
}
