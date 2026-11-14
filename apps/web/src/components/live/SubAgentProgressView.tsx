import { Markdown } from '@claude-view/shared/components/conversation/blocks/shared/Markdown'
import type { ToolExecution } from '@claude-view/shared/types/blocks'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSubAgentProgress } from '../../hooks/use-subagent-progress'
import {
  type ProgressItem,
  buildProgressItems,
  describeToolCall,
  formatToolGroupSummary,
  isFailed,
  isRunning,
  shortToolName,
} from '../../lib/subagent-progress'
import { cn } from '../../lib/utils'

const OUTPUT_PREVIEW_CHARS = 4000

function inputPreview(call: ToolExecution): string {
  const input = call.toolInput ?? {}
  if (typeof input.command === 'string') return input.command
  return JSON.stringify(input, null, 2)
}

/** The call's description without the leading tool name (shown separately). */
function withoutToolName(call: ToolExecution): string {
  const text = describeToolCall(call)
  const prefix = `${call.toolName} `
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}

function ToolCallRow({ call, agentRunning }: { call: ToolExecution; agentRunning: boolean }) {
  const [open, setOpen] = useState(false)
  const failed = isFailed(call)
  const running = agentRunning && isRunning(call)
  const output = call.result?.output ?? ''
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full min-w-0 text-left text-xs py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800/60"
      >
        {running ? (
          <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin text-blue-500" />
        ) : failed ? (
          <X className="w-3 h-3 flex-shrink-0 text-red-500" />
        ) : (
          <Check className="w-3 h-3 flex-shrink-0 text-gray-400" />
        )}
        <span className="text-gray-400 dark:text-gray-500 font-mono flex-shrink-0">
          {shortToolName(call.toolName)}
        </span>
        <span
          className={cn(
            'truncate',
            failed ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300',
          )}
        >
          {withoutToolName(call)}
        </span>
      </button>
      {open && (
        <div className="ml-4 mt-1 mb-2 space-y-1">
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all rounded bg-gray-50 dark:bg-gray-900 p-2 max-h-40 overflow-auto text-gray-700 dark:text-gray-300">
            {inputPreview(call)}
          </pre>
          {output && (
            <pre
              className={cn(
                'text-[11px] font-mono whitespace-pre-wrap break-all rounded p-2 max-h-60 overflow-auto',
                failed
                  ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                  : 'bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400',
              )}
            >
              {output.length > OUTPUT_PREVIEW_CHARS
                ? `${output.slice(0, OUTPUT_PREVIEW_CHARS)}\n… (${output.length - OUTPUT_PREVIEW_CHARS} more characters)`
                : output}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

function ToolGroupRow({
  item,
  agentRunning,
}: {
  item: Extract<ProgressItem, { kind: 'tools' }>
  agentRunning: boolean
}) {
  const [open, setOpen] = useState(false)
  const s = item.summary
  const running = agentRunning ? s.running : null
  return (
    <div data-testid="progress-tool-group">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 w-full text-left text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1"
      >
        <span>{formatToolGroupSummary(s)}</span>
        {(s.linesAdded > 0 || s.linesRemoved > 0) && (
          <span className="font-mono text-xs" title="Lines added / removed by edits">
            <span className="text-green-600 dark:text-green-400">+{s.linesAdded}</span>{' '}
            <span className="text-red-500 dark:text-red-400">&minus;{s.linesRemoved}</span>
          </span>
        )}
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
        )}
      </button>
      {open && (
        <ul className="ml-1 pl-3 border-l border-gray-200 dark:border-gray-800 mb-1">
          {item.calls.map((call) => (
            <ToolCallRow key={call.toolUseId} call={call} agentRunning={agentRunning} />
          ))}
        </ul>
      )}
      {running && (
        <div
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 py-0.5"
          data-testid="progress-running"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" />
          <span className="truncate">Running {describeToolCall(running)}…</span>
        </div>
      )}
    </div>
  )
}

function PromptItem({ text, isTask }: { text: string; isTask: boolean }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 400 || text.split('\n').length > 6
  return (
    <div className="rounded-lg bg-gray-100 dark:bg-gray-800/70 px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
      <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
        {isTask ? 'Task' : 'Message'}
      </div>
      <div className={cn('whitespace-pre-wrap break-words', long && !open && 'line-clamp-6')}>
        {text}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
}

/**
 * Progress view of a sub-agent: its messages in order, with the tool calls
 * between them folded into one expandable summary row each. Follows the feed
 * while the helper runs (unless the reader has scrolled up).
 */
export function SubAgentProgressView({
  sessionId,
  agentId,
  agentRunning,
}: {
  sessionId: string
  agentId: string
  agentRunning: boolean
}) {
  const { blocks, isLoading, error } = useSubAgentProgress(sessionId, agentId, agentRunning)
  const items = useMemo(() => buildProgressItems(blocks), [blocks])
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the feed grows
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  if (error && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Sub-agent JSONL may not exist yet or session has ended
        </p>
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500 p-4">
        {isLoading ? 'Loading…' : 'No messages yet'}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
      className="h-full overflow-y-auto"
      data-testid="subagent-progress"
    >
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
        {items.map((item) =>
          item.kind === 'prompt' ? (
            <PromptItem key={item.id} text={item.text} isTask={item.isTask} />
          ) : item.kind === 'text' ? (
            <Markdown key={item.id} content={item.text} />
          ) : (
            <ToolGroupRow key={item.id} item={item} agentRunning={agentRunning} />
          ),
        )}
        {agentRunning && items[items.length - 1]?.kind !== 'tools' && (
          <div className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
          </div>
        )}
      </div>
    </div>
  )
}
