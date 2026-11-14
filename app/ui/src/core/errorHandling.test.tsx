import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CrashListener, ErrorBoundary } from './errorHandling'
import { createMockForgeApi } from '../test/mockApi'

function Bomb(): never {
  throw new Error('render exploded')
}

const clipboardText = () => navigator.clipboard.readText()

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
    expect(await clipboardText()).toContain('render exploded')
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

})

describe('details of an unexpected error', () => {
  it('an event as the error reason is described and Copy details carries stack, place and time', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const logged = vi.spyOn(api, 'logClientError')
    render(<CrashListener api={api} />)
    await act(async () => {
      const ev = new Event('unhandledrejection') as Event & { reason: unknown }
      ev.reason = new Event('error')
      window.dispatchEvent(ev)
    })
    const dialog = screen.getByRole('dialog', { name: 'Unexpected error' })
    expect(dialog).not.toHaveTextContent('[object Event]')
    expect(dialog).toHaveTextContent('Event "error"')
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('Event "error"'))
    await user.click(screen.getByRole('button', { name: 'Copy details' }))
    const copied = await clipboardText()
    expect(copied).toContain('Event "error"')
    expect(copied).toMatch(/Time: \d{4}-\d{2}-\d{2}T/)
    expect(copied).toContain('Window:')
  })

  it('a thrown error keeps its stack in Copy details', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<CrashListener api={api} />)
    await act(async () => {
      const ev = new Event('unhandledrejection') as Event & { reason: unknown }
      ev.reason = new TypeError('boom here')
      window.dispatchEvent(ev)
    })
    await user.click(screen.getByRole('button', { name: 'Copy details' }))
    const copied = await clipboardText()
    expect(copied).toContain('TypeError: boom here')
    expect(copied).toContain('at ')
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
