import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from '../../shell/Shell'
import { registerGitPlugin } from './gitPlugin'
import { _resetPluginRegistryForTests } from '../../core/plugins/registry'
import { createMockForgeApi } from '../../test/mockApi'

// Die Shell darf Git nicht kennen: ohne das Plugin startet sie ohne Team-Git, Git-Toolbar und Branch-Knopf.

beforeEach(() => {
  window.localStorage.clear()
  _resetPluginRegistryForTests()
})

// Die globale Test-Einrichtung hat das Plugin einmal angemeldet; für die übrigen Tests wieder herstellen.
afterEach(() => {
  _resetPluginRegistryForTests()
  registerGitPlugin()
})

describe('Shell without and with the Git plugin', () => {
  it('renders without registerGitPlugin(): no Git toolbar, no branch button, no Git in Team', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const { container } = render(<Shell api={api} projectRoot="C:/demo" />)
    expect(screen.getByRole('button', { name: 'Deploy Project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Commit Changed Files' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show Project History' })).toBeNull()
    expect(container.querySelector('.forge-status-branch')).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Team' }))
    const team = screen.getByRole('menu', { name: 'Team' })
    expect(within(team).queryByRole('menuitem', { name: 'Git' })).toBeNull()
    expect(within(team).queryByRole('menuitem', { name: 'History' })).toBeNull()
  })

  it('shows the Git toolbar, the branch button and Git in Team with the plugin', async () => {
    registerGitPlugin()
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const { container } = render(<Shell api={api} projectRoot="C:/demo" />)
    expect(screen.getByRole('button', { name: 'Commit Changed Files' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Project History' })).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.forge-status-branch')).not.toBeNull())
    await user.click(screen.getByRole('menuitem', { name: 'Team' }))
    const team = screen.getByRole('menu', { name: 'Team' })
    expect(within(team).getByRole('menuitem', { name: 'Git' })).toBeInTheDocument()
    expect(within(team).getByRole('menuitem', { name: 'History' })).toBeInTheDocument()
  })
})
