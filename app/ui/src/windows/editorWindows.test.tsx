import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Shell } from '../shell/Shell'
import { createMockForgeApi } from '../test/mockApi'
import { fakeBackend } from '../test/fakeWindowBackend'
import { _resetDialogsForTests } from '../shell/dialogService'
import type { TreeNode } from '../wire/types'
import { EditorWindowApp } from './EditorWindowApp'
import { canMoveToWindow, editorWindowName, forgetEditorWindow, loadEditorWindows, rememberEditorWindow } from './editorWindows'
import { EVENTS, type EditorCommand, type FloatAction } from './protocol'
import { setWindowBackend } from './windowService'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const entityNode: TreeNode = { id: 'C:/p/entity/Person/Person.aod', label: 'Person', object_type: 'entity', is_leaf: true, children: [], kind: 'object' }
const tree: TreeNode[] = [
  {
    id: 'project:C:/p',
    label: 'p',
    object_type: null,
    is_leaf: false,
    kind: 'project',
    children: [{ id: 'folder:C:/p|entity', label: 'entity', object_type: null, is_leaf: false, kind: 'folder', folder: 'entity', children: [entityNode] }],
  },
]

beforeEach(() => {
  window.localStorage.clear()
  _resetDialogsForTests()
})
afterEach(() => setWindowBackend(null))

describe('editor window names and the remembered arrangement', () => {
  it('gives the same document the same plain window name, and different documents different ones', () => {
    const a = editorWindowName('C:/p/entity/Person/Person.aod')
    expect(a).toMatch(/^ed-[0-9a-f]{8}$/)
    expect(editorWindowName('c:\\p\\entity\\Person\\Person.aod')).toBe(a)
    expect(editorWindowName('C:/p/entity/Car/Car.aod')).not.toBe(a)
  })

  it('lets objects and files move, but not the virtual tabs of the Services area', () => {
    expect(canMoveToWindow(entityNode)).toBe(true)
    expect(canMoveToWindow({ id: 'C:/p/package.json', label: 'package.json', object_type: null, is_leaf: true, children: [], kind: 'file' })).toBe(true)
    expect(canMoveToWindow({ id: 'sql:1', label: 'SQL 1', object_type: null, is_leaf: true, children: [], kind: 'service' })).toBe(false)
    expect(canMoveToWindow({ id: 'tunnel:x', label: 't', object_type: null, is_leaf: true, children: [], kind: 'tunnel' })).toBe(false)
    expect(canMoveToWindow({ id: 'missing:x', label: 'x', object_type: 'entity', is_leaf: true, children: [] })).toBe(false)
  })

  it('remembers editor windows per project and forgets a docked one', () => {
    rememberEditorWindow('C:\\P', { node: entityNode, sub: 'source', geometry: { x: 5, y: 6, w: 700, h: 500 } })
    expect(loadEditorWindows('c:/p/')).toEqual([{ node: entityNode, sub: 'source', geometry: { x: 5, y: 6, w: 700, h: 500 } }])
    rememberEditorWindow('C:/p', { node: entityNode, sub: 'editor', geometry: null })
    expect(loadEditorWindows('C:/p')[0].geometry).toEqual({ x: 5, y: 6, w: 700, h: 500 })
    expect(loadEditorWindows('C:/other')).toEqual([])
    forgetEditorWindow('C:/p', entityNode.id)
    expect(loadEditorWindows('C:/p')).toEqual([])
    window.localStorage.setItem('forge.editorWindows.v1', '{broken')
    expect(loadEditorWindows('C:/p')).toEqual([])
  })
})

describe('Designer window and moved editors', () => {
  async function setup() {
    const user = userEvent.setup()
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    const api = createMockForgeApi({ projectTree: tree, documents: { [entityNode.id]: { kind: 'object', fields: [] } } })
    render(<Shell api={api} projectRoot="C:/p" />)
    const folder = await screen.findByRole('treeitem', { name: 'entity' })
    await user.click(folder)
    await user.keyboard('{ArrowRight}')
    const row = await screen.findByRole('treeitem', { name: /Person/ })
    await user.dblClick(row)
    await screen.findByRole('tab', { name: 'Person' })
    return { user, api, backend, calls, row }
  }

  async function moveViaMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('tab', { name: 'Person' }) })
    await user.click(within(screen.getByRole('menu', { name: 'Context menu' })).getByRole('menuitem', { name: 'Move to New Window' }))
  }

  it('Move to New Window opens an editor window with the document and takes the tab out of this window', async () => {
    const { user, calls } = await setup()
    await moveViaMenu(user)
    await waitFor(() => expect(calls.opened.some((o) => o.kind === 'editor')).toBe(true))
    const req = calls.opened.find((o) => o.kind === 'editor')!
    expect(req).toMatchObject({ kind: 'editor', name: editorWindowName(entityNode.id), modal: false })
    expect(req.title).toBe('Person - p')
    expect((req.payload as { node: TreeNode; project: string; dirty: boolean }).node.id).toBe(entityNode.id)
    expect((req.payload as { project: string }).project).toBe('C:/p')
    expect(screen.queryByRole('tab', { name: 'Person' })).toBeNull()
    expect(loadEditorWindows('C:/p')).toHaveLength(1)
  })

  it('a document is open in one window only: opening it again brings its window forward', async () => {
    const { user, calls, row } = await setup()
    await moveViaMenu(user)
    await waitFor(() => expect(calls.opened.some((o) => o.kind === 'editor')).toBe(true))
    const before = calls.opened.length
    await user.dblClick(row)
    await waitFor(() => expect(calls.opened.length).toBeGreaterThan(before))
    expect(calls.opened[calls.opened.length - 1]).toMatchObject({ kind: 'editor', name: editorWindowName(entityNode.id) })
    expect(screen.queryByRole('tab', { name: 'Person' })).toBeNull()
  })

  it('docking brings the tab back with the sub tab of the window; closing the window just forgets it', async () => {
    const { user, backend } = await setup()
    await moveViaMenu(user)
    const name = editorWindowName(entityNode.id)
    await act(async () => {
      await backend.emit(EVENTS.windowResult, { kind: 'editor', name, result: JSON.stringify({ dock: true, sub: 'source' }) })
    })
    const tab = await screen.findByRole('tab', { name: 'Person' })
    expect(tab).toBeInTheDocument()
    expect(loadEditorWindows('C:/p')).toEqual([])
    await moveViaMenu(user)
    await act(async () => {
      await backend.emit(EVENTS.windowResult, { kind: 'editor', name, result: null })
    })
    expect(screen.queryByRole('tab', { name: 'Person' })).toBeNull()
    expect(loadEditorWindows('C:/p')).toEqual([])
  })

  it('Window > Dock All Editor Windows asks the windows to dock', async () => {
    const { user, backend } = await setup()
    const commands: EditorCommand[] = []
    await backend.listen(EVENTS.editorCommand, (p) => commands.push(p as EditorCommand))
    await moveViaMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Window' }))
    await user.hover(within(screen.getByRole('menu', { name: 'Window' })).getByRole('menuitem', { name: 'Configure Window' }))
    await user.click(screen.getByRole('menuitem', { name: 'Dock All Editor Windows' }))
    expect(commands).toEqual([{ type: 'dock', id: entityNode.id }])
  })

  it('unsaved state of a window is shown in the Designer and closing the Designer asks about it', async () => {
    const { user, backend, calls } = await setup()
    await moveViaMenu(user)
    await act(async () => {
      await backend.emit(EVENTS.floatAction, { type: 'editorDirty', id: entityNode.id, dirty: true } satisfies FloatAction)
    })
    await waitFor(() => expect(calls.guards).toContainEqual({ kind: 'main', name: '', on: true }))
    await act(async () => {
      await backend.emit(EVENTS.closeRequested, { kind: 'main', name: '' })
    })
    expect(await screen.findByText('1 document has unsaved changes (1 in separate window).')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls.exited).toBe(0)
    await act(async () => {
      await backend.emit(EVENTS.closeRequested, { kind: 'main', name: '' })
    })
    await user.click(await screen.findByRole('button', { name: "Don't Save" }))
    await waitFor(() => expect(calls.exited).toBe(1))
  })

  it('Save All and Exit asks the window to save first and only exits when it reports success', async () => {
    const { user, backend, calls } = await setup()
    await moveViaMenu(user)
    const commands: EditorCommand[] = []
    await backend.listen(EVENTS.editorCommand, async (p) => {
      const c = p as EditorCommand
      commands.push(c)
      if (c.type === 'save') await backend.emit(EVENTS.floatAction, { type: 'editorSaved', id: c.id, ok: true } satisfies FloatAction)
    })
    await act(async () => {
      await backend.emit(EVENTS.floatAction, { type: 'editorDirty', id: entityNode.id, dirty: true } satisfies FloatAction)
    })
    await act(async () => {
      await backend.emit(EVENTS.closeRequested, { kind: 'main', name: '' })
    })
    await user.click(await screen.findByRole('button', { name: 'Save All and Exit' }))
    await waitFor(() => expect(calls.exited).toBe(1))
    expect(commands).toContainEqual({ type: 'save', id: entityNode.id })
  })
})

describe('editor window', () => {
  async function renderWindow(payload: { node: TreeNode; dirty?: boolean; sub?: 'editor' | 'source' | 'history' }) {
    const { backend, calls } = fakeBackend()
    setWindowBackend(backend)
    const name = editorWindowName(payload.node.id)
    await backend.open({ kind: 'editor', name, title: 'x', width: 1, height: 1, payload: { node: payload.node, project: 'C:/p', sub: payload.sub ?? 'editor', dirty: payload.dirty ?? false } })
    const actions: FloatAction[] = []
    await backend.listen(EVENTS.floatAction, (p) => actions.push(p as FloatAction))
    const api = createMockForgeApi({ projectTree: tree, documents: { [entityNode.id]: { kind: 'object', fields: [] } } })
    const saved = vi.spyOn(api, 'save')
    render(<EditorWindowApp name={name} api={api} />)
    return { backend, calls, actions, api, saved, name }
  }

  it('draws the document, saves it on request of the Designer and reports the result', async () => {
    const { backend, actions, saved } = await renderWindow({ node: entityNode, dirty: true })
    await screen.findByText('Person')
    await act(async () => {
      await backend.emit(EVENTS.editorCommand, { type: 'save', id: entityNode.id } satisfies EditorCommand)
    })
    await waitFor(() => expect(saved).toHaveBeenCalledWith(entityNode.id))
    await waitFor(() => expect(actions).toContainEqual({ type: 'editorSaved', id: entityNode.id, ok: true }))
    expect(actions).toContainEqual({ type: 'editorDirty', id: entityNode.id, dirty: false })
  })

  it('the Dock button reports a dock result with the current sub tab and closes the window', async () => {
    const user = userEvent.setup()
    const { calls, name } = await renderWindow({ node: entityNode, sub: 'source' })
    await user.click(await screen.findByRole('button', { name: 'Dock' }))
    await waitFor(() => expect(calls.results).toHaveLength(1))
    expect(calls.results[0]).toEqual({ kind: 'editor', name, result: JSON.stringify({ dock: true, sub: 'source' }) })
  })

  it('dragging the grip back onto the Designer docks the editor, dropping it elsewhere does not', async () => {
    const { calls } = await renderWindow({ node: entityNode })
    const grip = (await screen.findByTitle(/Drag onto the Designer window/)) as HTMLElement
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.dragEnd(grip, { screenX: 10, screenY: 10 })
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.results).toHaveLength(0)

    setWindowBackend(null)
    const inside = fakeBackend({ mainContains: true })
    setWindowBackend(inside.backend)
    const name = editorWindowName(entityNode.id)
    await inside.backend.open({ kind: 'editor', name, title: 'x', width: 1, height: 1, payload: { node: entityNode, project: 'C:/p', sub: 'editor', dirty: false } })
    const api = createMockForgeApi({ projectTree: tree, documents: { [entityNode.id]: { kind: 'object', fields: [] } } })
    render(<EditorWindowApp name={name} api={api} />)
    const grips = await screen.findAllByTitle(/Drag onto the Designer window/)
    fireEvent.dragEnd(grips[grips.length - 1], { screenX: 10, screenY: 10 })
    await waitFor(() => expect(inside.calls.results).toHaveLength(1))
    expect(JSON.parse(inside.calls.results[0].result!)).toMatchObject({ dock: true })
  })

  it('selecting in the window makes the Designer show this object in Properties and Navigator', async () => {
    const { actions } = await renderWindow({ node: entityNode })
    await screen.findByText('Person')
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(actions).toContainEqual({ type: 'inspect', nodeId: entityNode.id, path: '$', label: 'Person' })
  })

  it('a file with unsaved text keeps the window open until the user has answered', async () => {
    const file: TreeNode = { id: 'C:/p/package.json', label: 'package.json', object_type: null, is_leaf: true, children: [], kind: 'file' }
    const user = userEvent.setup()
    const { backend, calls, name } = await renderWindow({ node: file, dirty: true })
    await waitFor(() => expect(calls.guards).toContainEqual({ kind: 'editor', name, on: true }))
    await act(async () => {
      await backend.emit(EVENTS.closeRequested, { kind: 'editor', name })
    })
    expect(await screen.findByText('package.json has unsaved changes.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls.results).toHaveLength(0)
    await act(async () => {
      await backend.emit(EVENTS.closeRequested, { kind: 'editor', name })
    })
    await user.click(await screen.findByRole('button', { name: "Don't Save" }))
    await waitFor(() => expect(calls.results).toEqual([{ kind: 'editor', name, result: null }]))
  })
})
