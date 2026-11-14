import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createMockForgeApi } from '../support/mockApi'
import { SshKeyPassphrase } from '../../src/shell/SshKeyPassphrase'

const api = () => createMockForgeApi({ projectTree: [], documents: {} })

describe('SshKeyPassphrase', () => {
  it('shows nothing without a key path', () => {
    const { container } = render(<SshKeyPassphrase api={api()} keyPath="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows no passphrase field for a key without one', async () => {
    render(<SshKeyPassphrase api={api()} keyPath="C:/keys/plain.ppk" />)
    expect(await screen.findByText(/has no passphrase/)).toBeInTheDocument()
    expect(screen.queryByLabelText('SSH key passphrase')).toBeNull()
  })

  it('shows the passphrase field for a protected key and stores a correct passphrase', async () => {
    const mock = api()
    render(<SshKeyPassphrase api={mock} keyPath="C:/keys/locked.ppk" />)
    await userEvent.type(await screen.findByLabelText('SSH key passphrase'), 'right')
    expect(await screen.findByText('Passphrase is correct.')).toHaveClass('forge-field-ok')
    await waitFor(() => expect(screen.getByLabelText('SSH key passphrase')).toHaveValue('********'))
    expect(await mock.sshKeyHasPassphrase('C:/keys/locked.ppk')).toBe(true)
  })

  it('forgets the passphrase when the stars are deleted and accepts a new one', async () => {
    const mock = api()
    render(<SshKeyPassphrase api={mock} keyPath="C:/keys/locked.ppk" />)
    const input = await screen.findByLabelText('SSH key passphrase')
    await userEvent.type(input, 'right')
    await waitFor(() => expect(input).toHaveValue('********'))
    await userEvent.clear(input)
    expect(input).toHaveValue('')
    expect(await mock.sshKeyHasPassphrase('C:/keys/locked.ppk')).toBe(false)
    await userEvent.type(input, 'right')
    await waitFor(() => expect(input).toHaveValue('********'))
  })

  it('reports a wrong passphrase and does not store it', async () => {
    const mock = api()
    render(<SshKeyPassphrase api={mock} keyPath="C:/keys/locked.ppk" />)
    await userEvent.type(await screen.findByLabelText('SSH key passphrase'), 'wrong')
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not unlock/)
    expect(await mock.sshKeyHasPassphrase('C:/keys/locked.ppk')).toBe(false)
  })
})
