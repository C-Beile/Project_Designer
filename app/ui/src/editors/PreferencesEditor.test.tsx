import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreferencesEditor } from './PreferencesEditor'
import type { WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'

function textF(value: string): WireValue {
  return { kind: 'text', value }
}
function boolF(value: boolean): WireValue {
  return { kind: 'bool', value }
}
function intF(value: number): WireValue {
  return { kind: 'int', value }
}

function customStringProperty(name: string, value: string): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: textF(name) },
      { key: 'description', value: textF('') },
      { key: 'property', value: textF(value) },
    ],
  }
}

// Mirrors the real fixture's `customConfigProperties.customIntegerProperty` shape - exactly one
// real occurrence, so core-model projects it un-indexed (a plain Object, not a 1-item Array).
function customIntegerProperty(name: string, value: number): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: textF(name) },
      { key: 'description', value: textF('') },
      { key: 'property', value: intF(value) },
    ],
  }
}

// Mirrors _____PREFERENCES_PROJECT.aod's real shape closely enough for the MUST-subset fields plus
// both property-bank shapes (indexed array + the real un-indexed single-occurrence case, R26).
function samplePreferences(): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: textF('_____PREFERENCES_PROJECT') },
      { key: 'projectName', value: textF('hermes xRM2026') },
      { key: 'mailRepositoryAlias', value: textF('defaultDbRepository') },
      { key: 'blobHandlingMethod', value: textF('PROCESS') },
      { key: 'databaseAuditProcessLoggerUser', value: textF('Admin') },
      { key: 'mailGlobalUserServerEnabled', value: boolF(true) },
      {
        key: 'customProperties',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'customStringProperty',
              value: { kind: 'array', items: [customStringProperty('nominatim.url', 'https://nom.adito.de/search.php')] },
            },
            {
              key: 'customBooleanProperty',
              value: {
                kind: 'array',
                items: [
                  { kind: 'object', fields: [{ key: 'name', value: textF('phoneValidation.enable') }, { key: 'property', value: boolF(true) }] },
                ],
              },
            },
          ],
        },
      },
      {
        key: 'customConfigProperties',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'customIntegerProperty',
              value: customIntegerProperty('bulkmail.dateToSendPassedAfter', 24),
            },
          ],
        },
      },
    ],
  }
}

function Harness({ api, tree: initial }: { api: ReturnType<typeof createMockForgeApi>; tree: WireValue }) {
  const [tree, setTree] = useState(initial)
  return <PreferencesEditor nodeId="node-1" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={setTree} />
}

describe('PreferencesEditor (P4 fifth family, part 2/3, "Fertig"-Kriterium 3)', () => {
  it('renders the MUST-subset scalar fields', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': samplePreferences() } })
    render(<Harness api={api} tree={samplePreferences()} />)

    expect(screen.getByLabelText('Project name')).toHaveValue('hermes xRM2026')
    expect(screen.getByLabelText('Mail repository alias')).toHaveValue('defaultDbRepository')
    expect(screen.getByLabelText('Blob handling method')).toHaveValue('PROCESS')
    expect(screen.getByLabelText('Database audit process logger user')).toHaveValue('Admin')
  })

  it('renders custom property bank entries, including the un-indexed single-occurrence shape (R26)', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': samplePreferences() } })
    render(<Harness api={api} tree={samplePreferences()} />)

    expect(screen.getByText('nominatim.url')).toBeInTheDocument()
    expect(screen.getByText('bulkmail.dateToSendPassedAfter')).toBeInTheDocument()
  })

  it('makes a text-content property value editable and a typed-attribute one read-only (R24)', () => {
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': samplePreferences() } })
    render(<Harness api={api} tree={samplePreferences()} />)

    // Iteration order follows the five known tags (Boolean, String, Integer, Password, JDito), so
    // within "Custom properties" the boolean entry (read-only) comes before the string one (editable).
    expect(screen.getByLabelText('Custom properties 0 value (read-only)')).toHaveTextContent('true')
    expect(screen.getByLabelText('Custom properties 1 value')).toHaveValue('https://nom.adito.de/search.php')
    expect(screen.getByLabelText('Custom config properties 0 value (read-only)')).toHaveTextContent('24')
  })

  it('commits an edit to a custom string property value with Enter, keyboard only', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': samplePreferences() } })
    render(<Harness api={api} tree={samplePreferences()} />)

    const input = screen.getByLabelText('Custom properties 1 value')
    await user.click(input)
    await user.clear(input)
    await user.keyboard('https://edited.example{Enter}')

    await waitFor(() => expect(screen.getByLabelText('Custom properties 1 value')).toHaveValue('https://edited.example'))
  })

  it('Escape reverts an in-progress edit to projectName without committing it', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: { 'node-1': samplePreferences() } })
    const setPropertySpy = vi.spyOn(api, 'setProperty')
    render(<Harness api={api} tree={samplePreferences()} />)

    const input = screen.getByLabelText('Project name')
    await user.click(input)
    await user.type(input, 'discarded')
    await user.keyboard('{Escape}')

    expect(screen.getByLabelText('Project name')).toHaveValue('hermes xRM2026')
    expect(setPropertySpy).not.toHaveBeenCalled()
  })
})
