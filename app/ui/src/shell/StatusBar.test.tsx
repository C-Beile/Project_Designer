import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StatusBar } from './StatusBar'
import type { GitOverview } from '../wire/types'

const overview: GitOverview = {
  root: 'C:/p',
  branch: 'main',
  files: [],
  branches: [
    { name: 'main', is_current: true },
    { name: 'feature/x', is_current: false },
  ],
  remote_branches: ['origin/feature/y'],
  commits: [],
}

function setup(extra: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const calls = {
    problems: vi.fn(),
    output: vi.fn(),
    notifications: vi.fn(),
    services: vi.fn(),
    closeTunnels: vi.fn(),
    pick: vi.fn(),
    git: vi.fn(),
    checkout: vi.fn(),
  }
  render(
    <StatusBar
      system="dev1"
      systems={['dev1', 'qs']}
      onPickSystem={calls.pick}
      message=""
      task={null}
      branch="main"
      tunnel={true}
      errors={2}
      onShowProblems={calls.problems}
      onShowOutput={calls.output}
      onShowNotifications={calls.notifications}
      onShowServices={calls.services}
      onCloseTunnels={calls.closeTunnels}
      loadBranches={async () => overview}
      onGit={calls.git}
      onCheckoutBranch={calls.checkout}
      {...extra}
    />,
  )
  return calls
}

describe('StatusBar', () => {
  it('every cell is a focusable button with a tooltip', () => {
    setup()
    const bar = screen.getByRole('contentinfo', { name: 'Status bar' })
    const buttons = bar.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThanOrEqual(9)
    buttons.forEach((b) => expect(b.getAttribute('title')).toBeTruthy())
  })

  it('opens Problems, Output and Notifications from their cells', async () => {
    const user = userEvent.setup()
    const c = setup()
    await user.click(screen.getByRole('button', { name: /2 errors/ }))
    await user.click(screen.getByRole('button', { name: 'Background tasks' }))
    await user.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(c.problems).toHaveBeenCalled()
    expect(c.output).toHaveBeenCalled()
    expect(c.notifications).toHaveBeenCalled()
  })

  it('the system cell chooses a run configuration', async () => {
    const user = userEvent.setup()
    const c = setup()
    await user.click(screen.getByRole('button', { name: 'dev1' }))
    await user.click(screen.getByRole('menuitem', { name: /qs/ }))
    expect(c.pick).toHaveBeenCalledWith('qs')
  })

  it('the tunnel cell lists the overview and closes tunnels only on its own entry', async () => {
    const user = userEvent.setup()
    const c = setup()
    await user.click(screen.getByRole('button', { name: /Tunnel: on/ }))
    expect(c.closeTunnels).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Close Opened Tunnels' }))
    expect(c.closeTunnels).toHaveBeenCalledTimes(1)
  })

  it('the branch cell shows the Git Branches popup; a pick only preselects, nothing is switched', async () => {
    const user = userEvent.setup()
    const c = setup()
    await user.click(screen.getByRole('button', { name: 'main' }))
    const popup = await screen.findByRole('dialog', { name: 'Git Branches' })
    await waitFor(() => expect(popup).toHaveTextContent('feature/x'))
    expect(popup).toHaveTextContent('origin/feature/y')
    await user.click(screen.getByRole('button', { name: /^feature\/x/ }))
    expect(c.checkout).toHaveBeenCalledWith({ local: 'feature/x' })
    expect(c.git).not.toHaveBeenCalled()
  })

  it('right-click on the branch offers Commit, Pull, Push and New Branch', async () => {
    const user = userEvent.setup()
    const c = setup()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'main' }))
    await user.click(screen.getByRole('menuitem', { name: 'New Branch...' }))
    expect(c.git).toHaveBeenCalledWith('newBranch')
  })

  it('INS and caret are disabled without a code editor, encoding shows N/A', () => {
    setup()
    expect(screen.getByRole('button', { name: 'INS' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'N/A' })).toBeEnabled()
  })
})
