import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { workerKindForLabel } from './monacoWorkers'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

// Regression: opening package.json logged "Missing requestHandler or method: getFoldingRanges"
// because the json language was served by the generic editor worker.
describe('monaco worker assignment', () => {
  it('gives every language with a language service its own worker', () => {
    expect(workerKindForLabel('json')).toBe('json')
    expect(workerKindForLabel('css')).toBe('css')
    expect(workerKindForLabel('scss')).toBe('css')
    expect(workerKindForLabel('less')).toBe('css')
    expect(workerKindForLabel('html')).toBe('html')
    expect(workerKindForLabel('handlebars')).toBe('html')
    expect(workerKindForLabel('typescript')).toBe('typescript')
    expect(workerKindForLabel('javascript')).toBe('typescript')
  })

  it('uses the generic editor worker for languages without a service', () => {
    for (const label of ['xml', 'yaml', 'sql', 'markdown', 'plaintext', 'editorWorkerService', '']) {
      expect(workerKindForLabel(label)).toBe('editor')
    }
  })

  it('imports a worker module for each kind', () => {
    const source = readFileSync(resolve(__dirname, 'monacoWorkers.ts'), 'utf8')
    for (const w of ['editor/editor.worker', 'language/typescript/ts.worker', 'language/json/json.worker', 'language/css/css.worker', 'language/html/html.worker']) {
      expect(source).toContain(`monaco-editor/${w}?worker`)
    }
  })
})
