import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { _resetAppConfigForTests, configGet, configSet } from '../../../src/settings/appConfig'
import { SchemaForm } from '../../../src/core/ui/blocks/SchemaForm'
import { _resetSettingsForTests, readSetting, registerSetting, writeSetting, type SettingSpec } from '../../../src/core/contrib/settings'

const FLAG: SettingSpec = { id: 'x.flag', page: 'x', kind: 'bool', label: 'Flag', default: false, path: ['x', 'flag'] }
const LEVEL: SettingSpec = { id: 'x.level', page: 'x', kind: 'int', label: 'Level', min: 1, max: 5, default: 3, path: ['x', 'level'] }

afterEach(() => {
  _resetSettingsForTests()
  _resetAppConfigForTests()
})

describe('settings register', () => {
  it('reads the default for missing or wrong values and clamps numbers', () => {
    expect(readSetting(FLAG)).toBe(false)
    configSet(['x', 'flag'], 'yes')
    expect(readSetting(FLAG)).toBe(false)
    configSet(['x', 'level'], 99)
    expect(readSetting(LEVEL)).toBe(5)
  })

  it('stores only values that differ from the default', () => {
    writeSetting(FLAG, true)
    expect(configGet('x', 'flag')).toBe(true)
    writeSetting(FLAG, false)
    expect(configGet('x', 'flag')).toBeUndefined()
  })

  it('SchemaForm shows the settings of a page in order and writes a change at once', async () => {
    registerSetting({ ...LEVEL, order: 2 })
    registerSetting({ ...FLAG, order: 1 })
    registerSetting({ id: 'y.other', page: 'y', kind: 'bool', label: 'Other', default: true, path: ['y', 'other'] })
    render(<SchemaForm page="x" />)
    expect(screen.queryByText('Other')).toBeNull()
    expect(screen.getAllByText(/Flag|Level/).map((e) => e.textContent)[0]).toBe('Flag')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Flag' }))
    expect(configGet('x', 'flag')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Reset Flag' }))
    expect(configGet('x', 'flag')).toBeUndefined()
  })
})
