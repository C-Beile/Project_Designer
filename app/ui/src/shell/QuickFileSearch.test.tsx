import { describe, expect, it } from 'vitest'
import { matchFiles } from './QuickFileSearch'

describe('quick file search', () => {
  const files = ['entity/Person_entity/Person_entity.aod', 'process/Person_lib/process.js', 'neonView/PersonEdit_view/PersonEdit_view.aod', 'README.md']

  it('matches names, ranks a name that starts with the word first and ignores the case', () => {
    expect(matchFiles(files, 'personedit')).toEqual(['neonView/PersonEdit_view/PersonEdit_view.aod'])
    expect(matchFiles(files, 'PERSON')).toHaveLength(3)
    expect(matchFiles(files, 'readme')).toEqual(['README.md'])
  })

  it('needs every word and also searches the folder', () => {
    expect(matchFiles(files, 'person lib')).toEqual(['process/Person_lib/process.js'])
    expect(matchFiles(files, 'nothing')).toEqual([])
    expect(matchFiles(files, '')).toHaveLength(4)
  })
})
