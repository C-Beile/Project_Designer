import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shell } from '../shell/Shell'
import { createMockForgeApi } from '../test/mockApi'
import { fakeBackend } from '../test/fakeWindowBackend'
import { _resetDialogsForTests } from '../core/dialogService'
import { DialogWindowApp } from './DialogWindowApp'
import { EVENTS } from './protocol'
import { setWindowBackend } from './windowService'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

beforeEach(() => {
  window.localStorage.clear()
  _resetDialogsForTests()
})
afterEach(() => setWindowBackend(null))

async function openMenuItem(user: ReturnType<typeof userEvent.setup>, menu: string, entry: RegExp) {
  await user.click(screen.getByRole('menuitem', { name: menu }))
  await user.click(screen.getByRole('menuitem', { name: entry }))
}

describe('menu dialogs open as windows of their own', () => {
  const cases: [string, RegExp, string, string][] = [
    ['Help', /^About Dito Designer/, 'about', 'About Dito Designer'],
    ['Help', /^Check for Updates/, 'updates', 'Check for Updates'],
    ['Tools', /^Local Data/, 'localdata', 'Local Data'],
    ['Tools', /^Plugins/, 'plugins', 'Plugins'],
  ]
  for (const [menu, entry, name, title] of cases) {
    it(`${title} is a modal window and no dialog is drawn inside the main window`, async () => {
      const user = userEvent.setup()
      const { backend, calls } = fakeBackend()
      setWindowBackend(backend)
      render(<Shell api={createMockForgeApi({ projectTree: [], documents: {} })} projectRoot="" />)
      await openMenuItem(user, menu, entry)
      await waitFor(() => expect(calls.opened.some((o) => o.name === name)).toBe(true))
      expect(calls.opened.find((o) => o.name === name)).toMatchObject({ kind: 'dialog', title, modal: true })
      expect(screen.queryByRole('dialog', { name: title })).toBeNull()
      await act(async () => {
        await backend.emit(EVENTS.windowResult, { kind: 'dialog', name, result: null })
      })
    })
  }

  it('Check for Updates hands over to the System Table Control Center when asked to', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    render(<Shell api={createMockForgeApi({ projectTree: [], documents: {} })} projectRoot="" />)
    await openMenuItem(user, 'Help', /^Check for Updates/)
    await waitFor(() => expect(calls.opened.some((o) => o.name === 'updates')).toBe(true))
    await act(async () => {
      await backend.emit(EVENTS.windowResult, { kind: 'dialog', name: 'updates', result: JSON.stringify({ tableCenter: true }) })
    })
    expect(await screen.findByRole('dialog', { name: 'System Table Control Center' })).toBeInTheDocument()
  })

  it('without operating-system windows the embedded dialog is used as before', async () => {
    const user = userEvent.setup()
    render(<Shell api={createMockForgeApi({ projectTree: [], documents: {} })} projectRoot="" />)
    await openMenuItem(user, 'Help', /^About Dito Designer/)
    expect(await screen.findByRole('dialog', { name: 'About Dito Designer' })).toBeInTheDocument()
  })
})

describe('dialog windows draw their content and send the result back', () => {
  async function open(name: string, payload: unknown) {
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    await backend.open({ kind: 'dialog', name, title: name, width: 1, height: 1, payload })
    return { backend, calls }
  }

  it('Rename sends the new name', async () => {
    const user = userEvent.setup()
    const { calls } = await open('rename', { folder: 'entity', initial: 'Person' })
    render(<DialogWindowApp name="rename" api={createMockForgeApi({ projectTree: [], documents: {} })} />)
    const input = await screen.findByRole('textbox', { name: 'New name' })
    await user.clear(input)
    await user.type(input, 'Human')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(calls.results).toHaveLength(1))
    expect(calls.results[0]).toEqual({ kind: 'dialog', name: 'rename', result: JSON.stringify({ name: 'Human' }) })
  })

  it('About and Local Data close with a cancel result', async () => {
    const user = userEvent.setup()
    const { calls } = await open('about', {})
    render(<DialogWindowApp name="about" api={createMockForgeApi({ projectTree: [], documents: {} })} />)
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(calls.results).toEqual([{ kind: 'dialog', name: 'about', result: null }]))
  })

  it('Updates reports the wish to open the table center', async () => {
    const user = userEvent.setup()
    const { calls } = await open('updates', {})
    render(<DialogWindowApp name="updates" api={createMockForgeApi({ projectTree: [], documents: {} })} />)
    await user.click(await screen.findByRole('button', { name: 'Organize System Tables…' }))
    await waitFor(() => expect(calls.results).toHaveLength(1))
    expect(JSON.parse(calls.results[0].result!)).toEqual({ tableCenter: true })
  })

  it('Plugins and the Deploy plan have a window of their own', async () => {
    const { calls } = await open('plugins', {})
    render(<DialogWindowApp name="plugins" api={createMockForgeApi({ projectTree: [], documents: {} })} />)
    expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(calls.results).toEqual([])
  })
})
