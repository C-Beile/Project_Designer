import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CrashListener, ErrorBoundary } from './errorHandling'
import { createMockForgeApi } from '../test/mockApi'

function Bomb(): never {
  throw new Error('render exploded')
}

describe('error handling instead of a silent crash', () => {
  it('shows an error panel with the log folder button and writes the error to the log', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const logged = vi.spyOn(api, 'logClientError')
    const opened = vi.spyOn(api, 'openLogFolder')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary api={api} label="Editor of Foo">
        <Bomb />
      </ErrorBoundary>,
    )
    quiet.mockRestore()
    expect(screen.getByRole('alert')).toHaveTextContent('Editor of Foo failed')
    expect(screen.getByRole('alert')).toHaveTextContent('render exploded')
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('render exploded'))
    await userEvent.click(screen.getByRole('button', { name: 'Open Log Folder' }))
    expect(opened).toHaveBeenCalled()
  })

  it('Copy details puts the whole error message on the clipboard', async () => {
    const user = userEvent.setup()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary label="Editor of Foo">
        <Bomb />
      </ErrorBoundary>,
    )
    quiet.mockRestore()
    await user.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toContain('render exploded')
  })

  it('an unhandled promise rejection opens the error dialog and is logged', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const logged = vi.spyOn(api, 'logClientError')
    render(<CrashListener api={api} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      const ev = new Event('unhandledrejection') as Event & { reason: unknown }
      ev.reason = new Error('background task failed')
      window.dispatchEvent(ev)
    })
    expect(screen.getByRole('dialog', { name: 'Unexpected error' })).toHaveTextContent('background task failed')
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('background task failed'))
  })

  it('the harmless ResizeObserver notice neither opens a dialog nor reaches the log', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const logged = vi.spyOn(api, 'logClientError')
    render(<CrashListener api={api} />)
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(logged).not.toHaveBeenCalled()
  })
})
