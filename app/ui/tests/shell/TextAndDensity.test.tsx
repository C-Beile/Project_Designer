import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { _resetAppConfigForTests, configGet } from '../../src/settings/appConfig'
import { installAppearance } from '../../src/theme/appearance'
import { TextAndDensity } from '../../src/shell/TextAndDensity'

afterEach(() => {
  _resetAppConfigForTests()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-density')
})

describe('TextAndDensity', () => {
  it('applies a new text size at once and stores it', async () => {
    const user = userEvent.setup({ delay: null })
    const stop = installAppearance()
    render(<TextAndDensity />)
    screen.getByRole('slider').focus()
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(configGet<number>('appearance', 'fontSize')).toBe(15)
    expect(document.documentElement.style.fontSize).toBe('20px')
    stop()
  })

  it('switches to compact density and back, storing only the non-default', async () => {
    const user = userEvent.setup({ delay: null })
    const stop = installAppearance()
    render(<TextAndDensity />)
    await user.click(screen.getByRole('button', { name: /^(?!Reset).*Density/ }))
    await user.click(screen.getByRole('option', { name: 'Compact' }))
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
    expect(configGet<string>('appearance', 'density')).toBe('compact')
    await user.click(screen.getByRole('button', { name: /^(?!Reset).*Density/ }))
    await user.click(screen.getByRole('option', { name: 'Normal' }))
    expect(document.documentElement.hasAttribute('data-density')).toBe(false)
    expect(configGet<string>('appearance', 'density')).toBeUndefined()
    stop()
  })

  it('resets the size to the default', async () => {
    const user = userEvent.setup({ delay: null })
    const stop = installAppearance()
    render(<TextAndDensity />)
    screen.getByRole('slider').focus()
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}')
    await user.click(screen.getByRole('button', { name: 'Reset Text size' }))
    expect(document.documentElement.style.fontSize).toBe('16px')
    expect(configGet<number>('appearance', 'fontSize')).toBeUndefined()
    stop()
  })

  it('stores a font family typed into the field', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TextAndDensity />)
    await user.type(screen.getByLabelText('Font'), 'Inter')
    expect(configGet<string>('appearance', 'fontFamily')).toBe('Inter')
  })
})
