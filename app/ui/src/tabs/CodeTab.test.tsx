import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ObjectEditorArea } from './ObjectEditorArea'
import { createMockForgeApi } from '../test/mockApi'
import { codeTabNode } from '../properties/codeSave'
import { lastEditor, resetEditors } from '../test/monacoMock'
import type { CodeTarget } from '../wire/types'
import type { EditorTab } from './tabModel'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const target: CodeTarget = { ownerNodeId: 'C:/p/entity/Thing_entity/Thing_entity.aod', ownerName: 'Thing_entity', path: '$', prop: 'onInit', reference: '%aditoprj%/entity/Thing_entity/onInit.js', linkedRoot: 'C:/p', isNew: true }

function renderTab(isNew: boolean, drafts = new Map<string, string>(), onFileDirty = vi.fn()) {
  resetEditors()
  const api = createMockForgeApi({ projectTree: [], documents: {} })
  api.readLinkedFile = vi.fn(async () => 'existing code')
  const node = codeTabNode({ ...target, isNew }, false)
  const tab: EditorTab = { id: node.id, node, project: 'C:/proj', sub: 'editor' }
  render(
    <ObjectEditorArea
      tab={tab}
      api={api}
      value={null}
      Editor={undefined}
      projectRoot="C:/proj"
      version={0}
      drafts={drafts}
      onSubTab={() => {}}
      onTreeChange={() => {}}
      onApplied={() => {}}
      registerFlush={() => {}}
      onFileDirty={onFileDirty}
      db={{ connected: false, tunnel_up: false, database: null, host: null }}
      sqlTexts={new Map()}
      onDbChange={() => {}}
    />,
  )
  return { api, node, drafts, onFileDirty }
}

describe('code property as editor tab', () => {
  it('a new property opens an empty editor without reading a file and the tab has Editor and History', async () => {
    const { api } = renderTab(true)
    await waitFor(() => expect(lastEditor().language).toBe('javascript'))
    expect(lastEditor().value).toBe('')
    expect(api.readLinkedFile).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Editor' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument()
  })

  it('an existing property loads its file, is writable and marks the tab dirty on typing', async () => {
    const { node, drafts, onFileDirty } = renderTab(false)
    await waitFor(() => expect(lastEditor().value).toBe('existing code'))
    expect(lastEditor().options.readOnly).toBeFalsy()
    lastEditor().type('changed')
    expect(drafts.get(node.id)).toBe('changed')
    expect(onFileDirty).toHaveBeenCalledWith(node.id, true)
  })
})