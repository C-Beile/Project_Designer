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
    render(<Shell api={createMockForgeApi({ projectTree: [], documents: {}, git })} projectRoot="C:/demo" />)
    expect(screen.queryByRole('tab', { name: /Source Control/ })).toBeNull()
  })

  it('opens the Commit dialog for Commit... and commits nothing by itself', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<Shell api={api} projectRoot="C:/demo" />)
    await openTeamGit(user, 'Commit...')
    expect(await screen.findByRole('button', { name: 'Commit & Push' })).toBeInTheDocument()
    expect(api.gitCalls).toEqual([])
  })

  it('runs Pull directly from the menu click without opening a dialog', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<Shell api={api} projectRoot="C:/demo" />)
    await openTeamGit(user, 'Pull...')
    await waitFor(() => expect(api.gitCalls).toEqual(['pull']))
    expect(screen.queryByRole('button', { name: 'Commit & Push' })).toBeNull()
  })
})
