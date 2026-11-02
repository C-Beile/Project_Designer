import { describe, expect, it } from 'vitest'
import { acceptsEntityFields, addEntityFieldToTemplate, addViewReference } from './viewFields'

const VIEW = `<?xml version="1.0" encoding="UTF-8"?>
<neonView xmlns="http://www.adito.de/2018/ao/Model">
  <name>AbsenceFilter_view</name>
  <children>
    <tableViewTemplate>
      <name>table</name>
      <columns>
        <neonTableColumn>
          <name>a1</name>
          <entityField>ENTRYDATE</entityField>
        </neonTableColumn>
        <neonTableColumn>
          <name>a2</name>
          <entityField>KM</entityField>
        </neonTableColumn>
      </columns>
    </tableViewTemplate>
    <genericViewTemplate>
      <name>generic</name>
      <editMode v="true" />
      <fields>
        <entityFieldLink>
          <name>g1</name>
          <entityField>COUNTRY</entityField>
        </entityFieldLink>
      </fields>
    </genericViewTemplate>
    <genericMultipleViewTemplate>
      <name>multi</name>
      <columns />
    </genericMultipleViewTemplate>
    <cardViewTemplate>
      <name>card</name>
      <titleField>NAME</titleField>
    </cardViewTemplate>
    <neonViewReference>
      <name>r1</name>
      <entityField>#ENTITY</entityField>
      <view>Other_view</view>
    </neonViewReference>
  </children>
</neonView>
`

function ok(r: ReturnType<typeof addEntityFieldToTemplate>): string {
  if ('error' in r) throw new Error(r.error)
  return r.text
}

describe('adding an entity field to a template', () => {
  it('knows which templates take entity fields', () => {
    expect(acceptsEntityFields('tableViewTemplate')).toBe(true)
    expect(acceptsEntityFields('genericViewTemplate')).toBe(true)
    expect(acceptsEntityFields('cardViewTemplate')).toBe(false)
  })

  it('appends a column with the element name of the template and leaves every other line alone', () => {
    const next = ok(addEntityFieldToTemplate(VIEW, 'tableViewTemplate', 'table', 'COUNTRY', 'new-id'))
    expect(next).toContain('        <neonTableColumn>\n          <name>new-id</name>\n          <entityField>COUNTRY</entityField>\n        </neonTableColumn>\n      </columns>')
    expect(next.replace(/ {8}<neonTableColumn>\n {10}<name>new-id<\/name>\n {10}<entityField>COUNTRY<\/entityField>\n {8}<\/neonTableColumn>\n/, '')).toBe(VIEW)
  })

  it('inserts in front of a given entry', () => {
    const next = ok(addEntityFieldToTemplate(VIEW, 'tableViewTemplate', 'table', 'COUNTRY', 'new-id', 1))
    expect(next.indexOf('COUNTRY')).toBeGreaterThan(next.indexOf('ENTRYDATE'))
    expect(next.indexOf('COUNTRY')).toBeLessThan(next.indexOf('<entityField>KM'))
  })

  it('uses entityFieldLink for Generic and fills an empty column list', () => {
    expect(ok(addEntityFieldToTemplate(VIEW, 'genericViewTemplate', 'generic', 'REMARK', 'x1'))).toContain('<entityFieldLink>\n          <name>x1</name>\n          <entityField>REMARK</entityField>')
    const filled = ok(addEntityFieldToTemplate(VIEW, 'genericMultipleViewTemplate', 'multi', 'KM', 'x2'))
    expect(filled).toContain('<columns>\n        <neonGenericMultipleTableColumn>\n          <name>x2</name>\n          <entityField>KM</entityField>\n        </neonGenericMultipleTableColumn>\n      </columns>')
  })

  it('refuses a duplicate, an unknown template and a template without a field list', () => {
    expect(addEntityFieldToTemplate(VIEW, 'tableViewTemplate', 'table', 'KM', 'z')).toEqual({ error: 'KM is already in table.' })
    expect(addEntityFieldToTemplate(VIEW, 'tableViewTemplate', 'other', 'KM', 'z')).toEqual({ error: 'The template other was not found in this view.' })
    expect(addEntityFieldToTemplate(VIEW, 'cardViewTemplate', 'card', 'KM', 'z')).toEqual({ error: 'cardViewTemplate has no list of entity fields.' })
    expect('error' in addEntityFieldToTemplate(VIEW, 'tableViewTemplate', 'table', 'a b', 'z')).toBe(true)
  })

  it('keeps Windows line endings', () => {
    const crlf = VIEW.replace(/\n/g, '\r\n')
    const next = ok(addEntityFieldToTemplate(crlf, 'tableViewTemplate', 'table', 'COUNTRY', 'n'))
    expect(next).not.toMatch(/[^\r]\n/)
  })
})

describe('adding a view reference', () => {
  it('appends a reference after the last child with the corpus structure', () => {
    const r = addViewReference(VIEW, 'Detail_view', 'uuid-1', 'Documents')
    if ('error' in r) throw new Error(r.error)
    expect(r.text).toContain('    <neonViewReference>\n      <name>uuid-1</name>\n      <entityField>Documents</entityField>\n      <view>Detail_view</view>\n    </neonViewReference>\n  </children>')
  })

  it('refuses names that are not names', () => {
    expect('error' in addViewReference(VIEW, 'a b', 'u')).toBe(true)
    expect('error' in addViewReference('<neonView/>', 'A_view', 'u')).toBe(true)
  })
})
