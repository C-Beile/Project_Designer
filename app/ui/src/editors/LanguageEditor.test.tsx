import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageEditor } from './LanguageEditor'
import { DialogHost, _resetDialogsForTests } from '../core/dialogService'
import type { TreeNode, WireValue } from '../wire/types'
import { ProjectIndexContext, type ProjectIndex } from './projectIndex'
import { createMockForgeApi } from '../test/mockApi'

const ID = 'C:/p/language/_____LANGUAGE_de/_____LANGUAGE_de.aod'
const MODULE_ID = 'C:/p/node_modules/@aditosoftware/activity/language/_____LANGUAGE_de_activity/_____LANGUAGE_de_activity.aod'

const SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<language>
  <name>_____LANGUAGE_de</name>
  <language>de</language>
  <keyValueMap>
    <stringEntry>
      <name>Vacation</name>
      <value>Urlaub</value>
    </stringEntry>
    <stringEntry>
      <name>Added</name>
      <value>Hinzugefügt</value>
    </stringEntry>
    <stringEntry>
      <name>Added</name>
      <value>Dupe</value>
    </stringEntry>
  </keyValueMap>
</language>
`

const text = (value: string): WireValue => ({ kind: 'text', value })
const tree: WireValue = {
  kind: 'object',
  fields: [
    { key: 'name', value: text('_____LANGUAGE_de') },
    { key: 'language', value: text('de') },
    { key: 'country', value: text('') },
    { key: 'variant', value: text('') },
    { key: 'keyValueMap', value: { kind: 'object', fields: [] } },
  ],
}

function setup(id = ID, many = 0) {
  let src = SOURCE
  if (many > 0) {
    const entries = Array.from({ length: many }, (_, i) => `    <stringEntry>\n      <name>Key${String(i).padStart(5, '0')}</name>\n      <value>Val${i}</value>\n    </stringEntry>\n`).join('')
    src = SOURCE.replace('  </keyValueMap>', entries + '  </keyValueMap>')
  }
  const api = createMockForgeApi({ projectTree: [], documents: { [id]: tree }, sources: { [id]: src } })
  render(
    <>
      <LanguageEditor nodeId={id} projectRoot="C:/p" tree={tree} api={api} onTreeChange={() => {}} />
      <DialogHost />
    </>,
  )
  return { api, id }
}

afterEach(() => _resetDialogsForTests())

describe('LanguageEditor grid', () => {
  it('shows Module | Key | Value with the entries and marks duplicate keys', async () => {
    setup()
    expect(await screen.findByText('Vacation')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Module/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Key' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('3 entries, 1 duplicate key')
    const rows = screen.getAllByRole('row').filter((r) => r.className.includes('is-dup'))
    expect(rows).toHaveLength(2)
  })

  it('edits a value by double click: Enter writes only that text', async () => {
    const user = userEvent.setup()
    const { api, id } = setup()
    await user.dblClick(await screen.findByText('Urlaub'))
    const input = screen.getByLabelText('Edit value')
    await user.clear(input)
    await user.type(input, 'Ferien & mehr{Enter}')
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toBe(SOURCE.replace('<value>Urlaub</value>', '<value>Ferien &amp; mehr</value>')))
  })

  it('edits a key; Escape throws the change away', async () => {
    const user = userEvent.setup()
    const { api, id } = setup()
    await user.dblClick(await screen.findByText('Vacation'))
    await user.type(screen.getByLabelText('Edit key'), 'XYZ{Escape}')
    expect((await api.getObjectSource(id)).text).toBe(SOURCE)
    await user.dblClick(screen.getByText('Vacation'))
    const input = screen.getByLabelText('Edit key')
    await user.clear(input)
    await user.type(input, 'Holiday{Enter}')
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toContain('<name>Holiday</name>'))
  })

  it('typing on a selected row starts editing its value, Tab on a key moves to the value', async () => {
    const user = userEvent.setup()
    const { api, id } = setup()
    await user.click(await screen.findByText('Urlaub'))
    await user.keyboard('F')
    expect(screen.getByLabelText('Edit value')).toHaveValue('F')
    await user.keyboard('erien{Enter}')
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toContain('<value>Ferien</value>'))
    await user.dblClick(screen.getByText('Vacation'))
    await user.keyboard('{Tab}')
    expect(screen.getByLabelText('Edit value')).toBeInTheDocument()
  })

  it('Add row puts a completely empty entry at the top and starts editing its key', async () => {
    const user = userEvent.setup()
    const { api, id } = setup()
    await screen.findByText('Vacation')
    await user.click(screen.getByRole('button', { name: 'Add row' }))
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toContain('<keyValueMap>\n    <stringEntry>\n      <name></name>\n      <value></value>'))
    const key = await screen.findByLabelText('Edit key')
    await userEvent.setup().type(key, 'MyWord{Tab}')
    await userEvent.setup().keyboard('Mein Wort{Enter}')
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toContain('<name>MyWord</name>\n      <value>Mein Wort</value>'))
  })

  it('the context menu has the entries of the original in their order and spelling', async () => {
    setup()
    fireEvent.contextMenu(screen.getByRole('grid'))
    await screen.findByRole('menuitem', { name: 'Add row' })
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).toEqual(['Translate...', 'Copy Values from another Language File...', 'Add row', 'Remove rows', 'Remove rows form all languages', 'Override Keys'])
    expect(screen.getByRole('menuitem', { name: 'Translate...' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Remove rows' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Remove rows form all languages' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('Remove rows removes the marked rows after asking', async () => {
    const user = userEvent.setup()
    const { api, id } = setup()
    await user.click(await screen.findByText('Vacation'))
    await user.keyboard('{Control>}')
    await user.click(screen.getByText('Urlaub'))
    await user.keyboard('{/Control}')
    fireEvent.contextMenu(screen.getByText('Vacation'))
    await user.click(screen.getByRole('menuitem', { name: 'Remove rows' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect((await api.getObjectSource(id)).text).toBe(SOURCE)
    fireEvent.contextMenu(screen.getByText('Vacation'))
    await user.click(screen.getByRole('menuitem', { name: 'Remove rows' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(async () => expect((await api.getObjectSource(id)).text).not.toContain('<name>Vacation</name>'))
  })

  it('shift click marks a range of rows', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByText('Vacation'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getAllByText('Added')[1])
    await user.keyboard('{/Shift}')
    expect(screen.getAllByRole('row').filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(3)
  })

  it('sorts by a column and filters by key, value or module', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText('Vacation')
    await user.click(screen.getByRole('columnheader', { name: 'Key' }))
    const keys = () => within(screen.getByRole('grid')).queryAllByRole('row').map((r) => r.children[1].textContent)
    expect(keys()).toEqual(['Added', 'Added', 'Vacation'])
    await user.click(screen.getByRole('columnheader', { name: /Key/ }))
    expect(keys()).toEqual(['Vacation', 'Added', 'Added'])
    await user.type(screen.getByLabelText('Search entries'), 'urlaub')
    expect(keys()).toEqual(['Vacation'])
    await user.selectOptions(screen.getByLabelText('Search in'), 'name')
    expect(keys()).toEqual([])
  })

  it('draws only a window of rows for thousands of entries', async () => {
    setup(ID, 5000)
    await screen.findByText('Vacation')
    const drawn = screen.getAllByRole('row').length
    expect(drawn).toBeLessThan(200)
    expect(screen.getByRole('status')).toHaveTextContent('5003 entries')
  })

  it('module objects are read-only and show their module', async () => {
    setup(MODULE_ID)
    expect(await screen.findByText(/Read only/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add row' })).toBeDisabled()
    expect(screen.getAllByText('@aditosoftware/activity').length).toBeGreaterThan(0)
  })

  it('renders the sqlModels shape (no keyValueMap) with a note and no grid', () => {
    const t: WireValue = { kind: 'object', fields: [{ key: 'name', value: text('_____LANGUAGE_EXTRA') }, { key: 'sqlModels', value: { kind: 'object', fields: [] } }] }
    const api = createMockForgeApi({ projectTree: [], documents: { n: t } })
    render(<LanguageEditor nodeId="n" projectRoot="C:/p" tree={t} api={api} onTreeChange={() => {}} />)
    expect(screen.getByRole('heading', { name: '_____LANGUAGE_EXTRA' })).toBeInTheDocument()
    expect(screen.queryByRole('grid')).toBeNull()
  })
})

describe('LanguageEditor across language files', () => {
  const OTHER_ID = 'C:/p/language/_____LANGUAGE_en/_____LANGUAGE_en.aod'
  const OTHER = `<language>
  <name>_____LANGUAGE_en</name>
  <keyValueMap>
    <stringEntry>
      <name>Vacation</name>
      <value>Vacation</value>
    </stringEntry>
    <stringEntry>
      <name>OnlyEnglish</name>
      <value>Only English</value>
    </stringEntry>
  </keyValueMap>
</language>
`
  const nodes: Record<string, TreeNode> = {
    _____LANGUAGE_de: { id: ID, label: '_____LANGUAGE_de', object_type: 'language', is_leaf: true, children: [] },
    _____LANGUAGE_en: { id: OTHER_ID, label: '_____LANGUAGE_en', object_type: 'language', is_leaf: true, children: [] },
  }
  const index: ProjectIndex = { findObject: (t, n) => (t === 'language' ? (nodes[n] ?? null) : null), openObject: () => {}, namesOf: (t) => (t === 'language' ? Object.keys(nodes) : []) }

  function setupTwo() {
    const api = createMockForgeApi({ projectTree: [], documents: { [ID]: tree, [OTHER_ID]: tree }, sources: { [ID]: SOURCE, [OTHER_ID]: OTHER } })
    render(
      <ProjectIndexContext.Provider value={index}>
        <LanguageEditor nodeId={ID} projectRoot="C:/p" tree={tree} api={api} onTreeChange={() => {}} />
        <DialogHost />
      </ProjectIndexContext.Provider>,
    )
    return api
  }

  it('Remove rows form all languages previews the files and removes the key everywhere', async () => {
    const user = userEvent.setup()
    const api = setupTwo()
    await user.click(await screen.findByText('Vacation'))
    fireEvent.contextMenu(screen.getByText('Vacation'))
    await user.click(screen.getByRole('menuitem', { name: 'Remove rows form all languages' }))
    expect(await screen.findByText(/_____LANGUAGE_de: 1/)).toBeInTheDocument()
    expect(screen.getByText(/_____LANGUAGE_en: 1/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(async () => expect((await api.getObjectSource(OTHER_ID)).text).not.toContain('<name>Vacation</name>'))
    expect((await api.getObjectSource(OTHER_ID)).text).toContain('<name>OnlyEnglish</name>')
    await waitFor(async () => expect((await api.getObjectSource(ID)).text).not.toContain('<name>Vacation</name>'))
  })

  it('Copy Values from another Language File asks which file, shows the counts and adds the missing keys', async () => {
    const user = userEvent.setup()
    const api = setupTwo()
    await screen.findByText('Vacation')
    fireEvent.contextMenu(screen.getByRole('grid'))
    await user.click(screen.getByRole('menuitem', { name: 'Copy Values from another Language File...' }))
    await user.type(await screen.findByLabelText('Language file'), '_____LANGUAGE_en')
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(await screen.findByText(/1 missing key and 0 empty values/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(async () => expect((await api.getObjectSource(ID)).text).toContain('<name>OnlyEnglish</name>\n      <value>Only English</value>'))
  })
})
