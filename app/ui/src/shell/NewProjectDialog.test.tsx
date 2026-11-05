import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../test/mockApi'
import { NewProjectDialog, projectNameFromUrl } from './NewProjectDialog'

const OVERVIEW = { root: 'C:/p/x', branch: 'main', files: [], branches: [{ name: 'main', is_current: true }], remote_branches: ['origin/main', 'origin/dev'], commits: [] }

function setup(over: Record<string, unknown> = {}) {
  const api = createMockForgeApi({ projectTree: [], documents: {} } as never)
  Object.assign(api, over)
  const onCreated = vi.fn()
  render(<NewProjectDialog api={api} currentProject="C:/repos/current" onClose={vi.fn()} onCreated={onCreated} />)
  return { api, onCreated }
}

describe('NewProjectDialog', () => {
  it('names the project after the repository', () => {
    expect(projectNameFromUrl('https://github.com/a/clemens-onboarding.git')).toBe('clemens-onboarding')
    expect(projectNameFromUrl('git@github.com:a/b.git')).toBe('b')
  })

  it('lists the sources and keeps the ones without a server off', () => {
    setup()
    expect(screen.getByLabelText(/Clone from a Git repository/)).toBeChecked()
    expect(screen.getByLabelText(/Load a cloud system/)).toBeDisabled()
  })

  it('clones, offers the branches and opens the project on the chosen one', async () => {
    const user = userEvent.setup()
    const projectClone = vi.fn().mockResolvedValue('C:/repos/x')
    const gitCreateBranch = vi.fn().mockResolvedValue({ ok: true, message: '' })
    const { onCreated } = setup({ projectClone, gitCreateBranch, gitOverview: vi.fn().mockResolvedValue(OVERVIEW) })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/a/x.git')
    expect(screen.getByLabelText('Project Name')).toHaveValue('x')
    expect(screen.getByLabelText('Project Location')).toHaveValue('C:/repos')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(projectClone).toHaveBeenCalledWith('https://github.com/a/x.git', 'C:/repos', 'x', null, null)
    await user.selectOptions(await screen.findByLabelText('Branch'), 'dev')
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(gitCreateBranch).toHaveBeenCalledWith('C:/repos/x', 'dev', 'origin/dev')
    expect(onCreated).toHaveBeenCalledWith('C:/repos/x')
  })

  it('shows the error of a failed clone and stays on the details', async () => {
    const user = userEvent.setup()
    setup({ projectClone: vi.fn().mockRejectedValue(new Error('Repository not found.')) })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/a/x.git')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Repository not found.')
  })

  it('creates an empty project without asking for a branch', async () => {
    const user = userEvent.setup()
    const projectCreateEmpty = vi.fn().mockResolvedValue('C:/repos/new')
    const { onCreated } = setup({ projectCreateEmpty })
    await user.click(screen.getByLabelText(/Create an empty project/))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByLabelText('Project Name'), 'new')
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(onCreated).toHaveBeenCalledWith('C:/repos/new')
  })
})
