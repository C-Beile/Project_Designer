import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectDatabaseConnectionDialog, shortHost } from './SelectDatabaseConnectionDialog'

const CONNECTIONS = [
  { alias: 'Data_alias', host: 'adito-db.dev-fz-juelich-1-htc1-adito-cloud.svc.cluster.local', port: 3306, database: 'cloud_data_alias', reachable: true },
  { alias: 'TextAnalysis', host: 'lucene.de-adito-global-services.svc.cluster.local', port: 3306, database: 'lucene', reachable: false },
]

describe('SelectDatabaseConnectionDialog', () => {
  it('shortens a host to something readable', () => {
    expect(shortHost('adito-db.dev-fz-juelich-1-htc1-adito-cloud.svc.cluster.local')).toBe('adito-db.dev-fz-juelich-1')
  })

  it('selects the connection of the owning alias, shows its full URL and hands the choice back', async () => {
    const user = userEvent.setup()
    const onOk = vi.fn()
    render(<SelectDatabaseConnectionDialog connections={CONNECTIONS} preferredAlias="Data_alias" title="Which database?" onOk={onOk} onCancel={() => {}} />)
    expect(screen.getByLabelText('Connection URL')).toHaveTextContent('jdbc:mariadb://adito-db.dev-fz-juelich-1-htc1-adito-cloud.svc.cluster.local:3306/cloud_data_alias')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onOk).toHaveBeenCalledWith({ connection: CONNECTIONS[0], useDist: false })
  })

  it('lists the connections without an open tunnel only on request', async () => {
    const user = userEvent.setup()
    render(<SelectDatabaseConnectionDialog connections={CONNECTIONS} preferredAlias="Data_alias" title="Which database?" onOk={() => {}} onCancel={() => {}} />)
    await user.click(screen.getByRole('checkbox', { name: /Show all connections/ }))
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: /TextAnalysis.*\(no tunnel\)/ })).toBeInTheDocument()
  })

  it('transpiles on request and then runs from the transpiled directory', async () => {
    const user = userEvent.setup()
    const onOk = vi.fn()
    const onTranspile = vi.fn().mockResolvedValue(true)
    render(<SelectDatabaseConnectionDialog connections={CONNECTIONS} preferredAlias="Data_alias" title="Which database?" onOk={onOk} onCancel={() => {}} onTranspile={onTranspile} />)
    await user.click(screen.getByRole('button', { name: 'Partial Transpile' }))
    await screen.findByRole('button', { name: 'Partial Transpile (done)' })
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onTranspile).toHaveBeenCalledTimes(1)
    expect(onOk).toHaveBeenCalledWith({ connection: CONNECTIONS[0], useDist: true })
  })
})
