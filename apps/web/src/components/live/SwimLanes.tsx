import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { useNowSeconds } from '../../hooks/use-now-seconds'
import {
  LIST_PRICE_TITLE,
  type SubAgentContext,
  findSubAgentContext,
  subAgentCostUsd,
} from '../../hooks/use-subagent-context'
import {
  cacheRemainingSeconds,
  cacheRemainingTextColor,
  effectiveCacheTtl,
  formatCacheRemaining,
  formatCacheTtl,
} from '../../lib/cache-ttl'
import { formatModelName } from '../../lib/format-model'
import { formatCostUsd } from '../../lib/format-utils'
import { getContextLimit } from '../../lib/model-context-windows'
import { cn } from '../../lib/utils'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'
import { formatTokensCompact } from '../spinner/constants'
import { sortSubAgentsByLastActive } from './sort-sub-agents'

/** True while the user has text selected (a drag-select must not open the helper). */
function hasTextSelection(): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  return !!sel && !sel.isCollapsed && sel.toString().trim() !== ''
}

interface SwimLanesProps {
  subAgents: SubAgentInfo[]
  /** Whether the parent session is still active (reserved for future use) */
  sessionActive?: boolean
  /** Called when a sub-agent row is clicked to drill down into its conversation */
  onDrillDown?: (agentId: string, agentType: string, description: string) => void
  /** Per-sub-agent context-window usage read from the sub-agent transcripts. */
  contexts?: SubAgentContext[]
}

/**
 * Window size for a sub-agent, from the same lookup the main session's
 * Context Window panel uses (`getContextLimit`: the model's window from
 * Claude Code's model table, a `[1m]` marker, else 200k with the fill-based
 * 1M guess). Returns null only when no model is known.
 */
export function subAgentWindowSize(ctx: SubAgentContext): number | null {
  const model = ctx.model ?? null
  if (model == null || model === '') return null
  return getContextLimit(model, ctx.peakContextTokens)
}

/**
 * Short model name for a sub-agent row: "claude-opus-5-5" → "Opus 5.5".
 * Drops Claude Code's "[1m]" window marker. Null when no model is known.
 */
export function subAgentModelLabel(model: string | undefined): string | null {
  if (!model) return null
  const bare = model.replace(/\[1m\]$/i, '')
  if (!bare) return null
  return formatModelName(bare).replace(/^Claude /, '')
}

/**
 * Live prompt-cache countdown for one sub-agent: its cache stays warm for
 * its cache lifetime (1h or 5m) after its latest request.
 */
export function SubAgentCacheTimer({ ctx }: { ctx: SubAgentContext }) {
  const last = ctx.lastActivityAt
  const ttl = effectiveCacheTtl(ctx.cacheTtlSeconds)
  const now = useNowSeconds(last != null)
  if (last == null || last <= 0) return null
  const remaining = cacheRemainingSeconds(last, ttl, now)
  const ttlLabel = formatCacheTtl(ttl)
  return (
    <span
      className={cacheRemainingTextColor(remaining, ttl)}
      data-testid="subagent-cache"
      title={
        remaining > 0
          ? `This helper's prompt cache (${ttlLabel} lifetime) stays warm until ${formatCacheRemaining(remaining)} from now. Messaging it before then reuses the cache (cheaper, faster).`
          : `This helper's prompt cache (${ttlLabel} lifetime) has expired. Messaging it again re-sends its whole context at the higher cache-write price.`
      }
    >
      cache {remaining > 0 ? `${formatCacheRemaining(remaining)} left` : 'expired'} ({ttlLabel})
    </span>
  )
}

/**
 * Context-window line for one sub-agent: size at its first request, now, and
 * at its largest request.
 *
 * A fill bar and percentage are shown when the window size is known
 * (`windowSize`, see `subAgentWindowSize`); otherwise tokens only.
 */
export function SubAgentContextRow({
  ctx,
  windowSize,
}: {
  ctx: SubAgentContext
  windowSize?: number | null
}) {
  const limit = windowSize != null && windowSize > 0 ? windowSize : null
  const pct = limit ? Math.min((ctx.currentContextTokens / limit) * 100, 100) : null
  const barColor =
    pct == null ? '' : pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-sky-500'
  const dot = <span className="text-gray-300 dark:text-gray-600">&middot;</span>
  const modelLabel = subAgentModelLabel(ctx.model)
  return (
    <div
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-4 text-xs font-mono text-gray-400 dark:text-gray-500 [&>span]:whitespace-nowrap"
      data-testid="subagent-context"
      title={`${ctx.requestCount} request${ctx.requestCount !== 1 ? 's' : ''}; context = input + cache read + cache write tokens`}
    >
      {modelLabel && (
        <span
          className="text-gray-600 dark:text-gray-300"
          data-testid="subagent-model"
          title={`Model of the latest request: ${ctx.model}`}
        >
          {modelLabel}
        </span>
      )}
      {ctx.effort && (
        <span data-testid="subagent-effort" title="Effort level of the latest request">
          {ctx.effort} effort
        </span>
      )}
      {(modelLabel || ctx.effort) && dot}
      <span className="text-gray-500 dark:text-gray-400">ctx</span>
      <span>start {formatTokensCompact(ctx.startContextTokens)}</span>
      {dot}
      <span className="text-gray-700 dark:text-gray-300">
        now {formatTokensCompact(ctx.currentContextTokens)}
      </span>
      {dot}
      <span>peak {formatTokensCompact(ctx.peakContextTokens)}</span>
      {limit != null && pct != null && (
        <>
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span>{formatTokensCompact(limit)}</span>
          <div className="ml-1 w-16 h-1 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden flex-shrink-0">
            <div className={cn(barColor, 'h-full rounded-full')} style={{ width: `${pct}%` }} />
          </div>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </>
      )}
      <span>
        &middot; {ctx.requestCount} req{ctx.requestCount !== 1 ? 's' : ''}
      </span>
      {ctx.lastActivityAt != null && ctx.lastActivityAt > 0 && (
        <>
          {dot}
          <SubAgentCacheTimer ctx={ctx} />
        </>
      )}
    </div>
  )
}

function formatCost(usd: number): string {
  return formatCostUsd(usd)
}

/** Format duration from milliseconds to human-readable string */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

/** Status dot component with color based on agent status */
function StatusDot({ status }: { status: SubAgentInfo['status'] }) {
  const colorClass = {
    running: 'bg-green-500',
    complete: 'bg-gray-400 dark:bg-gray-500',
    error: 'bg-red-500',
  }[status]

  return <div className={cn('w-2 h-2 rounded-full flex-shrink-0', colorClass)} />
}

/** Animated indeterminate progress bar for running agents */
function ProgressBar() {
  return (
    <div className="w-full h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
      <div
        className="h-full bg-blue-500 rounded-full"
        style={{
          animation: 'swimlane-progress 1.5s ease-in-out infinite',
        }}
      />
    </div>
  )
}

/**
 * SwimLanes — flat list of sub-agents with all info visible.
 *
 * Each row shows:
 * - Status dot (green=running, gray=complete, red=error)
 * - Agent type badge
 * - Description text
 * - For running: current activity or progress bar
 * - For finished: cost, duration, tool call count
 * - When known: context window (start / now / peak) from the sub-agent transcript
 *
 * Clicking a row (or its Open button) opens the helper's view (when agentId
 * is available). The task title is plain selectable text: clicking or
 * dragging over it, or any click that ends a text selection, doesn't open.
 * Rows are sorted by last activity, most recent first, and re-sort as the
 * transcripts update.
 */
export function SwimLanes({ subAgents, onDrillDown, contexts }: SwimLanesProps) {
  const sortedAgents = useMemo(
    () => sortSubAgentsByLastActive(subAgents, contexts),
    [subAgents, contexts],
  )

  if (subAgents.length === 0) return null

  const costs = subAgents.map((a) => subAgentCostUsd(a, contexts))
  const pricedCount = costs.filter((c) => c != null).length
  const totalCost = costs.reduce<number>((s, c) => s + (c ?? 0), 0)

  return (
    <div
      // No height cap: the Sub-Agents tab scrolls this area, and a cap left an
      // empty gap above the timeline on tall panels.
      className="flex flex-col gap-1 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-2"
    >
      {pricedCount > 0 && (
        <div
          className="flex items-center gap-1.5 px-2.5 pb-1 text-xs font-mono text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/60"
          title={LIST_PRICE_TITLE}
          data-testid="subagent-cost-total"
        >
          <span>
            {subAgents.length} sub-agent{subAgents.length !== 1 ? 's' : ''}:
          </span>
          <span className="text-gray-700 dark:text-gray-300 tabular-nums">
            {formatCost(totalCost)}
          </span>
          <span className="text-gray-400 dark:text-gray-500">
            list price
            {pricedCount < subAgents.length ? ` (${pricedCount} priced)` : ''}
          </span>
        </div>
      )}
      {sortedAgents.map((agent) => {
        const canDrillDown = !!agent.agentId && !!onDrillDown
        const ctx = findSubAgentContext(agent, contexts)
        const cost = subAgentCostUsd(agent, contexts)
        const open = () => {
          if (agent.agentId) onDrillDown?.(agent.agentId, agent.agentType, agent.description)
        }

        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users open the helper with the row's Open button
          <div
            key={agent.toolUseId}
            data-testid="subagent-row"
            onClick={
              canDrillDown
                ? () => {
                    if (!hasTextSelection()) open()
                  }
                : undefined
            }
            className={cn(
              'group flex flex-col gap-1 rounded-md px-2.5 py-2 transition-colors',
              canDrillDown && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50',
            )}
          >
            {/* Row 1: status + type + description + error tag + open */}
            <div className="flex items-start gap-2">
              <span className="pt-1.5">
                <StatusDot status={agent.status} />
              </span>
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400 uppercase tracking-wide flex-shrink-0 pt-0.5">
                {agent.agentType}
              </span>
              {/* Selectable title: clicks here never open the helper. */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the row's click; no action of its own */}
              <span
                className="text-sm text-gray-700 dark:text-gray-300 flex-1 min-w-0 break-words select-text cursor-text"
                data-testid="subagent-title"
                onClick={(e) => e.stopPropagation()}
              >
                {agent.description}
              </span>
              {agent.status === 'error' && (
                <span className="text-xs font-semibold text-red-500 dark:text-red-400 uppercase flex-shrink-0 pt-0.5">
                  ERR
                </span>
              )}
              {canDrillDown && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    open()
                  }}
                  aria-label={`Open ${agent.agentType}: ${agent.description}`}
                  className="flex-shrink-0 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 hover:bg-blue-500/10"
                >
                  Open
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Row 2: metrics (finished) or activity (running) or error reason */}
            {agent.status === 'running' ? (
              <div className="pl-4 flex items-center gap-2">
                {agent.currentActivity ? (
                  <span className="text-xs font-mono text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                    {agent.currentActivity}
                  </span>
                ) : (
                  <ProgressBar />
                )}
                {cost != null && (
                  <span
                    className="text-xs font-mono text-gray-400 dark:text-gray-500 flex-shrink-0"
                    title={LIST_PRICE_TITLE}
                    data-testid="subagent-cost"
                  >
                    {formatCost(cost)} so far
                  </span>
                )}
                {!agent.agentId && onDrillDown && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                    awaiting agent ID...
                  </span>
                )}
              </div>
            ) : agent.status === 'error' && agent.errorReason ? (
              <div className="pl-4 flex items-center gap-1.5 min-w-0">
                {cost != null && (
                  <>
                    <span
                      className="text-xs font-mono text-gray-400 dark:text-gray-500"
                      title={LIST_PRICE_TITLE}
                      data-testid="subagent-cost"
                    >
                      {formatCost(cost)}
                    </span>
                    <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                  </>
                )}
                <span
                  className="text-xs text-red-500/80 dark:text-red-400/70 line-clamp-2"
                  title={agent.errorReason}
                >
                  {agent.errorReason}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 pl-4 text-xs font-mono text-gray-400 dark:text-gray-500">
                {cost != null && (
                  <span title={LIST_PRICE_TITLE} data-testid="subagent-cost">
                    {formatCost(cost)}
                  </span>
                )}
                {cost != null && agent.durationMs != null && (
                  <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                )}
                {agent.durationMs != null && <span>{formatDuration(agent.durationMs)}</span>}
                {agent.durationMs != null && agent.toolUseCount != null && (
                  <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                )}
                {agent.toolUseCount != null && (
                  <span>
                    {agent.toolUseCount} tool call
                    {agent.toolUseCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}

            {/* Row 3: context window (from the sub-agent's own transcript) */}
            {ctx && ctx.requestCount > 0 && (
              <SubAgentContextRow ctx={ctx} windowSize={subAgentWindowSize(ctx)} />
            )}
          </div>
        )
      })}
    </div>
  )
}
