import { describe, expect, it } from 'vitest'
import { areaOf } from './useOutputLogs'

describe('areaOf (Bereich einer Log-Meldung)', () => {
  it('nimmt bei Plugin-Fehlern den Plugin-Namen', () => {
    expect(areaOf('ERROR', 'plugin_call git.git_commit (projectRoot=""): boom')).toBe('git')
    expect(areaOf('ERROR', 'plugin_call ssh-tunnel.connect (): x')).toBe('ssh-tunnel')
  })
  it('leitet sonst den Bereich aus der Art ab', () => {
    expect(areaOf('UI-ERROR', 'popup: x')).toBe('ui')
    expect(areaOf('PERF', 'open project')).toBe('perf')
    expect(areaOf('PANIC', 'thread')).toBe('app')
  })
})
