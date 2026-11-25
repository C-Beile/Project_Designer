import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../support/mockApi'
import { RestEditor } from '../../src/services/RestEditor'

const confirm = vi.hoisted(() => vi.fn(async () => false))

vi.mock('../../src/core/dialogService', async (original) => ({ ...(await original<typeof import('../../src/core/dialogService')>()), confirmDialog: confirm }))

const webservices = [
  { name: 'Person_ws', module: null, methods: ['GET'], loginTypes: ['internal.default'], fields: 1, kind: 'entity', params: [] },
  {
    name: 'Orders_c_ws',
    module: null,
    methods: ['GET', 'POST'],
    loginTypes: [],
    fields: 0,
    kind: 'custom',
    accepts: 'application/json',
    delivers: 'application/json',
    params: [
      { name: 'fromDate', kind: 'Number', mandatory: false },
      { name: 'id', kind: 'String', mandatory: true },
    ],
  },
]

const ok = { status: 200, reason: 'OK', headers: [['content-type', 'application/json']] as [string, string][], body: '[{"a":1},{"a":2}]', elapsedMs: 7, size: 18, sent: 'GET /x' }

describe('RestEditor with custom web services', () => {
  beforeEach(() => confirm.mockClear())

  it('lists a custom web service next to the entity ones, with calls that carry no record id', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RestEditor api={createMockForgeApi({ projectTree: [], documents: {}, webservices })} projectRoot="C:/p" />)
    await screen.findByTitle('GET /services/rest/Orders_c_ws')
    expect(screen.getByTitle('POST /services/rest/Orders_c_ws')).toBeInTheDocument()
    expect(screen.queryByTitle('GET /services/rest/Orders_c_ws/{id}')).toBeNull()
    await user.click(screen.getByTitle('POST /services/rest/Orders_c_ws'))
    expect(screen.getByLabelText('Request URL')).toHaveValue('/services/rest/Orders_c_ws')
    expect(screen.getByText(/custom web service, allows/)).toBeInTheDocument()
  })

  it('filters by kind and shows the counts', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RestEditor api={createMockForgeApi({ projectTree: [], documents: {}, webservices })} projectRoot="C:/p" />)
    await screen.findByTitle('GET /services/rest/Orders_c_ws')
    const kinds = screen.getByRole('group', { name: 'Kind of web service' })
    expect(within(kinds).getByRole('button', { name: /All 2/ })).toBeInTheDocument()
    await user.click(within(kinds).getByRole('button', { name: /Custom 1/ }))
    expect(screen.queryByTitle('GET /services/rest/Person_ws')).toBeNull()
    expect(screen.getByTitle('GET /services/rest/Orders_c_ws')).toBeInTheDocument()
    await user.click(within(kinds).getByRole('button', { name: /Entity 1/ }))
    expect(screen.queryByTitle('GET /services/rest/Orders_c_ws')).toBeNull()
    expect(screen.getByTitle('GET /services/rest/Person_ws')).toBeInTheDocument()
  })

  it('offers the parameters found in the script as chips and marks the required one', async () => {
    const user = userEvent.setup({ delay: null })
    render(<RestEditor api={createMockForgeApi({ projectTree: [], documents: {}, webservices })} projectRoot="C:/p" />)
    await user.click(await screen.findByTitle('GET /services/rest/Orders_c_ws'))
    const chip = screen.getByRole('button', { name: /\+ fromDate/ })
    expect(chip).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+ id/ })).toHaveClass('is-required')
    expect(screen.queryByRole('button', { name: /\+ startrow/ })).toBeNull()
    await user.click(chip)
    expect(screen.getByLabelText('Request URL').getAttribute('value') ?? (screen.getByLabelText('Request URL') as HTMLInputElement).value).toContain('?fromDate=')
  })

  it('keeps the calls that were sent and loads one again from the history', async () => {
    const user = userEvent.setup({ delay: null })
    const api = createMockForgeApi({ projectTree: [], documents: {}, webservices, restResponse: ok })
    render(<RestEditor api={api} projectRoot="C:/p" />)
    await user.click(await screen.findByTitle('GET /services/rest/Orders_c_ws'))
    await user.type(screen.getByLabelText('Server URL'), 'http://localhost:8080')
    await user.click(screen.getByRole('button', { name: /\+ fromDate/ }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Array · 2 items')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /History/ }))
    const entry = await screen.findByTitle('http://localhost:8080/services/rest/Orders_c_ws?fromDate=')
    expect(entry).toHaveTextContent('GET')
    expect(entry).toHaveTextContent('200')
    await user.click(screen.getByRole('tab', { name: /Services/ }))
    await user.click(screen.getByTitle('POST /services/rest/Orders_c_ws'))
    expect(screen.getByLabelText('Request URL')).toHaveValue('http://localhost:8080/services/rest/Orders_c_ws')
    await user.click(screen.getByRole('tab', { name: /History/ }))
    await user.click(await screen.findByTitle('http://localhost:8080/services/rest/Orders_c_ws?fromDate='))
    expect(screen.getByLabelText('Request URL')).toHaveValue('http://localhost:8080/services/rest/Orders_c_ws?fromDate=')
  })

  it('asks before a call that writes on a production server and sends nothing when declined', async () => {
    const user = userEvent.setup({ delay: null })
    const api = createMockForgeApi({ projectTree: [], documents: {}, webservices, restResponse: ok, restServers: [{ host: 'shop-prod.example.cloud', systems: ['prod', 'prod_bg'] }] })
    const send = vi.spyOn(api, 'restSend')
    render(<RestEditor api={api} projectRoot="C:/p" />)
    await waitFor(() => expect(screen.getByLabelText('Server URL')).toHaveValue('https://shop-prod.example.cloud/services/rest'))
    expect(screen.getByRole('note')).toHaveTextContent(/Production server/)
    await user.click(await screen.findByTitle('POST /services/rest/Orders_c_ws'))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(send).not.toHaveBeenCalled()
    await user.click(await screen.findByTitle('GET /services/rest/Orders_c_ws'))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
