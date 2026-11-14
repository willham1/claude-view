import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubAgentBlockView } from './SubAgentBlockView'

const blocks = [
  { type: 'user', id: 'u1', text: 'Fix the bug', timestamp: 1 },
  {
    type: 'assistant',
    id: 'm1',
    streaming: false,
    segments: [
      { kind: 'text', text: 'Looking into it.' },
      {
        kind: 'tool',
        execution: {
          toolName: 'Bash',
          toolInput: { command: 'ls', description: 'List files' },
          toolUseId: 't1',
          status: 'complete',
          result: { output: 'a.ts', isError: false, isReplay: false },
        },
      },
      {
        kind: 'tool',
        execution: {
          toolName: 'Bash',
          toolInput: { command: 'cargo test', description: 'Run tests' },
          toolUseId: 't2',
          status: 'running',
        },
      },
    ],
  },
]

function mockFetch() {
  const fn = vi.fn(async () => new Response(JSON.stringify({ blocks, total: blocks.length })))
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SubAgentBlockView Progress tab', () => {
  it('opens on Progress, with tool calls folded into a summary and the running call shown', async () => {
    mockFetch()
    render(
      <SubAgentBlockView
        sessionId="s1"
        agentId="abc"
        agentType="builder"
        description="Fix bug"
        isRunning
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('tab', { name: /Progress/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Looking into it.')).toBeInTheDocument()
    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('Ran 2 commands')).toBeInTheDocument()
    expect(screen.getByTestId('progress-running').textContent).toContain('Running Run tests')
    // Calls are hidden until the summary is expanded.
    expect(screen.queryByText('List files')).toBeNull()
    await userEvent.setup().click(screen.getByText('Ran 2 commands'))
    expect(screen.getByText('List files')).toBeInTheDocument()
  })

  it('does not show a running call for a finished helper, and does not poll', async () => {
    const fn = mockFetch()
    render(
      <SubAgentBlockView
        sessionId="s1"
        agentId="abc"
        agentType="b"
        description="d"
        onClose={() => {}}
      />,
    )
    await screen.findByText('Looking into it.')
    expect(screen.queryByTestId('progress-running')).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('re-reads the transcript while the helper runs', async () => {
    const fn = mockFetch()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <SubAgentBlockView
        sessionId="s1"
        agentId="abc"
        agentType="b"
        description="d"
        isRunning
        onClose={() => {}}
      />,
    )
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
  })
})
