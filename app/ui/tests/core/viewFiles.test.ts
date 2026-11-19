import { describe, expect, it } from 'vitest'
import { forgetViewFile, readViewFile, viewFileText } from '../../src/core/viewFiles'
import { isViewNode, subTabsFor } from '../../src/tabs/tabModel'

describe('viewFiles (abgelegte Dateien nur ansehen)', () => {
  it('liest eine Textdatei als schreibgeschützten Reiter ohne Pfad auf der Platte', async () => {
    const result = await readViewFile(new File(['{"a":1}'], 'data.json', { type: 'application/json' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.node.kind).toBe('view')
    expect(result.node.read_only).toBe(true)
    expect(result.node.path).toBeUndefined()
    expect(isViewNode(result.node)).toBe(true)
    expect(subTabsFor(result.node)).toEqual(['editor'])
    expect(viewFileText(result.node.id)).toBe('{"a":1}')
    forgetViewFile(result.node.id)
    expect(viewFileText(result.node.id)).toBeNull()
  })

  it('gleiche Dateinamen ergeben getrennte Reiter', async () => {
    const a = await readViewFile(new File(['eins'], 'x.txt'))
    const b = await readViewFile(new File(['zwei'], 'x.txt'))
    expect(a.ok && b.ok && a.node.id !== b.node.id).toBe(true)
  })

  it('lehnt Binärdateien ab', async () => {
    const result = await readViewFile(new File(['ab\u0000cd'], 'x.bin'))
    expect(result).toEqual({ ok: false, reason: 'x.bin is not a text file and is not opened.' })
  })

  it('lehnt zu große Dateien ab', async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.txt')
    const result = await readViewFile(big)
    expect(result.ok).toBe(false)
  })
})
