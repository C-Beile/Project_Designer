import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GitDialog } from './GitDialog'
import { createMockForgeApi } from '../../test/mockApi'
import type { GitOverview } from '../../wire/types'

describe('GitDialog', () => {
  const git: GitOverview = {
    root: 'C:/p',
    branch: 'main',
    files: [
      { code: ' M', path: 'entity/A/A.aod' },
      { code: '??', path: 'package-lock.json' },
    ],
    branches: [
      { name: 'main', is_current: true },
      { name: 'feature/x', is_current: false },
    ],
    remote_branches: ['origin/main', 'origin/feature/y'],
    commits: [{ hash: '1234567890', author: 'Me', date: '2026-10-12T09:00:00+02:00', subject: 'Init' }],
  }

  it('commits only the checked files with a one-line message, package-lock unchecked by default', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('A.aod')
    expect(screen.getByRole('checkbox', { name: /package-lock.json/ })).not.toBeChecked()
    const commit = screen.getByRole('button', { name: 'Commit' })
    expect(commit).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Commit message' }), 'Fix tree icons')
    await user.click(commit)
    await waitFor(() => expect(api.gitCalls).toEqual(['commit:Fix tree icons:entity/A/A.aod']))
  })

  it('shows the Commit dialog without tabs and without Pull and Push buttons, as the original does', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('A.aod')
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pull' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Push' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Commit & Push' })).toBeInTheDocument()
    expect(api.gitCalls).toEqual([])
  })

  it('shows the project folder as the root of the tree with its sub folders and the git author, as in the original', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, git: { ...git, user_name: 'Clemens Beile', user_email: 'c@example.invalid' } })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('A.aod')
    expect(screen.getByRole('checkbox', { name: 'p' })).toBeInTheDocument()
    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'entity' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'A' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Clemens Beile')).toBeInTheDocument()
    expect(screen.getByDisplayValue('c@example.invalid')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Commit message' }).tagName).toBe('TEXTAREA')
  })

  it('runs nothing on its own and switches branches only on click', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="branches" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByRole('button', { name: 'Switch branch' })
    expect(api.gitCalls).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Switch branch' }))
    await waitFor(() => expect(api.gitCalls).toEqual(['checkout:feature/x']))
  })

  it('commits and pushes with the Commit & Push button', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('A.aod')
    const both = screen.getByRole('button', { name: 'Commit & Push' })
    expect(both).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Commit message' }), 'Fix')
    await user.click(both)
    await waitFor(() => expect(api.gitCalls).toEqual(['commit:Fix:entity/A/A.aod', 'push']))
  })

  it('creates a branch from a remote branch on click', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="branches" onClose={() => {}} onChanged={() => {}} />)
    await user.type(await screen.findByRole('textbox', { name: 'New branch name' }), 'feature/z')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Start from' }), 'origin/feature/y')
    await user.click(screen.getByRole('button', { name: 'Create and switch' }))
    await waitFor(() => expect(api.gitCalls).toEqual(['newbranch:feature/z:origin/feature/y']))
  })

  it('lists the history and reports a folder outside a repository', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    const { unmount } = render(<GitDialog api={api} projectRoot="C:/p" initialTab="history" onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText('Init')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    unmount()
    render(<GitDialog api={createMockForgeApi({ projectTree: [], documents: {} })} projectRoot="C:/q" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('not inside a Git repository')
  })
})
