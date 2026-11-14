import { afterEach, describe, expect, it } from 'vitest'
import { _resetContextKeysForTests, setContextKey } from './contextKeys'
import { _resetKeybindingsForTests, commandForKey, registerKeybinding } from './keybindings'

const ctrlT = () => new KeyboardEvent('keydown', { key: 't', ctrlKey: true })

afterEach(() => {
  _resetKeybindingsForTests()
  _resetContextKeysForTests()
})

describe('keybindings', () => {
  it('finds the command of a registered key and forgets it after unregister', () => {
    const off = registerKeybinding({ command: 'x.run', key: 'Mod+T' })
    expect(commandForKey(ctrlT())?.command).toBe('x.run')
    off()
    expect(commandForKey(ctrlT())).toBeUndefined()
  })

  it('respects the when condition on context keys', () => {
    registerKeybinding({ command: 'x.run', key: 'Mod+T', when: (k) => !!k.hasProject })
    expect(commandForKey(ctrlT())).toBeUndefined()
    setContextKey('hasProject', true)
    expect(commandForKey(ctrlT())?.command).toBe('x.run')
  })

  it('ignores bindings of a plugin that is not registered', () => {
    registerKeybinding({ command: 'x.run', key: 'Mod+T', plugin: 'nope' })
    expect(commandForKey(ctrlT())).toBeUndefined()
  })
})
