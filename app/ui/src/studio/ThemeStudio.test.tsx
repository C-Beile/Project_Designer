import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogHost, _resetDialogsForTests } from '../core/dialogService'
import { _resetAppConfigForTests, configGet } from '../settings/appConfig'
import { _resetThemeStoreForTests, loadUserThemes } from '../theme/themeStore'
import { createMockForgeApi } from '../test/mockApi'
import { ThemeStudio } from './ThemeStudio'
import { _resetEditorThemeForTests, getActiveEditorTheme } from '../theme/editorTheme'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const mine = `[theme]
name = "Mine"
id = "mine"
kind = "light"

[surface]
base = "#fafafa"

[text]
primary = "#101010"
`

function setup(userThemes = [{ file: 'mine.theme.toml', text: mine }]) {
  const api = createMockForgeApi({ projectTree: [], documents: {}, userThemes })
  const onClose = () => {}
  const view = render(
    <>
      <ThemeStudio api={api} onClose={onClose} />
      <DialogHost />
    </>,
  )
  return { api, ...view }
}

beforeEach(async () => {
  _resetAppConfigForTests()
  _resetDialogsForTests()
  _resetThemeStoreForTests()
  await loadUserThemes(createMockForgeApi({ projectTree: [], documents: {}, userThemes: [{ file: 'mine.theme.toml', text: mine }] }))
})

afterEach(() => {
  _resetEditorThemeForTests()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
})

async function pickTheme(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.click(screen.getByRole('button', { name: /Theme/ }))
  await user.click(await screen.findByRole('option', { name }))
}

describe('Theme Studio', () => {
  it('starts on Lion with its colours in the editor and on the page', () => {
    setup()
    expect(screen.getByLabelText('surface.base')).toHaveValue('#2b2b2b')
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#2b2b2b')
  })

  it('applies a changed colour to the page at once', () => {
    setup()
    fireEvent.change(screen.getByLabelText('accent.primary'), { target: { value: '#ff0000' } })
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ff0000')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('does not show the TOML text', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'TOML' })).toBeNull()
    expect(screen.queryByLabelText('Theme file (TOML)')).toBeNull()
  })

  it('reports a theme file that cannot be read', async () => {
    const user = userEvent.setup()
    _resetThemeStoreForTests()
    await loadUserThemes(createMockForgeApi({ projectTree: [], documents: {}, userThemes: [{ file: 'broken.theme.toml', text: mine.replace('kind = "light"', 'kind = "sepia"') }] }))
    setup([{ file: 'broken.theme.toml', text: mine.replace('kind = "light"', 'kind = "sepia"') }])
    await pickTheme(user, /broken/)
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be read/)
  })

  it('saves a built-in theme only as a copy with a new name', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await user.click(screen.getByRole('button', { name: 'Save as copy…' }))
    const dialog = await screen.findByRole('dialog', { name: /Save theme as/ })
    const field = within(dialog).getByRole('textbox')
    await user.clear(field)
    await user.type(field, 'Night Lion')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await api.userThemes()).map((t) => t.file)).toContain('night-lion.theme.toml'))
    const saved = (await api.userThemes()).find((t) => t.file === 'night-lion.theme.toml')!
    expect(saved.text).toContain('name = "Night Lion"')
    expect(saved.text).toContain('id = "night-lion"')
  })

})

describe('Theme Studio with themes of the user', () => {
  it('offers a theme of the user, previews it and saves edits in place', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await pickTheme(user, 'Mine (yours)')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#fafafa')
    fireEvent.change(screen.getByLabelText('surface.base'), { target: { value: '#eeeeee' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await api.userThemes())[0].text).toContain('base = "#eeeeee"'))
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull())
  })

  it('uses a theme of the user as the active one', async () => {
    const user = userEvent.setup()
    setup()
    await pickTheme(user, 'Mine (yours)')
    await user.click(screen.getByRole('button', { name: 'Use as my theme' }))
    expect(configGet<string>('appearance', 'userTheme')).toBe('mine.theme.toml')
  })

  it('deletes a theme of the user after asking', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await pickTheme(user, 'Mine (yours)')
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(await screen.findByRole('dialog', { name: /Delete theme/ })).getByRole('button', { name: 'Delete' }))
    await waitFor(async () => expect(await api.userThemes()).toEqual([]))
  })

  it('reads the folder again with Reload', async () => {
    const user = userEvent.setup()
    const { api } = setup()
    await api.saveUserTheme('second.theme.toml', mine.replace('"Mine"', '"Second"'))
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    await pickTheme(user, 'Second (yours)')
    expect(screen.getByLabelText('surface.base')).toHaveValue('#fafafa')
  })

})

describe('Theme Studio built-in themes and closing', () => {
  it('edits the built-in Dark and Light themes like Lion, saving only as a copy', async () => {
    const user = userEvent.setup()
    setup()
    await pickTheme(user, 'Light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(screen.getByLabelText('surface.base')).toBeEnabled()
    expect(screen.getByLabelText('surface.base')).toHaveValue('#fbfbfb')
    expect(screen.getByRole('button', { name: 'Save as copy…' })).toBeEnabled()
  })

  it('puts the previous theme back when it closes', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { unmount } = setup()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    unmount()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('')
  })
})

describe('Theme Studio code colours', () => {
  it('has an Interface and a Code view and opens the Code preview with the Code view', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getByLabelText('surface.base')).toBeInTheDocument()
    expect(screen.queryByLabelText('editor.syntax.keyword')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Code' }))
    expect(screen.getByLabelText('editor.syntax.keyword')).toHaveValue('#569cd6')
    expect(screen.getByLabelText('editor.background')).toHaveValue('#2b2b2b')
    expect(screen.getByRole('tab', { name: 'Code', selected: true })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Interface' }))
    expect(screen.getByRole('tab', { name: 'Colours', selected: true })).toBeInTheDocument()
  })

  it('hands a changed code colour to the editors at once', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Code' }))
    fireEvent.change(screen.getByLabelText('editor.syntax.keyword'), { target: { value: '#ff00ff' } })
    expect(getActiveEditorTheme()?.syntax.keyword.color).toBe('#ff00ff')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('shows the code samples on the Code tab', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Code' }))
    expect(await screen.findByText('JavaScript')).toBeInTheDocument()
    expect(screen.getByText('SQL')).toBeInTheDocument()
  })

  it('puts the previous code colours back when it closes', () => {
    const { unmount } = setup()
    expect(getActiveEditorTheme()?.id).toBe('lion')
    unmount()
    expect(getActiveEditorTheme()).toBeNull()
  })
})
