import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROGRESS_POLL_MS } from '../../hooks/use-subagent-progress'
import { useMonitorStore } from '../../store/monitor-store'
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

  it('does not show a running call for a finished helper', async () => {
    mockFetch()
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
  })

  it('does not re-read a finished helper, even well past the poll interval', async () => {
    const fn = mockFetch()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <SubAgentBlockView
        sessionId="s1"
        agentId="abc"
        agentType="b"
        description="d"
        onClose={() => {}}
      />,
    )
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS * 3 + 100)
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('clears an error on the next good response even when the transcript is unchanged', async () => {
    const empty = JSON.stringify({ blocks: [], total: 0 })
    let call = 0
    globalThis.fetch = vi.fn(async () => {
      call++
      // good (empty), then a failure, then the same good body again
      if (call === 2) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
      return new Response(empty)
    }) as unknown as typeof fetch
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
    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS + 100)
    })
    expect(await screen.findByText('boom')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS + 100)
    })
    await waitFor(() => expect(screen.queryByText('boom')).toBeNull())
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })

  it('Chat and Developer set the app-wide display mode and show the transcript', async () => {
    mockFetch()
    useMonitorStore.getState().setDisplayMode('chat')
    const user = userEvent.setup()
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
    await user.click(screen.getByRole('tab', { name: /Developer/ }))
    expect(useMonitorStore.getState().displayMode).toBe('developer')
    expect(screen.getByRole('tab', { name: /Developer/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('subagent-progress')).toBeNull()
    await user.click(screen.getByRole('tab', { name: /Chat/ }))
    expect(useMonitorStore.getState().displayMode).toBe('chat')
    // Back to Progress leaves the app-wide mode alone.
    await user.click(screen.getByRole('tab', { name: /Progress/ }))
    expect(useMonitorStore.getState().displayMode).toBe('chat')
    expect(await screen.findByTestId('subagent-progress')).toBeInTheDocument()
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
      await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS + 100)
    })
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
  })
})
