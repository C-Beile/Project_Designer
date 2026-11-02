import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilePropertiesPanel, formatFileSize, formatModified } from './FilePropertiesPanel'
import { createMockForgeApi } from '../test/mockApi'

describe('FilePropertiesPanel', () => {
  it('shows name, extension, size, modification time and the full path like the original', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    api.fileInfo = async (path) => ({ name: 'package.json', extension: 'json', size: 2345, modified_ms: Date.UTC(2026, 5, 15, 12, 33, 26), path })
    render(<FilePropertiesPanel api={api} path="C:/p/package.json" />)
    expect(await screen.findByLabelText('Name')).toHaveValue('package.json')
    expect(screen.getByLabelText('Extension')).toHaveValue('json')
    expect(screen.getByLabelText('File Size')).toHaveValue('2,345 B')
    expect(screen.getByLabelText('Modification Time')).toHaveValue(formatModified(Date.UTC(2026, 5, 15, 12, 33, 26)))
    expect(screen.getByLabelText('All Files')).toHaveValue('C:/p/package.json')
  })

  it('formats like the Java style of the original', () => {
    expect(formatFileSize(12)).toBe('12 B')
    expect(formatModified(null)).toBe('')
    expect(formatModified(Date.UTC(2026, 5, 15, 12, 33, 26))).toMatch(/^Jun 1[45], 2026, \d{1,2}:33:26 [AP]M$/)
  })
})
