import { ErrorBoundary } from '@claude-view/shared/components/ErrorBoundary'
import { ConversationThread } from '@claude-view/shared/components/conversation/ConversationThread'
import { chatRegistry } from '@claude-view/shared/components/conversation/blocks/chat/registry'
import { developerRegistry } from '@claude-view/shared/components/conversation/blocks/developer/registry'
import { Code, ListChecks, MessageSquare, X } from 'lucide-react'
import { useState } from 'react'
import { useSubAgentBlocks } from '../../hooks/use-subagent-blocks'
import { cn } from '../../lib/utils'
import { useMonitorStore } from '../../store/monitor-store'
import { SubAgentProgressView } from './SubAgentProgressView'

interface SubAgentBlockViewProps {
  sessionId: string
  agentId: string
  agentType: string
  description: string
  /** The helper is still running: the Progress view follows it live. */
  isRunning?: boolean
  onClose: () => void
}

/** Which view of the helper is shown: Progress, or the Chat/Developer transcript. */
export type SubAgentView = 'progress' | 'chat' | 'developer'

/** Progress / Chat / Developer switch. Chat and Developer also set the app-wide display mode. */
export function SubAgentViewToggle({
  view,
  onChange,
}: {
  view: SubAgentView
  onChange: (view: SubAgentView) => void
}) {
  const options: { id: SubAgentView; label: string; icon: typeof Code; active: string }[] = [
    {
      id: 'progress',
      label: 'Progress',
      icon: ListChecks,
      active: 'bg-emerald-500/10 text-emerald-500',
    },
    { id: 'chat', label: 'Chat', icon: MessageSquare, active: 'bg-blue-500/10 text-blue-400' },
    { id: 'developer', label: 'Developer', icon: Code, active: 'bg-purple-500/10 text-purple-400' },
  ]
  return (
    <div
      className="inline-flex flex-shrink-0 rounded-md border border-gray-200 dark:border-gray-700 divide-x divide-gray-200 dark:divide-gray-700"
      role="tablist"
    >
      {options.map(({ id, label, icon: Icon, active }, i) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          onClick={() => onChange(id)}
          className={cn(
            'px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors',
            i === 0 && 'rounded-l-md',
            i === options.length - 1 && 'rounded-r-md',
            view === id ? active : 'text-gray-400 hover:text-gray-300',
          )}
        >
          <Icon className="w-3 h-3 inline mr-0.5 -mt-0.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

function SubAgentTranscript({
  sessionId,
  agentId,
  mode,
}: {
  sessionId: string
  agentId: string
  mode: 'chat' | 'developer'
}) {
  const registry = mode === 'chat' ? chatRegistry : developerRegistry
  const { blocks, isLoading, isFetchingOlder, hasOlderMessages, fetchOlder, error } =
    useSubAgentBlocks({ sessionId, agentId, enabled: true })

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Sub-agent JSONL may not exist yet or session has ended
        </p>
      </div>
    )
  }
  if (blocks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500 p-4">
        {isLoading ? 'Loading…' : 'No messages yet'}
      </div>
    )
  }
  return (
    <ErrorBoundary>
      <ConversationThread
        blocks={blocks}
        renderers={registry}
        filterBar={mode === 'developer'}
        onStartReached={fetchOlder}
        isFetchingOlder={isFetchingOlder}
        hasOlderMessages={hasOlderMessages}
      />
    </ErrorBoundary>
  )
}

export function SubAgentBlockView({
  sessionId,
  agentId,
  agentType,
  description,
  isRunning = false,
  onClose,
}: SubAgentBlockViewProps) {
  const setDisplayMode = useMonitorStore((s) => s.setDisplayMode)
  // Progress is the default each time a helper is opened.
  const [view, setView] = useState<SubAgentView>('progress')
  const changeView = (next: SubAgentView) => {
    setView(next)
    if (next !== 'progress') setDisplayMode(next)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate min-w-0">
            {agentType}
          </span>
          <div className="flex-1" />
          {isRunning && (
            <span className="text-xs font-mono flex-shrink-0 text-green-600 dark:text-green-400">
              running
            </span>
          )}
          <SubAgentViewToggle view={view} onChange={changeView} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sub-agent view"
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-0.5 flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-0.5 text-xs select-text">
          <span className="text-gray-700 dark:text-gray-300 break-words">{description}</span>
          <span className="ml-2 font-mono text-gray-400 dark:text-gray-500">{agentId}</span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {view === 'progress' ? (
          <SubAgentProgressView sessionId={sessionId} agentId={agentId} agentRunning={isRunning} />
        ) : (
          <SubAgentTranscript sessionId={sessionId} agentId={agentId} mode={view} />
        )}
      </div>
    </div>
  )
}
