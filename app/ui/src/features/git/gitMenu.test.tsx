import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from '../../shell/Shell'
import { createMockForgeApi } from '../../test/mockApi'
import type { GitOverview } from '../../wire/types'

const git: GitOverview = {
  root: 'C:/demo',
  branch: 'main',
  files: [{ code: ' M', path: 'entity/A/A.aod' }],
  branches: [{ name: 'main', is_current: true }],
  remote_branches: [],
  commits: [],
}

const scm = { root: 'C:/demo', branch: 'main', upstream: null, ahead: 0, behind: 0, files: [{ path: 'entity/A/A.aod', index: ' ', worktree: 'M', from: null }], truncated: false, branches: [], remote_branches: [] }

async function openTeamGit(user: ReturnType<typeof userEvent.setup>, entry: string) {
  await user.click(screen.getByRole('menuitem', { name: 'Team' }))
  await user.click(within(screen.getByRole('menu', { name: 'Team' })).getByRole('menuitem', { name: 'Git' }))
  await user.click(screen.getByRole('menuitem', { name: entry }))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('Team > Git', () => {
  it('has no Source Control tab in the Projects panel', () => {
    render(<Shell api={createMockForgeApi({ projectTree: [], documents: {}, git, scm })} projectRoot="C:/demo" />)
    expect(screen.queryByRole('tab', { name: /Source Control/ })).toBeNull()
  })

  it('opens the Commit dialog for Commit... and commits nothing by itself', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git, scm })
    render(<Shell api={api} projectRoot="C:/demo" />)
    await openTeamGit(user, 'Commit...')
    expect(await screen.findByRole('button', { name: 'Commit & Push' })).toBeInTheDocument()
    expect(api.gitCalls).toEqual([])
  })

  it('runs Pull directly from the menu click without opening a dialog', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git, scm })
    render(<Shell api={api} projectRoot="C:/demo" />)
    await openTeamGit(user, 'Pull...')
    await waitFor(() => expect(api.gitCalls).toEqual(['pull']))
    expect(screen.queryByRole('button', { name: 'Commit & Push' })).toBeNull()
  })

  it('Sign In... opens the sign-in popup and signs in', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git, scm })
    render(<Shell api={api} projectRoot="C:/demo" />)
    await openTeamGit(user, 'Sign In...')
    await user.type(await screen.findByRole('textbox', { name: 'User Name' }), 'lion')
    await user.type(screen.getByLabelText('Password or Access Token'), 'tok')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(api.gitCalls).toEqual(['login:lion']))
  })

  it('dims Commit... when there are no changed files, the other Git actions stay on', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git, scm: { ...scm, files: [] } })
    render(<Shell api={api} projectRoot="C:/demo" />)
    await user.click(screen.getByRole('menuitem', { name: 'Team' }))
    await user.click(within(screen.getByRole('menu', { name: 'Team' })).getByRole('menuitem', { name: 'Git' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Commit...' })).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByRole('menuitem', { name: 'Pull...' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('dims the Git actions without a repository but keeps Repository... to connect one', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="C:/demo" />)
    await user.click(screen.getByRole('menuitem', { name: 'Team' }))
    await user.click(within(screen.getByRole('menu', { name: 'Team' })).getByRole('menuitem', { name: 'Git' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Commit...' })).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByRole('menuitem', { name: 'Repository...' })).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'Repository...' }))
    const url = await screen.findByRole('textbox', { name: 'Repository URL' })
    await user.type(url, 'https://example.org/demo.git')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(api.gitCalls).toEqual(['connect:https://example.org/demo.git']))
  })
})
