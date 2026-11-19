import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AliasConfigPanel } from '../../src/properties/AliasConfigPanel'
import { setConfigSection } from '../../src/properties/configSections'
import { emptyLogin, loginNames, parseLoginList, propertiesSummary, serializeLoginList, validateLoginProperties, validateLogins } from '../../src/properties/loginList'
import type { AliasConfigDto } from '../../src/wire/types'

const LOGINS = [{ name: 'THHIT_EntraScimToken', loginType: 'oauth2-token', title: '', description: '', properties: [{ key: 'alias', value: 'THHIT_EntraProvisioning_alias' }] }]

const config = {
  name: '_____CONFIGURATION',
  type_label: 'config',
  groups: [{ label: 'Other', props: [{ name: 'loginList', value: JSON.stringify(LOGINS), secret: false }, { name: 'clientTimeout', value: '1D', secret: false }] }],
} as unknown as AliasConfigDto

describe('login list values', () => {
  it('reads what the backend delivers and writes it back the same way', () => {
    const entries = parseLoginList(JSON.stringify(LOGINS))
    expect(entries).toEqual(LOGINS)
    expect(parseLoginList(serializeLoginList(entries))).toEqual(entries)
    expect(serializeLoginList([])).toBe('')
    expect(parseLoginList('not json')).toEqual([])
    expect(parseLoginList('')).toEqual([])
  })

  it('shows the names, and the properties as a short summary', () => {
    expect(loginNames([...LOGINS, { ...LOGINS[0], name: 'Second' }])).toBe('THHIT_EntraScimToken | Second')
    expect(propertiesSummary(LOGINS[0].properties)).toBe('{alias=THHIT_EntraProvisioning_alias}')
    expect(propertiesSummary([])).toBe('')
  })

  it('rejects an empty, reserved or doubled name and a doubled key', () => {
    expect(validateLogins([{ ...LOGINS[0], name: '  ' }])).toBe('Name must not be an empty String.')
    expect(validateLogins([{ ...LOGINS[0], name: 'Internal.Default' }])).toMatch(/reserved/)
    expect(validateLogins([LOGINS[0], { ...LOGINS[0], name: 'thhit_entrascimtoken' }])).toMatch(/used twice/)
    expect(validateLogins(LOGINS)).toBeNull()
    expect(validateLoginProperties([{ key: 'alias', value: '' }, { key: 'alias', value: '' }])).toMatch(/used twice/)
    expect(validateLoginProperties([{ key: '', value: 'x' }])).toMatch(/needs a key/)
  })

  it('names a new login so that it does not clash', () => {
    expect(emptyLogin([]).name).toBe('login1')
    expect(emptyLogin([{ ...LOGINS[0], name: 'login2' }]).name).toBe('login3')
  })
})

describe('login list in the config sheet', () => {
  beforeEach(() => setConfigSection('client'))
  afterEach(() => setConfigSection('client'))

  it('shows the names of the logins in the row', () => {
    render(<AliasConfigPanel config={config} system="dev2" editable />)
    expect(screen.getByText('THHIT_EntraScimToken')).toBeInTheDocument()
  })

  it('opens the Login window with the columns of the Designer and the nested properties window', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AliasConfigPanel config={config} system="dev2" editable />)
    await user.click(screen.getByRole('button', { name: 'Edit loginList' }))
    const login = screen.getByRole('dialog', { name: 'Login' })
    for (const column of ['Name', 'Type', 'Title', 'Description', 'Properties']) expect(within(login).getByRole('columnheader', { name: column })).toBeInTheDocument()
    expect(within(login).getByLabelText('Name')).toHaveValue('THHIT_EntraScimToken')
    expect(within(login).getByText('{alias=THHIT_EntraProvisioning_alias}')).toBeInTheDocument()
    await user.click(within(login).getByRole('button', { name: 'Properties of THHIT_EntraScimToken' }))
    const props = screen.getByRole('dialog', { name: 'oauth2-token Properties' })
    expect(within(props).getByLabelText('Value')).toHaveValue('THHIT_EntraProvisioning_alias')
    await user.click(within(props).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'oauth2-token Properties' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Login' })).toBeInTheDocument()
  })

  it('keeps a changed property and a new login as a draft after OK, and drops them on Cancel', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AliasConfigPanel config={config} system="dev2" editable />)
    await user.click(screen.getByRole('button', { name: 'Edit loginList' }))
    let login = screen.getByRole('dialog', { name: 'Login' })
    await user.click(within(login).getByRole('button', { name: 'Properties of THHIT_EntraScimToken' }))
    const props = screen.getByRole('dialog', { name: 'oauth2-token Properties' })
    const value = within(props).getByLabelText('Value')
    await user.clear(value)
    await user.type(value, 'Other_alias')
    await user.click(within(props).getByRole('button', { name: 'OK' }))
    expect(within(login).getByText('{alias=Other_alias}')).toBeInTheDocument()
    await user.click(within(login).getByRole('button', { name: 'Add entry' }))
    expect(within(login).getAllByLabelText('Name')).toHaveLength(2)
    await user.click(within(login).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('dialog', { name: 'Login' })).toBeNull()
    expect(screen.getByText('THHIT_EntraScimToken | login2')).toBeInTheDocument()
    expect(screen.getByText(/Draft: 1 change/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit loginList' }))
    login = screen.getByRole('dialog', { name: 'Login' })
    await user.click(within(login).getByRole('button', { name: 'Remove entry' }))
    await user.click(within(login).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('THHIT_EntraScimToken | login2')).toBeInTheDocument()
  })

  it('refuses OK while a name is empty and says why', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AliasConfigPanel config={config} system="dev2" editable />)
    await user.click(screen.getByRole('button', { name: 'Edit loginList' }))
    const login = screen.getByRole('dialog', { name: 'Login' })
    await user.clear(within(login).getByLabelText('Name'))
    await user.click(within(login).getByRole('button', { name: 'OK' }))
    expect(within(login).getByRole('alert')).toHaveTextContent('Name must not be an empty String.')
    expect(screen.getByRole('dialog', { name: 'Login' })).toBeInTheDocument()
  })

  it('moves a login up and down', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AliasConfigPanel config={config} system="dev2" editable />)
    await user.click(screen.getByRole('button', { name: 'Edit loginList' }))
    const login = screen.getByRole('dialog', { name: 'Login' })
    await user.click(within(login).getByRole('button', { name: 'Add entry' }))
    await user.click(within(login).getByRole('button', { name: 'Move up' }))
    expect(within(login).getAllByLabelText('Name').map((i) => (i as HTMLInputElement).value)).toEqual(['login2', 'THHIT_EntraScimToken'])
    await user.click(within(login).getByRole('button', { name: 'Move down' }))
    expect(within(login).getAllByLabelText('Name').map((i) => (i as HTMLInputElement).value)).toEqual(['THHIT_EntraScimToken', 'login2'])
  })

  it('only shows the logins where the config is read-only', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AliasConfigPanel config={config} system="dev2" />)
    await user.click(screen.getByRole('button', { name: 'Edit loginList' }))
    const login = screen.getByRole('dialog', { name: 'Login' })
    expect(within(login).queryByRole('button', { name: 'Add entry' })).toBeNull()
    expect(within(login).getByLabelText('Name')).toHaveAttribute('readonly')
    await user.click(within(login).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Login' })).toBeNull()
  })
})
