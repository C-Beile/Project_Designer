import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { Shell } from '../shell/Shell'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../test/mockApi'
import { DialogWindowApp } from './DialogWindowApp'
import { FloatApp } from './FloatApp'
import { forgetFloating, loadFloating, rememberFloating } from './floatStore'
import { EVENTS, type FloatAction, type MainState } from './protocol'
import { useFloatBridge } from './useFloatBridge'
import { openDialogWindow, setWindowBackend } from './windowService'
import { fakeBackend } from '../test/fakeWindowBackend'
import { _resetScmForTests } from '../features/git'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const STATE: MainState = {
  root: 'C:/work/proj',
  kind: 'object',
  objectId: 'C:/work/proj/entity/A/A.aod',
  objectType: 'entity',
  origin: '',
  title: 'A_entity',
  projectName: 'proj',
  projectPath: 'C:/work/proj',
  linkedRoot: 'C:/work/proj',
  readOnlyHint: '',
  selectedPath: null,
  version: 0,
  objectsByType: {},
}

beforeEach(() => {
  window.localStorage.clear()
  _resetScmForTests()
})
afterEach(() => setWindowBackend(null))

describe('floating panel arrangement is remembered per project', () => {
  it('stores geometry, restores it and forgets a docked panel', () => {
    rememberFloating('C:\\Work\\Proj', 'scm', { x: 10, y: 20, w: 400, h: 500 })
    expect(loadFloating('c:/work/proj/').scm).toEqual({ x: 10, y: 20, w: 400, h: 500 })
    expect(loadFloating('C:/other')).toEqual({})
    rememberFloating('C:/work/proj', 'navigator', null)
    expect(loadFloating('C:/work/proj').navigator).toBeNull()
    forgetFloating('C:/work/proj', 'scm')
    expect('scm' in loadFloating('C:/work/proj')).toBe(false)
    window.localStorage.setItem('forge.float.v1', '{broken')
    expect(loadFloating('C:/work/proj')).toEqual({})
  })
})

describe('dialog windows', () => {
  it('opens the window with its payload and resolves with the parsed result, null when cancelled', async () => {
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    const p = openDialogWindow<{ ok: number }>('new', 'New', { width: 500, height: 300 }, { projectRoot: 'C:/p' })
    await waitFor(() => expect(calls.opened).toHaveLength(1))
    expect(calls.opened[0]).toMatchObject({ kind: 'dialog', name: 'new', modal: true, payload: { projectRoot: 'C:/p' } })
    await backend.emit(EVENTS.windowResult, { kind: 'dialog', name: 'other', result: '{"ok":0}' })
    await backend.emit(EVENTS.windowResult, { kind: 'dialog', name: 'new', result: '{"ok":1}' })
    expect(await p).toEqual({ ok: 1 })
    const cancelled = openDialogWindow('open', 'Open', { width: 500, height: 300 }, {})
    await waitFor(() => expect(calls.opened).toHaveLength(2))
    await backend.emit(EVENTS.windowResult, { kind: 'dialog', name: 'open', result: null })
    expect(await cancelled).toBeNull()
  })

  it('the Open dialog window renders inside the window and sends the picked model back', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    await backend.open({ kind: 'dialog', name: 'open', title: 'Open', width: 1, height: 1, payload: { models: [{ type: 'entity', name: 'Activity_entity' }, { type: 'neonView', name: 'ActivityMain_view' }] } })
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<DialogWindowApp name="open" api={api} />)
    await user.dblClick(await screen.findByText('Activity_entity'))
    await waitFor(() => expect(calls.results).toHaveLength(1))
    expect(calls.results[0]).toMatchObject({ kind: 'dialog', name: 'open' })
    expect(JSON.parse(calls.results[0].result!)).toEqual({ type: 'entity', name: 'Activity_entity' })
    expect(document.querySelector('.forge-modal-backdrop')).toBeNull()
  })

  it('Escape in a dialog window reports a cancel', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    await backend.open({ kind: 'dialog', name: 'new', title: 'New', width: 1, height: 1, payload: { projectRoot: 'C:/p', folder: null } })
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<DialogWindowApp name="new" api={api} />)
    await screen.findByRole('textbox', { name: 'Object name' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(calls.results).toEqual([{ kind: 'dialog', name: 'new', result: null }]))
  })
})

describe('Options window', () => {
  it('saves in its own window and reports the three values the main window keeps', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    await backend.open({ kind: 'dialog', name: 'options', title: 'Options', width: 1, height: 1, payload: { engine: 'official', theme: 'dark', keymap: [] } })
    const api = createMockForgeApi({ projectTree: [], documents: {}, settings: { designer_install_dir: 'D:/designer', ssh_key_path: null } })
    const set = vi.spyOn(api, 'setSettings')
    render(<DialogWindowApp name="options" api={api} />)
    await user.click(await screen.findByRole('button', { name: 'OK' }))
    await waitFor(() => expect(calls.results).toHaveLength(1))
    expect(JSON.parse(calls.results[0].result!)).toEqual({ installDir: 'D:/designer', engine: 'official', theme: 'dark' })
    expect(set).toHaveBeenCalled()
  })

  it('closing it without saving reports a cancel', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    await backend.open({ kind: 'dialog', name: 'options', title: 'Options', width: 1, height: 1, payload: { engine: 'official', theme: 'dark', keymap: [] } })
    render(<DialogWindowApp name="options" api={createMockForgeApi({ projectTree: [], documents: {} })} />)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(calls.results).toEqual([{ kind: 'dialog', name: 'options', result: null }]))
  })
})

describe('main window side of floating panels', () => {
  it('floats a view, answers the ready message with the state, forwards actions and docks on close', async () => {
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    const received: FloatAction[] = []
    const stateSeen: MainState[] = []
    await backend.listen(EVENTS.mainState, (p) => stateSeen.push(p as MainState))
    const { result } = renderHook(() => useFloatBridge({ root: 'C:/work/proj', state: STATE, onAction: (a) => received.push(a), onError: () => {} }))
    await act(async () => {
      await result.current.floatView('navigator', { x: 5, y: 6, w: 333, h: 444 })
    })
    expect(result.current.floating).toEqual(['navigator'])
    expect(calls.opened[0]).toMatchObject({ kind: 'float', name: 'navigator', x: 5, y: 6, width: 333, height: 444 })
    expect(loadFloating('C:/work/proj').navigator).toEqual({ x: 5, y: 6, w: 333, h: 444 })

    await act(async () => {
      await backend.emit(EVENTS.floatReady, { view: 'navigator' })
    })
    expect(stateSeen.at(-1)).toEqual(STATE)

    await act(async () => {
      await backend.emit(EVENTS.floatAction, { type: 'navSelect', nodeId: 'x', path: 'p', label: 'l' })
    })
    expect(received).toEqual([{ type: 'navSelect', nodeId: 'x', path: 'p', label: 'l' }])

    await act(async () => {
      await backend.emit(EVENTS.windowResult, { kind: 'float', name: 'navigator', result: null })
    })
    expect(result.current.floating).toEqual([])
    expect('navigator' in loadFloating('C:/work/proj')).toBe(false)
  })

  it('the Dock button path closes the window and forgets it; a failing open falls back to docked', async () => {
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    const errors: string[] = []
    const { result } = renderHook(() => useFloatBridge({ root: 'C:/work/proj', state: STATE, onAction: () => {}, onError: (m) => errors.push(m) }))
    await act(async () => {
      await result.current.floatView('scm')
    })
    await act(async () => {
      await result.current.dockView('scm')
    })
    expect(calls.closed).toEqual(['float-scm'])
    expect(result.current.floating).toEqual([])
    backend.open = async () => {
      throw new Error('no window')
    }
    await act(async () => {
      await result.current.floatView('services')
    })
    expect(result.current.floating).toEqual([])
    expect(errors).toEqual(['no window'])
  })

  it('a project comes back with the panels that floated before', async () => {
    rememberFloating('C:/work/proj', 'properties', { x: 1, y: 2, w: 300, h: 400 })
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    renderHook(() => useFloatBridge({ root: 'C:/work/proj', state: STATE, onAction: () => {}, onError: () => {} }))
    await waitFor(() => expect(calls.opened).toHaveLength(1))
    expect(calls.opened[0]).toMatchObject({ kind: 'float', name: 'properties', x: 1, y: 2 })
  })
})

describe('floating panel window', () => {
  it('shows Source Control for the root it is given and reports ready; Dock sends the window result', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    const ready = vi.fn()
    await backend.listen(EVENTS.floatReady, ready)
    const api = createMockForgeApi({
      projectTree: [],
      documents: {},
      scm: { root: 'C:/work/proj', branch: 'main', upstream: null, ahead: 0, behind: 0, truncated: false, branches: [{ name: 'main', is_current: true }], remote_branches: [], files: [{ path: 'a.txt', index: ' ', worktree: 'M', from: null }] },
    })
    render(<FloatApp view="scm" api={api} />)
    await waitFor(() => expect(ready).toHaveBeenCalled())
    await act(async () => {
      await backend.emit(EVENTS.mainState, STATE)
    })
    expect(await screen.findByRole('list', { name: 'Changes' })).toHaveTextContent('a.txt')
    await user.click(screen.getByRole('button', { name: 'Dock' }))
    expect(calls.results).toEqual([{ kind: 'float', name: 'scm', result: null }])
  })

  it('the floating Navigator draws the main window selection and sends element picks back', async () => {
    const user = userEvent.setup()
    const { backend } = fakeBackend()
    setWindowBackend(backend)
    const actions: FloatAction[] = []
    await backend.listen(EVENTS.floatAction, (p) => actions.push(p as FloatAction))
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    api.getNavigator = async () => [{ label: 'A_entity', path: '$', icon: 'object', children: [{ label: 'Fields', icon: 'folder', children: [{ label: 'FIELD_1', path: 'f[0]', icon: 'field', children: [] }] }] }]
    render(<FloatApp view="navigator" api={api} />)
    await act(async () => {
      await backend.emit(EVENTS.mainState, STATE)
    })
    await user.click(await screen.findByText('FIELD_1'))
    expect(actions).toContainEqual({ type: 'navSelect', nodeId: STATE.objectId, path: 'f[0]', label: 'FIELD_1' })
    expect(screen.getByText('A_entity - Navigator')).toBeInTheDocument()
  })
})

describe('Designer window with operating-system windows', () => {
  async function openMenuItem(user: ReturnType<typeof userEvent.setup>, menu: string, entry: RegExp) {
    await user.click(screen.getByRole('menuitem', { name: menu }))
    const list = screen.getByRole('menu', { name: menu })
    if (menu === 'Window' && /(Float|Dock) (Navigator|Properties|Services|Source)/.test(String(entry))) await user.hover(within(list).getByRole('menuitem', { name: 'Configure Window' }))
    await user.click(screen.getByRole('menuitem', { name: entry }))
  }

  it('Float Navigator opens a window and takes the panel out of the dock; Dock brings it back', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    render(<Shell api={createMockForgeApi({ projectTree: [], documents: {} })} projectRoot="" />)
    expect(screen.getByRole('region', { name: 'Navigator' })).toBeInTheDocument()
    await openMenuItem(user, 'Window', /^Float Navigator/)
    await waitFor(() => expect(calls.opened).toHaveLength(1))
    expect(calls.opened[0]).toMatchObject({ kind: 'float', name: 'navigator' })
    expect(screen.queryByRole('region', { name: 'Navigator' })).toBeNull()
    await openMenuItem(user, 'Window', /^Dock Navigator/)
    await waitFor(() => expect(calls.closed).toEqual(['float-navigator']))
    expect(screen.getByRole('region', { name: 'Navigator' })).toBeInTheDocument()
  })

  it('closing the floating window by its own close button docks the panel again', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    render(<Shell api={createMockForgeApi({ projectTree: [], documents: {} })} projectRoot="" />)
    await user.click(screen.getByRole('button', { name: 'Open Properties in a new window' }))
    await waitFor(() => expect(calls.opened).toHaveLength(1))
    expect(screen.queryByRole('region', { name: 'Properties' })).toBeNull()
    await act(async () => {
      await backend.emit(EVENTS.windowResult, { kind: 'float', name: 'properties', result: null })
    })
    expect(screen.getByRole('region', { name: 'Properties' })).toBeInTheDocument()
  })

  it('New opens its own modal window instead of an embedded dialog and takes over the result', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    const api = createMockForgeApi({
      projectTree: [{ id: 'C:/p', label: 'p', object_type: null, is_leaf: false, kind: 'project', children: [{ id: 'folder:entity', label: 'entity', object_type: null, is_leaf: false, folder: 'entity', children: [] }] }],
      documents: {},
    })
    render(<Shell api={api} projectRoot="C:/p" />)
    const folder = await screen.findByRole('treeitem', { name: 'entity' })
    await user.pointer({ keys: '[MouseRight]', target: folder })
    await user.click(within(screen.getByRole('menu', { name: 'Context menu' })).getByRole('menuitem', { name: 'New' }))
    await waitFor(() => expect(calls.opened.some((o) => o.name === 'new')).toBe(true))
    expect(calls.opened.find((o) => o.name === 'new')).toMatchObject({ kind: 'dialog', modal: true, payload: { projectRoot: 'C:/p', folder: 'entity' } })
    expect(screen.queryByRole('dialog', { name: 'New' })).toBeNull()
    await act(async () => {
      await backend.emit(EVENTS.windowResult, { kind: 'dialog', name: 'new', result: JSON.stringify({ aod: 'C:/p/entity/Car/Car.aod', folder: 'entity', name: 'Car' }) })
    })
    expect(await screen.findByText('Created entity/Car.')).toBeInTheDocument()
  })

  it('Tools > Options opens the Options window with the current engine, theme and keymap', async () => {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    render(<Shell api={createMockForgeApi({ projectTree: [], documents: {} })} projectRoot="" />)
    await openMenuItem(user, 'Tools', /^Options/)
    await waitFor(() => expect(calls.opened.some((o) => o.name === 'options')).toBe(true))
    const req = calls.opened.find((o) => o.name === 'options')!
    expect(req).toMatchObject({ kind: 'dialog', modal: true })
    expect((req.payload as { engine: string; theme: string; keymap: unknown[] }).engine).toBe('experimental')
    expect(Array.isArray((req.payload as { keymap: unknown[] }).keymap)).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull()
    await act(async () => {
      await backend.emit(EVENTS.windowResult, { kind: 'dialog', name: 'options', result: null })
    })
  })
})

describe('floating Output window', () => {
  it('shows the log lines the main window sends and can be docked again', async () => {
    const { backend } = fakeBackend()
    setWindowBackend(backend)
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<FloatApp view="output" api={api} />)
    await act(async () => {
      await backend.emit(EVENTS.outputLines, { database: [], build: [{ level: 'info', text: 'Applied modification X' }], default: [], nodejs: [] })
    })
    expect(await screen.findByText('Applied modification X')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dock' })).toBeInTheDocument()
  })
})
