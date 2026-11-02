import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AliasConfigPanel } from './AliasConfigPanel'
import { ConfigNavigator } from '../navigator/ConfigNavigator'
import { isConfigurationAlias, sectionSheet, setConfigSection } from './configSections'
import type { AliasConfigDto } from '../wire/types'

const config: AliasConfigDto = {
  name: '_____CONFIGURATION',
  type_label: 'Configuration',
  icon: 'gear',
  jdbc_url: null,
  groups: [
    {
      label: 'Other',
      props: [
        { name: 'neonVaadinClientEnabled', value: 'true', secret: false },
        { name: 'neonIdleTimeout', value: '45M', secret: false },
        { name: 'clientLogoFile', value: '/opt/clientLogo', secret: false },
        { name: 'someNewProperty', value: 'x', secret: false },
        { name: 'apiGatewayToken', value: '', secret: true },
      ],
    },
  ],
}

afterEach(() => setConfigSection('client'))

describe('config sections', () => {
  it('the Client section shows its groups with set values and unset names', () => {
    const { groups } = sectionSheet(config, 'client')
    expect(groups.map((g) => g.label)).toEqual(['Neon', 'Client', 'Login'])
    const idle = groups[0].rows.find((r) => r.name === 'neonIdleTimeout')!
    expect(idle).toMatchObject({ value: '45M', set: true })
    expect(groups[1].rows.find((r) => r.name === 'clientTitleText')).toMatchObject({ set: false, value: '' })
    expect(groups[0].rows.find((r) => r.name === 'neonVaadinClientEnabled')!.kind).toBe('checkbox')
  })

  it('the System section lists properties that no section claims under Other', () => {
    const { groups } = sectionSheet(config, 'system')
    const other = groups.find((g) => g.label === 'Other')!
    expect(other.rows.map((r) => r.name)).toEqual(['someNewProperty'])
  })

  it('recognises the config alias by name', () => {
    expect(isConfigurationAlias('_____CONFIGURATION')).toBe(true)
    expect(isConfigurationAlias('Data_alias')).toBe(false)
  })

  it('the Navigator selection decides what the panel shows', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ConfigNavigator />
        <AliasConfigPanel config={config} system="dev1" editable />
      </>,
    )
    expect(screen.getByLabelText('neonIdleTimeout')).toHaveValue('45M')
    expect(screen.getByLabelText('neonVaadinClientEnabled')).toBeChecked()
    await user.click(screen.getByRole('treeitem', { name: 'Nova Communication' }))
    expect(screen.getByText(/not known yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText('neonIdleTimeout')).toBeNull()
    await user.click(screen.getByRole('treeitem', { name: 'Client' }))
    expect(screen.getByLabelText('clientLogoFile')).toHaveValue('/opt/clientLogo')
  })
})

describe('sections from the original screenshots', () => {
  it('every section of the original with known content is defined, only the unseen ones are not', () => {
    for (const id of ['client', 'system', 'modules', 'database', 'calendar', 'notifications', 'logging', 'prefs', 'configuration']) expect(sectionSheet(config, id).defined).toBe(true)
    for (const id of ['nova', 'nats', 'jwt']) expect(sectionSheet(config, id).defined).toBe(false)
  })

  it('Modules, Logging and Calendar carry the groups of the original', () => {
    expect(sectionSheet(config, 'modules').groups.map((g) => g.label)).toEqual(['MSTeams', 'Indexsearch', 'Email', 'Business process management', 'Telephony', 'Monitoring', 'Telemetry', 'Analytics', 'Server Control'])
    expect(sectionSheet(config, 'logging').groups.map((g) => g.label)).toEqual(['Logging', 'Console', 'File', 'Telnet', 'Remote'])
    expect(sectionSheet(config, 'calendar').groups.map((g) => g.label)).toEqual(['Calendar', 'Calendar Cache', 'Calendar Subscription', 'Calendar Sync'])
    const combo = sectionSheet(config, 'logging').groups[0].rows.find((r) => r.name === 'loggingDebugLevel')!
    expect(combo.kind).toBe('combo')
  })

  it('the Custom sections list their keys under Others and mask the secrets', () => {
    const { groups } = sectionSheet(config, 'configuration')
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Others')
    expect(groups[0].rows.find((r) => r.name === 'sign8.secret')!.secret).toBe(true)
    expect(groups[0].rows.find((r) => r.name === 'snapADDY.isEnabled')!.kind).toBe('checkbox')
    expect(groups[0].rows.length).toBeGreaterThan(30)
  })
})
