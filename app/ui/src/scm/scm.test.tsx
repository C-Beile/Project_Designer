import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../test/mockApi'
import { diffEditors, resetEditors } from '../test/monacoMock'
import { ScmPanel } from './ScmPanel'
import { DiffView } from './DiffView'
import { _resetScmForTests, codeOf, decorationFor, indexOf } from './scmStore'
import { DialogHost, _resetDialogsForTests } from '../shell/dialogService'
import { clearNotifications, getNotifications } from '../shell/notifications'
import { ProjectTree } from '../tree/ProjectTree'
import type { ScmOverview, TreeNode } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const ROOT = 'C:/work/proj'

function overview(): ScmOverview {
  return {
    root: ROOT,
    branch: 'main',
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
    truncated: false,
    branches: [
      { name: 'main', is_current: true },
      { name: 'feature/x', is_current: false },
    ],
    remote_branches: ['origin/release'],
    files: [
      { path: 'entity/A/A.aod', index: ' ', worktree: 'M', from: null },
      { path: 'process/B/process.js', index: 'M', worktree: ' ', from: null },
      { path: 'notes.txt', index: '?', worktree: '?', from: null },
      { path: 'package-lock.json', index: ' ', worktree: 'M', from: null },
    ],
  }
}

function setup(scm: ScmOverview = overview()) {
  const api = createMockForgeApi({
    projectTree: [],
    documents: {},
    scm,
    scmHistory: [{ hash: 'abcdef1234', author: 'Clemens', date: '2026-10-14T10:00:00+02:00', subject: 'Add entity A' }],
  })
  const onOpenDiff = vi.fn()
  const onChanged = vi.fn()
  render(
    <>
      <DialogHost />
      <ScmPanel api={api} root={ROOT} onOpenDiff={onOpenDiff} onChanged={onChanged} />
    </>,
  )
  return { api, onOpenDiff, onChanged }
}

beforeEach(() => {
  _resetScmForTests()
  _resetDialogsForTests()
  clearNotifications()
  resetEditors()
})

describe('Source Control panel', () => {
  it('lists staged and other changes, opens the diff of the clicked side', async () => {
    const user = userEvent.setup()
    const { onOpenDiff } = setup()
    expect(await screen.findByRole('list', { name: 'Staged changes' })).toHaveTextContent('process.js')
    expect(screen.getByRole('list', { name: 'Changes' })).toHaveTextContent('A.aod')
    await user.click(screen.getByText('A.aod'))
    expect(onOpenDiff).toHaveBeenCalledWith({ root: ROOT, path: 'entity/A/A.aod', side: 'unstaged' })
    await user.click(screen.getByText('process.js'))
    expect(onOpenDiff).toHaveBeenLastCalledWith({ root: ROOT, path: 'process/B/process.js', side: 'staged' })
  })

  it('stage, unstage and Stage All; package-lock.json stays out of Stage All and is flagged', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByRole('list', { name: 'Changes' })
    await user.click(screen.getByRole('button', { name: 'Stage entity/A/A.aod' }))
    await waitFor(() => expect(api.gitCalls).toContain('stage:entity/A/A.aod'))
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Staged changes' })).getByText('A.aod')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Unstage entity/A/A.aod' }))
    await waitFor(() => expect(api.gitCalls).toContain('unstage:entity/A/A.aod'))
    await user.click(await screen.findByRole('button', { name: 'Stage All Changes' }))
    await waitFor(() => expect(api.gitCalls).toContain('stageAll'))
    expect(within(screen.getByRole('list', { name: 'Changes' })).getByText('package-lock.json')).toBeInTheDocument()
    expect(screen.getByText(/never committed from here/)).toBeInTheDocument()
  })

  it('discard asks first, in the window, and does nothing when declined', async () => {
    const user = userEvent.setup()
    const { api, onChanged } = setup()
    await screen.findByRole('list', { name: 'Changes' })
    await user.click(screen.getByRole('button', { name: 'Discard notes.txt' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard Changes' })
    expect(dialog).toHaveTextContent('Delete the new file notes.txt')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.gitCalls.some((c) => c.startsWith('discard'))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Discard notes.txt' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(api.gitCalls).toContain('discard:notes.txt'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('commits the staged files with a one-line message and then clears the field', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    const input = await screen.findByRole('textbox', { name: 'Commit message' })
    const commit = screen.getByRole('button', { name: 'Commit' })
    expect(commit).toBeDisabled()
    await user.type(input, 'Fix process')
    await user.click(commit)
    await waitFor(() => expect(api.gitCalls).toContain('scmcommit:Fix process'))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(getNotifications().some((n) => n.text === 'Committed.')).toBe(true)
  })

  it('a staged package-lock.json blocks the commit with a message', async () => {
    const user = userEvent.setup()
    const o = overview()
    o.files = [{ path: 'package-lock.json', index: 'M', worktree: ' ', from: null }]
    setup(o)
    await user.type(await screen.findByRole('textbox', { name: 'Commit message' }), 'x')
    await user.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(getNotifications().some((n) => /package-lock\.json is staged/.test(n.text) && n.kind === 'error')).toBe(true))
  })

  it('Commit & Push commits first and pushes second', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await user.type(await screen.findByRole('textbox', { name: 'Commit message' }), 'Ship it')
    await user.click(screen.getByRole('button', { name: 'Commit & Push' }))
    await waitFor(() => expect(api.gitCalls).toEqual(expect.arrayContaining(['scmcommit:Ship it', 'push'])))
    expect(api.gitCalls.indexOf('scmcommit:Ship it')).toBeLessThan(api.gitCalls.indexOf('push'))
  })

  it('Pull, Push and Sync are single clicks on their own buttons', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await screen.findByRole('button', { name: 'Pull' })
    await user.click(screen.getByRole('button', { name: 'Pull' }))
    await user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(api.gitCalls).toEqual(expect.arrayContaining(['pull', 'sync'])))
    expect(api.gitCalls).not.toContain('push')
  })

  it('the branch quick pick switches on one click and creates a branch from a remote one after a name prompt', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await user.click(await screen.findByRole('button', { name: /main/ }))
    await user.click(screen.getByRole('option', { name: 'feature/x' }))
    await waitFor(() => expect(api.gitCalls).toContain('checkout:feature/x'))
    await user.click(await screen.findByRole('button', { name: /feature\/x|main/ }))
    await user.click(screen.getByRole('option', { name: 'origin/release' }))
    const prompt = await screen.findByRole('dialog', { name: 'New Branch' })
    expect(within(prompt).getByRole('textbox')).toHaveValue('release')
    await user.click(within(prompt).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.gitCalls).toContain('newbranch:release:origin/release'))
  })

  it('history lists commits, shows their files and opens the diff of a commit', async () => {
    const user = userEvent.setup()
    const { onOpenDiff } = setup()
    await user.click(await screen.findByRole('button', { name: /History/ }))
    await user.click(await screen.findByText('Add entity A'))
    await user.click(await screen.findByText('A.aod', { selector: '.scm-commit-files .scm-name' }))
    expect(onOpenDiff).toHaveBeenCalledWith({ root: ROOT, path: 'entity/A/A.aod', side: 'commit', hash: 'abcdef1234' })
  })

  it('outside a repository the panel says so instead of failing', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<ScmPanel api={api} root={ROOT} onOpenDiff={() => {}} onChanged={() => {}} />)
    expect(await screen.findByRole('status')).toHaveTextContent('not inside a Git repository')
  })
})

describe('Git decorations', () => {
  it('maps the status codes and finds changes of an object folder and of parent folders', () => {
    const o = overview()
    expect(codeOf(o.files[0])).toBe('M')
    expect(codeOf(o.files[2])).toBe('U')
    expect(codeOf({ path: 'x', index: 'A', worktree: ' ', from: null })).toBe('A')
    expect(codeOf({ path: 'x', index: 'U', worktree: 'U', from: null })).toBe('C')
    const idx = indexOf(o)
    expect(decorationFor(idx, 'C:\\work\\proj\\entity\\A\\A.aod', 'object')).toBe('M')
    expect(decorationFor(idx, 'C:/work/proj/process/B/B.aod', 'object')).toBe('M')
    expect(decorationFor(idx, 'C:/work/proj/entity/C/C.aod', 'object')).toBeNull()
    expect(decorationFor(idx, 'C:/work/proj/notes.txt', 'file')).toBe('U')
    expect(decorationFor(idx, 'C:/work/proj/entity', 'folder')).toBe('M')
    expect(decorationFor(null, 'C:/work/proj/notes.txt', 'file')).toBeNull()
  })

  it('the project tree colours changed rows and shows the letter', () => {
    const node: TreeNode = { id: 'C:/work/proj/entity/A/A.aod', label: 'A', object_type: 'entity', is_leaf: true, children: [], kind: 'object' }
    render(<ProjectTree roots={[node]} gitFor={(n) => (n.id.endsWith('A.aod') ? { code: 'M', title: 'Modified (Git)' } : null)} />)
    const row = screen.getByRole('treeitem')
    expect(row).toHaveAttribute('data-git', 'M')
    expect(within(row).getByRole('img', { name: 'Modified (Git)' })).toHaveTextContent('M')
  })
})

describe('Diff tab', () => {
  it('opens the Monaco diff editor read-only with both versions', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, scm: overview() })
    render(<DiffView api={api} target={{ root: ROOT, path: 'notes.json', side: 'unstaged' }} />)
    await screen.findByTestId('diff-host')
    await waitFor(() => expect(diffEditors).toHaveLength(1))
    expect(diffEditors[0]).toMatchObject({ original: 'old\n', modified: 'new\n', language: 'json' })
    expect(diffEditors[0].options).toMatchObject({ readOnly: true, originalEditable: false })
    expect(api.gitCalls).toContain('diff:unstaged:notes.json')
  })
})
