import type { ConversationBlock, ToolExecution } from '@claude-view/shared/types/blocks'

/**
 * Progress feed for one sub-agent, in the style of the Claude desktop app's
 * sub-agent view: the helper's own words, with each run of tool calls between
 * them folded into one summary row ("Ran 8 commands, edited 2 files, 1 failed").
 */
export type ProgressItem =
  /** A message to the helper: its task (the first one) or a later message. */
  | { kind: 'prompt'; id: string; text: string; isTask: boolean }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tools'; id: string; calls: ToolExecution[]; summary: ToolGroupSummary }

export interface ToolGroupSummary {
  /** Shell commands run (Bash and friends). */
  commands: number
  /** Distinct files read. */
  filesRead: number
  /** Distinct files edited or written. */
  filesEdited: number
  /** Searches (Grep, Glob, web search/fetch). */
  searches: number
  /** Helpers started from inside this helper. */
  agents: number
  /** Any other tool call. */
  other: number
  /** Other tool calls by short tool name ("mcp__x__find" → "find"), in first-use order. */
  otherByName: Record<string, number>
  /** Calls that ended in an error. */
  failed: number
  /** Lines added / removed by edits, from the edit inputs. */
  linesAdded: number
  linesRemoved: number
  /** The call still running, if any (the latest one). */
  running: ToolExecution | null
}

const COMMAND_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'KillBash', 'PowerShell'])
const READ_TOOLS = new Set(['Read', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch'])
const AGENT_TOOLS = new Set(['Task', 'Agent'])

/** "mcp__Claude_Browser__find" → "find"; built-in names unchanged. */
export function shortToolName(name: string): string {
  const parts = name.split('__')
  return parts[parts.length - 1] || name
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function lines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\n$/, '').split('\n')
}

/**
 * Lines added and removed going from `before` to `after`: lines present in
 * one and not matched in the other (multiset difference). Close to a real
 * diff's +/- counts for typical edits, without the cost of one.
 */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
  const counts = new Map<string, number>()
  for (const l of lines(before)) counts.set(l, (counts.get(l) ?? 0) + 1)
  let added = 0
  for (const l of lines(after)) {
    const c = counts.get(l) ?? 0
    if (c > 0) counts.set(l, c - 1)
    else added++
  }
  let removed = 0
  for (const c of counts.values()) removed += c
  return { added, removed }
}

function editDelta(call: ToolExecution): { added: number; removed: number } {
  const input = call.toolInput ?? {}
  switch (call.toolName) {
    case 'Edit':
      return lineDelta(str(input.old_string) ?? '', str(input.new_string) ?? '')
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : []
      let added = 0
      let removed = 0
      for (const e of edits) {
        const rec = (e ?? {}) as Record<string, unknown>
        const d = lineDelta(str(rec.old_string) ?? '', str(rec.new_string) ?? '')
        added += d.added
        removed += d.removed
      }
      return { added, removed }
    }
    case 'Write':
      // The file's previous content isn't in the transcript: count the new lines only.
      return { added: lines(str(input.content) ?? '').length, removed: 0 }
    default:
      return { added: 0, removed: 0 }
  }
}

function filePath(call: ToolExecution): string {
  const input = call.toolInput ?? {}
  return str(input.file_path) ?? str(input.notebook_path) ?? str(input.path) ?? call.toolUseId
}

export function isFailed(call: ToolExecution): boolean {
  return call.status === 'error' || call.result?.isError === true
}

export function isRunning(call: ToolExecution): boolean {
  return call.status === 'running' && !call.result
}

export function summarizeToolGroup(calls: ToolExecution[]): ToolGroupSummary {
  const read = new Set<string>()
  const edited = new Set<string>()
  const s: ToolGroupSummary = {
    commands: 0,
    filesRead: 0,
    filesEdited: 0,
    searches: 0,
    agents: 0,
    other: 0,
    otherByName: {},
    failed: 0,
    linesAdded: 0,
    linesRemoved: 0,
    running: null,
  }
  for (const call of calls) {
    const name = call.toolName
    if (COMMAND_TOOLS.has(name)) s.commands++
    else if (READ_TOOLS.has(name)) read.add(filePath(call))
    else if (EDIT_TOOLS.has(name)) {
      edited.add(filePath(call))
      if (!isFailed(call)) {
        const d = editDelta(call)
        s.linesAdded += d.added
        s.linesRemoved += d.removed
      }
    } else if (SEARCH_TOOLS.has(name)) s.searches++
    else if (AGENT_TOOLS.has(name)) s.agents++
    else {
      s.other++
      const short = shortToolName(name)
      s.otherByName[short] = (s.otherByName[short] ?? 0) + 1
    }
    if (isFailed(call)) s.failed++
    if (isRunning(call)) s.running = call
  }
  s.filesRead = read.size
  s.filesEdited = edited.size
  return s
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Ran 8 commands, edited 2 files, 1 failed" */
export function formatToolGroupSummary(s: ToolGroupSummary): string {
  const parts: string[] = []
  if (s.commands) parts.push(`ran ${plural(s.commands, 'command', 'commands')}`)
  if (s.filesRead) parts.push(`read ${plural(s.filesRead, 'file', 'files')}`)
  if (s.filesEdited) parts.push(`edited ${plural(s.filesEdited, 'file', 'files')}`)
  if (s.searches) parts.push(`searched ${s.searches === 1 ? 'once' : `${s.searches} times`}`)
  if (s.agents) parts.push(`started ${plural(s.agents, 'helper', 'helpers')}`)
  if (s.other) {
    const names = Object.entries(s.otherByName ?? {})
    parts.push(
      names.length > 0 && names.length <= 3
        ? `used ${names.map(([name, c]) => (c > 1 ? `${name} ×${c}` : name)).join(', ')}`
        : `used ${plural(s.other, 'other tool', 'other tools')}`,
    )
  }
  if (s.failed) parts.push(`${s.failed} failed`)
  const text = parts.join(', ')
  return text ? text[0].toUpperCase() + text.slice(1) : 'No tool calls'
}

/** One-line description of a call: "Run tests", "Read src/app.ts", "Grep foo". */
export function describeToolCall(call: ToolExecution): string {
  const input = call.toolInput ?? {}
  const desc = str(input.description)
  if (COMMAND_TOOLS.has(call.toolName)) {
    return desc ?? str(input.command) ?? call.toolName
  }
  const target =
    str(input.file_path) ??
    str(input.notebook_path) ??
    str(input.pattern) ??
    str(input.query) ??
    str(input.url) ??
    desc ??
    str(input.path)
  return target ? `${call.toolName} ${target}` : call.toolName
}

/** Prompt-like user text that isn't the task itself (reminders, tool results). */
function isNoiseUserText(text: string): boolean {
  const t = text.trim()
  return t === '' || t.startsWith('<system-reminder>') || t.startsWith('<local-command')
}

/**
 * Turn a helper's transcript blocks into the progress feed. Consecutive tool
 * calls fold into one group even across assistant messages; any text the
 * helper writes ends the group.
 */
export function buildProgressItems(blocks: ConversationBlock[]): ProgressItem[] {
  const items: ProgressItem[] = []
  let group: ToolExecution[] | null = null
  let groupId = ''

  const flush = () => {
    if (group && group.length > 0) {
      items.push({ kind: 'tools', id: groupId, calls: group, summary: summarizeToolGroup(group) })
    }
    group = null
  }

  for (const block of blocks) {
    if (block.type === 'user') {
      if (isNoiseUserText(block.text)) continue
      flush()
      items.push({
        kind: 'prompt',
        id: block.id,
        text: block.text,
        isTask: !items.some((i) => i.kind === 'prompt'),
      })
      continue
    }
    if (block.type !== 'assistant') continue
    block.segments.forEach((seg, i) => {
      if (seg.kind === 'text') {
        if (seg.text.trim() === '') return
        flush()
        items.push({ kind: 'text', id: `${block.id}:${i}`, text: seg.text })
      } else {
        if (!group) {
          group = []
          groupId = seg.execution.toolUseId || `${block.id}:${i}`
        }
        group.push(seg.execution)
      }
    })
  }
  flush()
  return items
}
