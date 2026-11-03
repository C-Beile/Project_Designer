import { describe, expect, it } from 'vitest'
import { isValidValue, setCustomProperty, setTopLevelValue } from './preferencesOps'

const SOURCE = `<preferences>
  <jditoMaxContentSize v="10" />
  <customProperties>
    <customStringProperty>
      <name>a</name>
    </customStringProperty>
    <customBooleanProperty>
      <name>b</name>
      <property v="false" />
    </customBooleanProperty>
  </customProperties>
</preferences>`

describe('preferencesOps', () => {
  it('adds a missing property element to an unset custom property', () => {
    const out = setCustomProperty(SOURCE, 'customProperties', 'customStringProperty', 0, 'x & y')
    expect(out).toContain('<property>x &amp; y</property>')
  })

  it('changes a typed boolean value', () => {
    const out = setCustomProperty(SOURCE, 'customProperties', 'customBooleanProperty', 0, 'true')
    expect(out).toContain('<property v="true" />')
  })

  it('rejects values that do not fit the property kind', () => {
    expect(setCustomProperty(SOURCE, 'customProperties', 'customBooleanProperty', 0, 'maybe')).toBeNull()
    expect(isValidValue('int', '12a')).toBe(false)
  })

  it('changes a top-level typed value and returns null for an absent one', () => {
    expect(setTopLevelValue(SOURCE, 'jditoMaxContentSize', 'int', '20')).toContain('<jditoMaxContentSize v="20" />')
    expect(setTopLevelValue(SOURCE, 'homeLocation', 'text', 'x')).toBeNull()
  })
})
