import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../test/mockApi'
import { RestEditor } from './RestEditor'

const webservices = [{ name: 'Person_ws', module: null, methods: ['GET', 'PATCH'], loginTypes: ['internal.default'], fields: 1 }]

describe('RestEditor', () => {
  it('lists only the calls a web service allows and fills the url', async () => {
    const user = userEvent.setup()
    render(<RestEditor api={createMockForgeApi({ projectTree: [], documents: {}, webservices })} projectRoot="C:/p" />)
    await screen.findByTitle('GET /services/rest/Person_ws')
    expect(screen.queryByTitle(/^POST /)).toBeNull()
    expect(screen.queryByTitle(/^DELETE /)).toBeNull()
    await user.click(screen.getByTitle('PATCH /services/rest/Person_ws/{id}'))
    expect(screen.getByLabelText('Request URL')).toHaveValue('/services/rest/Person_ws/{id}')
  })

  it('refuses to send while the id placeholder is open and asks for the password once', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, webservices, restUsers: [{ id: '1', title: 'wsUser' }] })
    const send = vi.spyOn(api, 'restSend').mockRejectedValue('PASSWORD_REQUIRED')
    render(<RestEditor api={api} projectRoot="C:/p" />)
    await user.click(await screen.findByTitle('GET /services/rest/Person_ws'))
    await user.type(screen.getByLabelText('Server URL'), 'http://localhost:8080')
    await waitFor(() => expect(screen.getByLabelText('Request URL')).toHaveValue('http://localhost:8080/services/rest/Person_ws'))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No password saved for wsUser/)
    expect(send).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('shows status, time and the coloured body of the answer', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, webservices, restResponse: { status: 200, reason: 'OK', headers: [['content-type', 'application/json']], body: '{"NAME":"A"}', elapsedMs: 12, size: 12, sent: '' } })
    render(<RestEditor api={api} projectRoot="C:/p" />)
    await user.click(await screen.findByTitle('GET /services/rest/Person_ws'))
    await user.type(screen.getByLabelText('Server URL'), 'http://localhost:8080')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('200 OK')).toBeInTheDocument()
    expect(screen.getByLabelText('Response body').querySelector('.j-key')?.textContent).toBe('"NAME"')
  })

  it('changes a saved password through the three dots and offers it after a 401', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({
      projectTree: [],
      documents: {},
      webservices,
      restUsers: [{ id: '1', title: 'wsUser' }],
      restHasPassword: true,
      restResponse: { status: 401, reason: 'Unauthorized', headers: [['www-authenticate', 'Basic realm="ADITO"']], body: '', elapsedMs: 3, size: 0, sent: '' },
    })
    const save = vi.spyOn(api, 'restSavePassword')
    render(<RestEditor api={api} projectRoot="C:/p" />)
    await user.click(await screen.findByTitle('GET /services/rest/Person_ws'))
    await user.type(screen.getByLabelText('Server URL'), 'http://localhost:8080')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/rejected the login of wsUser/)).toHaveTextContent('Basic realm="ADITO"')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await user.type(screen.getByLabelText('New password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(save).toHaveBeenCalledWith('http://localhost:8080', 'wsUser', 'secret')
    await user.click(await screen.findByRole('button', { name: 'Password options' }))
    expect(screen.getByRole('menuitem', { name: 'Change password' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Forget password' })).toBeInTheDocument()
  })

  it('offers the servers named after the server config files and fills the first one in', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, webservices, restServers: [{ host: 'hermes-mig.test.htc1.adito.cloud', systems: ['test_mig', 'test_mig_bg'] }] })
    render(<RestEditor api={api} projectRoot="C:/p" />)
    await waitFor(() => expect(screen.getByLabelText('Server URL')).toHaveValue('https://hermes-mig.test.htc1.adito.cloud/services/rest'))
    await user.click(await screen.findByTitle('GET /services/rest/Person_ws'))
    expect(screen.getByLabelText('Request URL')).toHaveValue('https://hermes-mig.test.htc1.adito.cloud/services/rest/Person_ws')
    expect(screen.getByRole('button', { name: 'test_mig, test_mig_bg' })).toBeInTheDocument()
  })
})
