import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { _resetAppConfigForTests } from '../settings/appConfig'
import { TextAndSizePage } from './TextAndSizePage'
import { UserThemeSection } from './UserThemeSection'

afterEach(() => _resetAppConfigForTests())

describe('Options > Appearance pages', () => {
  it('Text & size holds the interface size, text size, font and density', () => {
    render(<TextAndSizePage />)
    expect(screen.getByLabelText('Interface size')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Text size' })).toBeInTheDocument()
    expect(screen.getByLabelText('Font')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^(?!Reset).*Density/ })).toBeInTheDocument()
  })

  it('the theme page lists no theme of the user at first and opens the studio from a button', () => {
    render(<UserThemeSection />)
    expect(screen.getByText('No theme of yours yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Theme Studio' })).toBeEnabled()
  })
})
