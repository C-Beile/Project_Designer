import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceDialog } from './WorkspaceDialog'
import { setWorkspaceFolder } from '../settings/workspaceFolder'
import { createMockForgeApi } from '../test/mockApi'

const found = [
  { name: 'Hermes', path: 'C:/Repos/Hermes' },
  { name: 'Pichler', path: 'C:/Repos/Pichler' },
  { name: 'SVB', path: 'C:/Repos/SVB' },
]

beforeEach(() => setWorkspaceFolder('C:/Repos'))

describe('WorkspaceDialog', () => {
  it('lists the projects of the folder, starts with the open ones ticked and opens and closes the difference', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, foundProjects: found })
    const onApply = vi.fn()
    render(<WorkspaceDialog api={api} openProjects={['C:/Repos/Hermes']} onApply={onApply} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText(/Pichler/)).toBeInTheDocument())
    expect(screen.getByLabelText(/Hermes/)).toBeChecked()
    expect(screen.getByLabelText(/Pichler/)).not.toBeChecked()
    expect(screen.getByText('1 of 3 shown in the tree')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText(/Pichler/))
    await userEvent.click(screen.getByLabelText(/Hermes/))
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onApply).toHaveBeenCalledWith(['C:/Repos/Pichler'], ['C:/Repos/Hermes'], 'C:/Repos')
  })

  it('filters the list', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, foundProjects: found })
    render(<WorkspaceDialog api={api} openProjects={[]} onApply={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText(/SVB/)).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Filter projects'), 'pich')
    expect(screen.queryByLabelText(/SVB/)).toBeNull()
    expect(screen.getByLabelText(/Pichler/)).toBeInTheDocument()
  })
})
