import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectTree } from './ProjectTree'
import type { TreeNode } from '../wire/types'

const sampleTree: TreeNode[] = [
  {
    id: 'folder:entity',
    label: 'entity',
    object_type: null,
    is_leaf: false,
    children: [
      { id: 'e1', label: 'Alpha_entity', object_type: 'entity', is_leaf: true, children: [] },
      { id: 'e2', label: 'Beta_entity', object_type: 'entity', is_leaf: true, children: [] },
    ],
  },
]

const FOLDERS = [
  'system', 'preferences', 'application', 'context', 'notificationtype', 'entity', 'dashboard', 'renderer',
  'process', 'test', 'service', 'report', 'language', 'role', 'alias', 'others',
]

function project(name: string, extra: TreeNode[] = []): TreeNode {
  const folders: TreeNode[] = FOLDERS.map((f) => ({
    id: `folder:C:/r/${name}|${f}`,
    label: f,
    object_type: null,
    kind: 'folder',
    folder: f,
    is_leaf: f === 'test',
    dimmed: f === 'test',
    children:
      f === 'context'
        ? [
            {
              id: `C:/r/${name}/node_modules/@a/activity/neonContext/Activity/Activity.aod`,
              label: 'Activity',
              object_type: 'neonContext',
              kind: 'object',
              origin: '@aditosoftware/activity:6.4.0',
              read_only: true,
              is_leaf: false,
              children: [
                {
                  id: `C:/r/${name}/node_modules/@a/mail/neonView/Mail_view/Mail_view.aod`,
                  label: 'ActivityMail_view',
                  object_type: 'neonView',
                  kind: 'object',
                  origin: '@aditosoftware/mail-processing:5.2.0',
                  overrides: ['@3hills-IT/easescreen:1.6.5-RC1'],
                  read_only: true,
                  is_leaf: true,
                  children: [],
                },
              ],
            },
          ]
        : f === 'test'
          ? []
          : [{ id: `C:/r/${name}/${f}/x/x.aod`, label: `${f}_obj`, object_type: f, kind: 'object', is_leaf: true, children: [] }],
  }))
  return {
    id: `project:C:/r/${name}`,
    label: name,
    object_type: null,
    kind: 'project',
    bold: true,
    type_label: 'ADITO xRM',
    path: `C:/r/${name}`,
    is_leaf: false,
    children: [...folders, ...extra],
  }
}

describe('ProjectTree keyboard navigation ("Fertig"-Kriterium 3)', () => {
  it('opens a leaf with Enter after navigating down with the keyboard, no mouse involved', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ProjectTree roots={sampleTree} onOpen={onOpen} />)

    screen.getAllByRole('treeitem')[0].focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(sampleTree[0].children[1], sampleTree[0])
  })

  it('collapses an expanded folder with ArrowLeft, hiding its children from the accessible tree', async () => {
    const user = userEvent.setup()
    render(<ProjectTree roots={sampleTree} />)
    expect(screen.getByText('Alpha_entity')).toBeInTheDocument()
    screen.getAllByRole('treeitem')[0].focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.queryByText('Alpha_entity')).not.toBeInTheDocument()
  })

  it('every row is keyboard-reachable via a single roving tabIndex, never more than one at a time', () => {
    render(<ProjectTree roots={sampleTree} />)
    const tabbable = screen.getAllByRole('treeitem').filter((r) => r.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
  })

  it('Home/End jump to the first/last row and typing a name moves there', async () => {
    const user = userEvent.setup()
    render(<ProjectTree roots={sampleTree} />)
    screen.getAllByRole('treeitem')[0].focus()
    await user.keyboard('{End}')
    expect(screen.getByText('Beta_entity').closest('li')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByText('entity').closest('li')).toHaveFocus()
    await user.keyboard('al')
    expect(screen.getByText('Alpha_entity').closest('li')).toHaveFocus()
  })
})

describe('ProjectTree - Designer structure (LAYOUT_SPEC §4.2/§4.4)', () => {
  it('shows several project roots with bold name and type, path dimmed', () => {
    render(<ProjectTree roots={[project('Pichler'), project('FZ_Juerlich')]} />)
    const roots = screen.getAllByRole('treeitem').filter((r) => r.getAttribute('aria-level') === '1')
    expect(roots.map((r) => r.querySelector('.project-tree-label')!.textContent)).toEqual(['Pichler', 'FZ_Juerlich'])
    const pichler = roots[0]
    expect(within(pichler).getByText('Pichler')).toHaveClass('is-bold')
    expect(within(pichler).getByText('[ADITO xRM]')).toHaveClass('is-bold')
    expect(within(pichler).getByText('C:/r/Pichler')).toHaveClass('project-tree-dim')
  })

  it('lists the sixteen folders in the Designer order', () => {
    render(<ProjectTree roots={[project('Pichler')]} />)
    const level2 = screen.getAllByRole('treeitem').filter((r) => r.getAttribute('aria-level') === '2')
    expect(level2.map((r) => r.querySelector('.project-tree-label')!.textContent)).toEqual(FOLDERS)
  })

  it('an empty folder has no expander and is dimmed', () => {
    render(<ProjectTree roots={[project('Pichler')]} />)
    const test = screen.getByText('test').closest('li')!
    expect(test).not.toHaveAttribute('aria-expanded')
    expect(test).toHaveAttribute('data-dimmed', 'true')
    expect(test.querySelector('.project-tree-toggle')!.textContent).toBe('')
    expect(screen.getByText('process').closest('li')).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows module origin and override chain dimmed behind the name, project objects without', async () => {
    const user = userEvent.setup()
    render(<ProjectTree roots={[project('Pichler')]} />)
    await user.click(screen.getByText('context').closest('li')!.querySelector('.project-tree-toggle')!)
    await user.click(screen.getByText('Activity').closest('li')!.querySelector('.project-tree-toggle')!)
    const view = screen.getByText('ActivityMail_view').closest('li')!
    expect(within(view).getByText('@aditosoftware/mail-processing:5.2.0')).toHaveClass('project-tree-dim')
    expect(within(view).getByText('(@3hills-IT/easescreen:1.6.5-RC1)')).toHaveClass('project-tree-dim')
    expect(view.getAttribute('title')).toContain('ActivityMail_view @aditosoftware/mail-processing:5.2.0')
    expect(view).toHaveAttribute('data-read-only', 'true')
    expect(view).toHaveAttribute('aria-readonly', 'true')
    await user.click(screen.getByText('entity').closest('li')!.querySelector('.project-tree-toggle')!)
    expect(screen.getByText('entity_obj').closest('li')!.querySelector('.project-tree-origin')).toBeNull()
  })

  it('single click selects, double click opens', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    const p = project('Pichler')
    render(<ProjectTree roots={[p]} onSelect={onSelect} onOpen={onOpen} />)
    const entityRow = screen.getByText('entity').closest('li')!
    await user.click(entityRow.querySelector('.project-tree-toggle')!)
    const obj = screen.getByText('entity_obj').closest('li')!
    await user.click(obj)
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'entity_obj' }), p)
    expect(obj).toHaveAttribute('aria-selected', 'true')
    expect(onOpen).not.toHaveBeenCalled()
    await user.dblClick(obj)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ label: 'entity_obj' }), p)
  })

  it('double click on a folder only expands it, never opens', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ProjectTree roots={[project('Pichler')]} onOpen={onOpen} />)
    await user.dblClick(screen.getByText('role').closest('li')!)
    expect(screen.getByText('role_obj')).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('loads lazy children (module file trees) on first expand', async () => {
    const user = userEvent.setup()
    const lib: TreeNode = {
      id: 'libraries:C:/r/P',
      label: 'External Libraries',
      object_type: null,
      kind: 'libraries',
      is_leaf: false,
      children: [
        { id: 'dir:C:/r/P/node_modules/@a/activity', label: 'activity', object_type: null, kind: 'module', bold: true, lazy: true, read_only: true, path: 'C:/r/P/node_modules/@a/activity', is_leaf: false, children: [] },
      ],
    }
    const loadChildren = vi.fn(async () => [{ id: 'C:/x/package.json', label: 'package.json', object_type: null, kind: 'file' as const, read_only: true, is_leaf: true, children: [] }])
    render(<ProjectTree roots={[lib]} loadChildren={loadChildren} />)
    await user.click(screen.getByText('activity').closest('li')!.querySelector('.project-tree-toggle')!)
    expect(loadChildren).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('package.json')).toBeInTheDocument())
  })

  it('stays virtualised with thousands of rows', async () => {
    const user = userEvent.setup()
    const many: TreeNode = {
      id: 'folder:big',
      label: 'entity',
      object_type: null,
      is_leaf: false,
      children: Array.from({ length: 5000 }, (_, i) => ({ id: `e${i}`, label: `E${String(i).padStart(4, '0')}_entity`, object_type: 'entity', is_leaf: true, children: [] })),
    }
    render(<ProjectTree roots={[many]} />)
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(100)
    expect(screen.getByRole('tree').style.height).toBe(`${5001 * 19}px`)
    screen.getAllByRole('treeitem')[0].focus()
    await user.keyboard('{End}')
    expect(screen.getByText('E4999_entity').closest('li')).toHaveFocus()
  })
})

describe('file keys', () => {
  it('Ctrl+X, Ctrl+C, Ctrl+V and Delete report the key and the row', async () => {
    const calls: [string, string][] = []
    render(<ProjectTree roots={sampleTree} onFileKey={(k, n) => calls.push([k, n.label])} />)
    const row = screen.getAllByRole('treeitem')[0]
    row.focus()
    const user = userEvent.setup()
    await user.keyboard('{Control>}x{/Control}{Control>}c{/Control}{Control>}v{/Control}{Delete}')
    expect(calls.map((c) => c[0])).toEqual(['cut', 'copy', 'paste', 'delete'])
  })
})
