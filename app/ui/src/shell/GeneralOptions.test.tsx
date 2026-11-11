import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../test/mockApi'
import { DEFAULT_OPTIONS } from '../settings/options'
import { GeneralOptions } from './GeneralOptions'
import { getWorkspaceFolders, setWorkspaceFolder } from '../settings/workspaceFolder'

describe('GeneralOptions', () => {
  it('passes a switched option on', async () => {
    const onChange = vi.fn()
    render(<GeneralOptions api={createMockForgeApi({ projectTree: [], documents: {} })} opts={DEFAULT_OPTIONS.general} onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch', { name: /Reopen the projects/ }))
    expect(onChange).toHaveBeenCalledWith({ restoreProjects: false })
  })

  it('lists the remembered project folders and removes one', async () => {
    setWorkspaceFolder('C:/Repos/Alpha')
    render(<GeneralOptions api={createMockForgeApi({ projectTree: [], documents: {} })} opts={DEFAULT_OPTIONS.general} onChange={() => undefined} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove folder Alpha' }))
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(getWorkspaceFolders()).not.toContain('C:/Repos/Alpha')
  })

  it('keeps the safety switch on and locked', () => {
    render(<GeneralOptions api={createMockForgeApi({ projectTree: [], documents: {} })} opts={DEFAULT_OPTIONS.general} onChange={() => undefined} />)
    const lock = screen.getByRole('switch', { name: /Confirm deleting/ })
    expect(lock).toBeChecked()
    expect(lock).toBeDisabled()
  })
})
