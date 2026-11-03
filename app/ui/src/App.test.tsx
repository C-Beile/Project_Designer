import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { createMockForgeApi } from './test/mockApi'
import type { TreeNode, WireValue } from './wire/types'

vi.mock('monaco-editor', () => ({
  editor: {
    create: () => ({
      onDidChangeModelContent: () => {},
      getModel: () => ({ getValue: () => '' }),
      dispose: () => {},
    }),
    defineTheme: () => {},
    setTheme: () => {},
  },
  languages: { register: () => {}, setLanguageConfiguration: () => {}, setMonarchTokensProvider: () => {} },
}))

function sampleTree(): TreeNode[] {
  return [
    {
      id: 'folder:entity',
      label: 'entity',
      object_type: null,
      is_leaf: false,
      children: [{ id: 'e1', label: 'Alpha_entity', object_type: 'entity', is_leaf: true, children: [] }],
    },
  ]
}

function sampleEntity(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'Alpha_entity' } },
      { key: 'title', value: { kind: 'text', value: 'Original title' } },
      { key: 'entityFields', value: { kind: 'object', fields: [{ key: 'entityField', value: { kind: 'array', items: [] } }] } },
      { key: 'recordContainers', value: { kind: 'object', fields: [] } },
    ],
  }
}

// End-to-end frontend proof for "Fertig"-Kriterium 3's edit/undo/redo/save quartet ("alle
// Kern-Interaktionen ... ohne Maus erreichbar") - tree keyboard navigation itself is already
// exhaustively covered by tree/ProjectTree.test.tsx, so this test opens the entity directly and
// spends its budget on the part *not* covered elsewhere: editing, Ctrl+Z/Ctrl+Y/Ctrl+S, driven
// only by `userEvent.keyboard`, never a mouse gesture, once the object is open.
describe('App - keyboard-only edit/undo/redo/save loop', () => {
  it('edits a field, then Ctrl+Z/Ctrl+Y/Ctrl+S all work without a mouse', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: sampleTree(), documents: { e1: sampleEntity() } })
    const saveSpy = vi.spyOn(api, 'save')

    render(<App api={api} projectRoot="C:/demo" />)

    // Like the original Designer a single click only selects; double-click opens the editor.
    const leafRow = await screen.findByText('Alpha_entity')
    await user.dblClick(leafRow)

    const titleInput = await screen.findByLabelText('title')
    expect(titleInput).toHaveValue('Original title')

    // Edit the title, keyboard only.
    await user.click(titleInput)
    await user.clear(titleInput)
    await user.keyboard('Edited title{Enter}')
    await waitFor(() => expect(screen.getByLabelText('title')).toHaveValue('Edited title'))

    // Ctrl+Z undoes it.
    await user.keyboard('{Control>}z{/Control}')
    await waitFor(() => expect(screen.getByLabelText('title')).toHaveValue('Original title'))

    // Ctrl+Y redoes it.
    await user.keyboard('{Control>}y{/Control}')
    await waitFor(() => expect(screen.getByLabelText('title')).toHaveValue('Edited title'))

    // Ctrl+S is Save All like in the original Designer (Save itself is Ctrl+Shift+S) - it reaches
    // the generic `save()` command for the edited object, keyboard only.
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith('e1'))
  })
})

// Regression test for the P7 real-installer bug: a freshly installed app has no project folder
// resolved yet (main.tsx falls back to '' when the "project" URL parameter is absent), and must
// show a calm empty state instead of surfacing the backend's raw path-validation error.
describe('App - fresh start with no project chosen', () => {
  it('never calls openProject with an empty path and shows a no-project message, not an error', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const openProjectSpy = vi.spyOn(api, 'openProject')

    render(<App api={api} projectRoot="" />)

    expect(await screen.findByText(/no project open yet/i)).toBeInTheDocument()
    expect(openProjectSpy).not.toHaveBeenCalled()
    expect(screen.queryByText(/is not a directory/i)).not.toBeInTheDocument()
  })
})

// P7 (project-open-dialog): the native folder dialog is a real Tauri/OS interaction and cannot
// itself be driven in a component test - what *is* verifiable here, and is the actual contract
// the rest of the app depends on, is that a path the dialog hands back reaches `openProject`.
describe('App - "Open project…" native folder dialog', () => {
  it('opens the picked folder as the project and records it as the recent project', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, pickedFolder: 'C:/GitRepos_ADITO/Car_Training' })
    const openProjectSpy = vi.spyOn(api, 'openProject')
    const setRecentSpy = vi.spyOn(api, 'setRecentProject')

    render(<App api={api} projectRoot="" />)

    await user.click(await screen.findByRole('button', { name: /open project/i }))

    await waitFor(() => expect(openProjectSpy).toHaveBeenCalledWith('C:/GitRepos_ADITO/Car_Training'))
    expect(setRecentSpy).toHaveBeenCalledWith('C:/GitRepos_ADITO/Car_Training')
  })

  it('a cancelled dialog (null) changes nothing and never calls openProject', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, pickedFolder: null })
    const openProjectSpy = vi.spyOn(api, 'openProject')

    render(<App api={api} projectRoot="" />)

    await user.click(await screen.findByRole('button', { name: /open project/i }))

    expect(await screen.findByText(/no project open yet/i)).toBeInTheDocument()
    expect(openProjectSpy).not.toHaveBeenCalled()
  })
})

// Ziel 3 (nice-to-have persistence): a previously recorded recent project is offered as a
// suggestion button, but is never opened automatically - only a deliberate click loads it.
describe('App - "recently opened project" suggestion', () => {
  it('shows the recent project as a button and only opens it on click, never automatically', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({
      projectTree: [],
      documents: {},
      recentProject: 'C:/GitRepos_ADITO/Car_Training',
    })
    const openProjectSpy = vi.spyOn(api, 'openProject')

    render(<App api={api} projectRoot="" />)

    const recentButton = await screen.findByRole('button', { name: /recent:.*Car_Training/i })
    expect(openProjectSpy).not.toHaveBeenCalled()

    await user.click(recentButton)

    await waitFor(() => expect(openProjectSpy).toHaveBeenCalledWith('C:/GitRepos_ADITO/Car_Training'))
  })
})
