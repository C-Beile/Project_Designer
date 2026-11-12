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
    const api = createMockForgeApi({ projectTree: [], documents: {}, webservices, restResponse: { status: 200, reason: 'OK', headers: [['content-type', 'application/json']], body: '{"NAME":"A"}', elapsedMs: 12, size: 12 } })
    render(<RestEditor api={api} projectRoot="C:/p" />)
    await user.click(await screen.findByTitle('GET /services/rest/Person_ws'))
    await user.type(screen.getByLabelText('Server URL'), 'http://localhost:8080')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('200 OK')).toBeInTheDocument()
    expect(screen.getByLabelText('Response body').querySelector('.j-key')?.textContent).toBe('"NAME"')
  })
})
