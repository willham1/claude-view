import { useMemo } from 'react'
import {
  LIST_PRICE_TITLE,
  type SubAgentContext,
  findSubAgentContext,
  subAgentCostUsd,
} from '../../hooks/use-subagent-context'
import { formatCostUsd } from '../../lib/format-utils'
import { getContextLimit } from '../../lib/model-context-windows'
import { cn } from '../../lib/utils'
import type { SubAgentInfo } from '../../types/generated/SubAgentInfo'
import { formatTokensCompact } from '../spinner/constants'

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
  return (
    <div
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-4 text-xs font-mono text-gray-400 dark:text-gray-500 [&>span]:whitespace-nowrap"
      data-testid="subagent-context"
      title={`${ctx.requestCount} request${ctx.requestCount !== 1 ? 's' : ''}; context = input + cache read + cache write tokens`}
    >
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
 * Clicking a row opens the terminal drill-down (when agentId is available).
 * Rows are sorted: running first (by startedAt), then completed (by completedAt desc).
 */
export function SwimLanes({ subAgents, onDrillDown, contexts }: SwimLanesProps) {
  // Sort: Running first (by startedAt asc), then Complete/Error (by completedAt desc)
  const sortedAgents = useMemo(() => {
    const running = subAgents
      .filter((a) => a.status === 'running')
      .sort((a, b) => a.startedAt - b.startedAt)

    const finished = subAgents
      .filter((a) => a.status !== 'running')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))

    return [...running, ...finished]
  }, [subAgents])

  if (subAgents.length === 0) return null

  const costs = subAgents.map((a) => subAgentCostUsd(a, contexts))
  const pricedCount = costs.filter((c) => c != null).length
  const totalCost = costs.reduce<number>((s, c) => s + (c ?? 0), 0)

  return (
    <div
      className={cn(
        'flex flex-col gap-1 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-2',
        subAgents.length > 5 && 'max-h-[360px] overflow-y-auto',
      )}
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

        return (
          <div
            key={agent.toolUseId}
            role={canDrillDown ? 'button' : undefined}
            tabIndex={canDrillDown ? 0 : undefined}
            onClick={
              canDrillDown
                ? () => onDrillDown(agent.agentId!, agent.agentType, agent.description)
                : undefined
            }
            onKeyDown={
              canDrillDown
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onDrillDown!(agent.agentId!, agent.agentType, agent.description)
                    }
                  }
                : undefined
            }
            className={cn(
              'flex flex-col gap-1 rounded-md px-2.5 py-2 transition-colors',
              canDrillDown && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50',
            )}
          >
            {/* Row 1: status + type + description + error tag */}
            <div className="flex items-center gap-2">
              <StatusDot status={agent.status} />
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400 uppercase tracking-wide flex-shrink-0">
                {agent.agentType}
              </span>
              <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">
                {agent.description}
              </span>
              {agent.status === 'error' && (
                <span className="text-xs font-semibold text-red-500 dark:text-red-400 uppercase flex-shrink-0">
                  ERR
                </span>
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
              <div className="pl-4 flex items-center gap-1.5">
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
                <span className="text-xs text-red-500/80 dark:text-red-400/70">
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
