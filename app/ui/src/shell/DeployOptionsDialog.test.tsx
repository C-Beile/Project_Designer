import { systemKey } from '../services/tunnelState'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeployOptionsDialog, systemWarning, type DeployOptionsPayload } from './DeployOptionsDialog'
import { createMockForgeApi } from '../test/mockApi'

const payload: DeployOptionsPayload = {
  projects: ['C:/p/FZ'],
  project: 'C:/p/FZ',
  systems: [
    { name: 'dev1', tunnelRef: '$PROJECTHOME/others/t.xml', serverRef: '$PROJECTHOME/others/s.xml', productive: false, cloud: false },
    { name: 'prod', tunnelRef: '$PROJECTHOME/others/t2.xml', serverRef: '$PROJECTHOME/others/s2.xml', productive: false, cloud: true },
  ],
  defaultSystem: 'dev1',
  connectedSystem: null,
  buildFirst: true,
  checkScan: true,
}

function setup(over: Partial<DeployOptionsPayload> = {}) {
  const api = createMockForgeApi({ projectTree: [], documents: {} })
  const onOk = vi.fn()
  const onCancel = vi.fn()
  render(<DeployOptionsDialog api={api} payload={{ ...payload, ...over }} onOk={onOk} onCancel={onCancel} />)
  return { api, onOk, onCancel }
}

describe('DeployOptionsDialog', () => {
  beforeEach(() => localStorage.clear())

  it('shows the fields of the original dialog and blocks OK until the tunnel to the system stands', async () => {
    setup()
    expect(screen.getByLabelText('Project')).toBeInTheDocument()
    expect(screen.getByLabelText('System')).toHaveValue('dev1')
    expect(screen.getByText('Check Scan Services (Errors, Warnings)')).toBeInTheDocument()
    expect(screen.getByText('Force deploy')).toBeInTheDocument()
    expect(screen.getByText('Deploy Userhelp')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('The tunnel to dev1 is not open.')
  })

  it('Open tunnel connects and then OK hands over the choices, never writing anything itself', async () => {
    const user = userEvent.setup()
    const { api, onOk } = setup()
    const connect = vi.spyOn(api, 'dbConnect')
    await user.click(screen.getByRole('button', { name: 'Open tunnel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled())
    expect(connect).toHaveBeenCalledTimes(1)
    await user.click(screen.getByLabelText('Force deploy'))
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onOk).toHaveBeenCalledWith({ project: 'C:/p/FZ', system: 'dev1', checkScan: true, force: true, userhelp: false, build: true, connectedSystem: systemKey('C:/p/FZ', 'dev1') })
  })

  it('transpiles first by default, even for a plain Deploy, and draws OK as the primary button', async () => {
    setup({ buildFirst: false })
    expect(screen.getByRole('dialog', { name: 'Deploy' })).toBeInTheDocument()
    expect(screen.getByLabelText('Build (transpile) before the deploy')).toBeChecked()
    expect(screen.getByRole('button', { name: 'OK' })).toHaveClass('is-primary')
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveClass('is-primary')
    expect(screen.getByRole('group', { name: 'Steps' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Options' })).toBeInTheDocument()
  })

  it('an open tunnel of another system does not count', async () => {
    setup({ connectedSystem: 'qs' })
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
  })

  it('warns for productive and cloud systems and can be cancelled', async () => {
    const user = userEvent.setup()
    const { onCancel } = setup({ connectedSystem: systemKey('C:/p/FZ', 'prod') })
    await user.selectOptions(screen.getByLabelText('System'), 'prod')
    expect(screen.getByRole('alert')).toHaveTextContent(/productive system/)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('names the reason of the warning', () => {
    expect(systemWarning({ name: 'dev1', tunnelRef: '', serverRef: '', productive: true, cloud: false })).toMatch(/productive/)
    expect(systemWarning({ name: 'dev1', tunnelRef: '', serverRef: '', productive: false, cloud: true })).toBeNull()
    expect(systemWarning({ name: 'dev1', tunnelRef: '', serverRef: '', productive: false, cloud: false })).toBeNull()
  })
})

describe('systems follow the chosen project', () => {
  it('switching the project shows the systems of that project', async () => {
    const user = userEvent.setup()
    setup({
      projects: ['C:/p/FZ', 'C:/p/FFG'],
      systemsByProject: {
        'C:/p/FZ': { systems: payload.systems, defaultSystem: 'dev1' },
        'C:/p/FFG': { systems: [{ name: 'dev3', tunnelRef: '', serverRef: '', productive: false, cloud: false }], defaultSystem: 'dev3' },
      },
    })
    await user.selectOptions(screen.getByLabelText('Project'), 'C:/p/FFG')
    expect((screen.getByLabelText('System') as HTMLSelectElement).value).toBe('dev3')
    expect(screen.queryByRole('option', { name: 'dev1' })).toBeNull()
  })
})
