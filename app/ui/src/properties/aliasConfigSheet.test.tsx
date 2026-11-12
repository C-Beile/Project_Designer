import { configGet } from '../settings/appConfig'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AliasConfigPanel } from './AliasConfigPanel'
import { CONFIG_DESCRIPTIONS } from './configDescriptions.generated'
import { setConfigSection } from './configSections'
import type { AliasConfigDto } from '../wire/types'

const config: AliasConfigDto = {
  name: '_____CONFIGURATION',
  type_label: 'config',
  groups: [{ label: 'Other', props: [{ name: 'spellcheckerEnabled', value: 'false', secret: false }, { name: 'neonHttpPort', value: '8080', secret: false }] }],
} as unknown as AliasConfigDto

describe('config descriptions', () => {
  it('come from the Designer for the properties of the system config', () => {
    expect(CONFIG_DESCRIPTIONS.spellcheckerEnabled).toMatch(/spellchecker of the HTML Editor/)
    expect(Object.keys(CONFIG_DESCRIPTIONS).length).toBeGreaterThan(100)
  })
})

describe('AliasConfigPanel sheet', () => {
  beforeEach(() => {
    localStorage.clear()
    setConfigSection('system')
  })
  afterEach(() => setConfigSection('client'))

  it('selects a row and shows its name and description below', async () => {
    const user = userEvent.setup()
    render(<AliasConfigPanel config={config} system="dev1" />)
    const row = screen.getByText('spellcheckerEnabled').closest('.forge-props-row')!
    await user.click(row)
    expect(row).toHaveClass('is-selected')
    const desc = screen.getByLabelText('Description')
    expect(desc).toHaveTextContent('spellcheckerEnabled')
    expect(desc).toHaveTextContent('Specifies if the spellchecker of the HTML Editor should be enabled by default.')
  })

  it('moves the divider with the keyboard, keeps it and resets it', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AliasConfigPanel config={config} system="dev1" splitKey="test" />)
    const handle = screen.getByRole('separator', { name: 'Column divider' })
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    handle.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(handle).toHaveAttribute('aria-valuenow', '54')
    expect(screen.getByLabelText('_____CONFIGURATION properties').style.getPropertyValue('--sheet-split')).toBe('54%')
    unmount()
    render(<AliasConfigPanel config={config} system="dev1" splitKey="test" />)
    expect(screen.getByRole('separator', { name: 'Column divider' })).toHaveAttribute('aria-valuenow', '54')
    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Column divider' }))
    expect(screen.getByRole('separator', { name: 'Column divider' })).toHaveAttribute('aria-valuenow', '50')
  })

  it('keeps the position of the panel and of the tab apart', async () => {
    const user = userEvent.setup()
    render(<AliasConfigPanel config={config} system="dev1" splitKey="a" />)
    screen.getByRole('separator').focus()
    await user.keyboard('{ArrowLeft}')
    expect(configGet('layout', 'sheet_split', 'a')).toBe(48)
    expect(configGet('layout', 'sheet_split', 'b')).toBeUndefined()
  })
})

