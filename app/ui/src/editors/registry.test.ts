import { afterEach, describe, expect, it } from 'vitest'
import { _resetRegistryForTests, getEditorFor, registerEditor } from './registry'
import type { EditorProps } from './registry'

function Dummy(_props: EditorProps) {
  return null
}

describe('editor host registry (Ziel A.4 - "Registry-Pattern im Frontend")', () => {
  afterEach(() => _resetRegistryForTests())

  it('returns the registered component for its object type', () => {
    registerEditor('entity', Dummy)
    expect(getEditorFor('entity')).toBe(Dummy)
  })

  it('returns undefined for an unregistered object type, and for null', () => {
    expect(getEditorFor('view')).toBeUndefined()
    expect(getEditorFor(null)).toBeUndefined()
  })

  it('a later registration for a different type does not disturb an earlier one', () => {
    registerEditor('entity', Dummy)
    function OtherDummy(_props: EditorProps) {
      return null
    }
    registerEditor('view', OtherDummy)

    expect(getEditorFor('entity')).toBe(Dummy)
    expect(getEditorFor('view')).toBe(OtherDummy)
  })
})
