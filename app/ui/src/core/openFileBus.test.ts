import { describe, expect, it } from 'vitest'
import { openFileInDesigner, subscribeOpenFile } from './openFileBus'

describe('openFileBus', () => {
  it('hands the path to the main window listener when no window of its own is involved', () => {
    const seen: string[] = []
    const off = subscribeOpenFile((p) => seen.push(p))
    openFileInDesigner('C:/p/entity/X/X.aod')
    off()
    openFileInDesigner('C:/p/ignored.txt')
    expect(seen).toEqual(['C:/p/entity/X/X.aod'])
  })
})
