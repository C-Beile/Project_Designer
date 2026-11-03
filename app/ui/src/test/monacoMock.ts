// Stand-in for `monaco-editor` in component tests: just enough of the editor API the Source and
// plain-file editors use, with a handle for tests to type into the "editor". Use it with
// `vi.mock('monaco-editor', () => import('../test/monacoMock'))`.

export interface MockMonacoEditor {
  options: Record<string, unknown>
  language: string
  value: string
  disposed: boolean
  actions: string[]
  type: (text: string) => void
}

export const editors: MockMonacoEditor[] = []

export function lastEditor(): MockMonacoEditor {
  const e = editors[editors.length - 1]
  if (!e) throw new Error('no Monaco editor was created')
  return e
}

export function resetEditors(): void {
  editors.length = 0
  diffEditors.length = 0
}

export interface MockDiffEditor {
  options: Record<string, unknown>
  original: string
  modified: string
  language: string
  disposed: boolean
}

export const diffEditors: MockDiffEditor[] = []

export const editor = {
  create(container: HTMLElement, options: Record<string, unknown>) {
    const listeners: Array<() => void> = []
    const state: MockMonacoEditor = {
      options,
      language: String(options.language ?? ''),
      value: String(options.value ?? ''),
      disposed: false,
      actions: [],
      type(text) {
        state.value = text
        listeners.forEach((l) => l())
      },
    }
    editors.push(state)
    container.setAttribute('data-language', state.language)
    return {
      onDidChangeModelContent: (cb: () => void) => {
        listeners.push(cb)
      },
      getModel: () => ({
        getValue: () => state.value,
        setValue: (text: string) => {
          state.value = text
          listeners.forEach((l) => l())
        },
      }),
      addAction: (action: { id: string }) => {
        state.actions.push(action.id)
      },
      dispose: () => {
        state.disposed = true
      },
    }
  },
  createModel(value: string, language?: string) {
    return { value, language: language ?? '', dispose: () => {} }
  },
  createDiffEditor(container: HTMLElement, options: Record<string, unknown>) {
    const state: MockDiffEditor = { options, original: '', modified: '', language: '', disposed: false }
    diffEditors.push(state)
    container.setAttribute('data-diff', 'true')
    return {
      setModel: (m: { original: { value: string; language: string }; modified: { value: string } }) => {
        state.original = m.original.value
        state.modified = m.modified.value
        state.language = m.original.language
      },
      dispose: () => {
        state.disposed = true
      },
    }
  },
  EditorOption: { readOnly: 92 },
  defineTheme: () => {},
  setTheme: () => {},
}

export const languages = {
  register: () => {},
  setLanguageConfiguration: () => {},
  setMonarchTokensProvider: () => {},
}

export const KeyMod = { Alt: 512, CtrlCmd: 2048, Shift: 1024 }
export const KeyCode = { Insert: 19 }
