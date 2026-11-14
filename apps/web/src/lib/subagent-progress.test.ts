import type { ConversationBlock, ToolExecution } from '@claude-view/shared/types/blocks'
import { describe, expect, it } from 'vitest'
import {
  buildProgressItems,
  describeToolCall,
  formatToolGroupSummary,
  lineDelta,
  summarizeToolGroup,
} from './subagent-progress'

let n = 0
function call(
  toolName: string,
  toolInput: Record<string, unknown>,
  opts: { status?: ToolExecution['status']; error?: boolean; noResult?: boolean } = {},
): ToolExecution {
  n++
  const status = opts.status ?? (opts.error ? 'error' : 'complete')
  return {
    toolName,
    toolInput,
    toolUseId: `toolu_${n}`,
    status,
    result: opts.noResult
      ? undefined
      : { output: opts.error ? 'boom' : 'ok', isError: !!opts.error, isReplay: false },
  }
}

function assistant(id: string, ...segs: (string | ToolExecution)[]): ConversationBlock {
  return {
    type: 'assistant',
    id,
    streaming: false,
    segments: segs.map((s) =>
      typeof s === 'string'
        ? { kind: 'text' as const, text: s }
        : { kind: 'tool' as const, execution: s },
    ),
  }
}

function user(id: string, text: string): ConversationBlock {
  return { type: 'user', id, text, timestamp: 0 }
}

describe('lineDelta', () => {
  it('counts lines added and removed', () => {
    expect(lineDelta('a\nb\nc', 'a\nB\nc\nd')).toEqual({ added: 2, removed: 1 })
    expect(lineDelta('', 'x\ny\n')).toEqual({ added: 2, removed: 0 })
    expect(lineDelta('same', 'same')).toEqual({ added: 0, removed: 0 })
  })
})

describe('summarizeToolGroup', () => {
  it('counts commands, distinct files, failures and edit lines', () => {
    const s = summarizeToolGroup([
      call('Bash', { command: 'ls' }),
      call('Bash', { command: 'false' }, { error: true }),
      call('Read', { file_path: '/a.ts' }),
      call('Read', { file_path: '/a.ts' }),
      call('Read', { file_path: '/b.ts' }),
      call('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y\nz' }),
      call('Write', { file_path: '/c.ts', content: '1\n2\n3\n' }),
      call('MultiEdit', {
        file_path: '/a.ts',
        edits: [{ old_string: 'p\nq', new_string: 'p' }],
      }),
      call('Grep', { pattern: 'foo' }),
      call('Agent', { description: 'sub' }),
      call('SubagentHandback', { message: 'done' }),
    ])
    expect(s).toMatchObject({
      commands: 2,
      filesRead: 2,
      filesEdited: 2,
      searches: 1,
      agents: 1,
      other: 1,
      failed: 1,
      linesAdded: 2 + 3,
      linesRemoved: 1 + 1,
      running: null,
    })
    expect(formatToolGroupSummary(s)).toBe(
      'Ran 2 commands, read 2 files, edited 2 files, searched once, started 1 helper, used SubagentHandback, 1 failed',
    )
  })

  it('names up to three other tools by short name, else counts them', () => {
    const few = summarizeToolGroup([
      call('mcp__Claude_Browser__find', {}),
      call('mcp__Claude_Browser__find', {}),
      call('mcp__Claude_Browser__computer', {}),
    ])
    expect(formatToolGroupSummary(few)).toBe('Used find ×2, computer')
    const many = summarizeToolGroup(['a', 'b', 'c', 'd'].map((t) => call(`mcp__x__${t}`, {})))
    expect(formatToolGroupSummary(many)).toBe('Used 4 other tools')
  })

  it('does not count lines of a failed edit', () => {
    const s = summarizeToolGroup([
      call('Edit', { file_path: '/a', old_string: 'a', new_string: 'b' }, { error: true }),
    ])
    expect(s.linesAdded).toBe(0)
    expect(s.failed).toBe(1)
    expect(formatToolGroupSummary(s)).toBe('Edited 1 file, 1 failed')
  })

  it('reports the call still running', () => {
    const running = call(
      'Bash',
      { command: 'cargo test', description: 'Run tests' },
      { status: 'running', noResult: true },
    )
    const s = summarizeToolGroup([call('Bash', { command: 'ls' }), running])
    expect(s.running).toBe(running)
    expect(describeToolCall(running)).toBe('Run tests')
    expect(formatToolGroupSummary(s)).toBe('Ran 2 commands')
  })

  it('uses singular words for one of each', () => {
    expect(formatToolGroupSummary(summarizeToolGroup([call('Bash', { command: 'ls' })]))).toBe(
      'Ran 1 command',
    )
  })
})

describe('describeToolCall', () => {
  it('names the target of non-command tools', () => {
    expect(describeToolCall(call('Read', { file_path: '/x/y.ts' }))).toBe('Read /x/y.ts')
    expect(describeToolCall(call('Grep', { pattern: 'TODO' }))).toBe('Grep TODO')
    expect(describeToolCall(call('Bash', { command: 'ls -la' }))).toBe('ls -la')
    expect(describeToolCall(call('Mystery', {}))).toBe('Mystery')
  })
})

describe('buildProgressItems', () => {
  it('folds consecutive tool calls across messages into one group, split by text', () => {
    const items = buildProgressItems([
      user('u1', 'Do the thing'),
      user('u2', '<system-reminder>ignore me</system-reminder>'),
      { type: 'system', id: 's1', variant: 'attachment', data: {} },
      assistant('m1', call('Bash', { command: 'a' }), call('Bash', { command: 'b' })),
      assistant('m2', call('Read', { file_path: '/f' })),
      assistant(
        'm3',
        'Found it.',
        call('Edit', { file_path: '/f', old_string: '1', new_string: '2' }),
      ),
      assistant('m4', 'All done.', '   '),
    ])
    expect(items.map((i) => i.kind)).toEqual(['prompt', 'tools', 'text', 'tools', 'text'])
    const first = items[1]
    if (first.kind !== 'tools') throw new Error('expected tools')
    expect(first.calls).toHaveLength(3)
    expect(formatToolGroupSummary(first.summary)).toBe('Ran 2 commands, read 1 file')
    const second = items[3]
    if (second.kind !== 'tools') throw new Error('expected tools')
    expect(second.summary).toMatchObject({ filesEdited: 1, linesAdded: 1, linesRemoved: 1 })
    expect(items[4]).toMatchObject({ kind: 'text', text: 'All done.' })
    expect(items[0]).toMatchObject({ kind: 'prompt', isTask: true })
  })

  it('labels later messages to the helper as messages, not its task', () => {
    const items = buildProgressItems([
      user('u1', 'Build it'),
      assistant('m1', 'Done.'),
      user('u2', 'Next line for PR #9'),
    ])
    expect(
      items.filter((i) => i.kind === 'prompt').map((i) => i.kind === 'prompt' && i.isTask),
    ).toEqual([true, false])
  })

  it('gives every item a unique id', () => {
    const items = buildProgressItems([
      assistant('m1', 'one', call('Bash', { command: 'a' }), 'two', call('Bash', { command: 'b' })),
    ])
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it('returns nothing for an empty transcript', () => {
    expect(buildProgressItems([])).toEqual([])
  })
})
