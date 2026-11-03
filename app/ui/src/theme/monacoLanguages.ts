import * as monaco from 'monaco-editor'

// Syntax colouring for the dot files of a project that Monaco does not know: ignore lists
// (.gitignore, .npmignore, .transpilerignore ...) and .gitattributes. The token names are the
// ones the three editor themes colour (theme/monacoTheme.ts).

export const IGNORE_LANGUAGE = 'forge-ignore'
export const GITATTRIBUTES_LANGUAGE = 'forge-gitattributes'

let registered = false

export function ensureMonacoLanguagesDefined(): void {
  if (registered) return
  registered = true

  monaco.languages.register({ id: IGNORE_LANGUAGE, aliases: ['Ignore'] })
  monaco.languages.setLanguageConfiguration(IGNORE_LANGUAGE, { comments: { lineComment: '#' } })
  monaco.languages.setMonarchTokensProvider(IGNORE_LANGUAGE, {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^!/, 'keyword.negation'],
        [/\./, 'string.escape'],
        [/\*\*/, 'operator.globstar'],
        [/[*?]/, 'operator'],
        [/\[[^\]]*\]/, 'regexp'],
        [/[A-Za-z0-9_.@~+-]+(?=\/)/, 'type'],
        [/\.[A-Za-z0-9_-]+$/, 'constant'],
        [/[A-Za-z0-9_@~+-]+/, 'identifier'],
        [/\//, 'delimiter'],
        [/\s+/, 'white'],
      ],
    },
  })

  monaco.languages.register({ id: GITATTRIBUTES_LANGUAGE, aliases: ['Git Attributes'] })
  monaco.languages.setLanguageConfiguration(GITATTRIBUTES_LANGUAGE, { comments: { lineComment: '#' } })
  monaco.languages.setMonarchTokensProvider(GITATTRIBUTES_LANGUAGE, {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^\[attr\][A-Za-z0-9_.-]+/, 'type'],
        [/^[^\s#]+/, { token: 'regexp', next: '@attributes' }],
      ],
      attributes: [
        [/#.*$/, 'comment'],
        [/[-!]/, 'keyword.negation'],
        [/[A-Za-z0-9_.-]+(?==)/, 'attribute.name'],
        [/=/, 'operator'],
        [/[A-Za-z0-9_.\/-]+/, 'attribute.value'],
        [/\s+$/, { token: 'white', next: '@pop' }],
        [/\s+/, 'white'],
      ],
    },
  })
}

/** Colours of the tokens above per editor theme: negation (!, -) warm, patterns blue, attributes yellow/orange. */
export function gitTokenRules(kind: 'night-owl' | 'light' | 'lion'): { token: string; foreground: string }[] {
  const c =
    kind === 'light'
      ? { negation: 'd3423e', pattern: '0b6bcb', name: '8a6a00', value: 'a15c00', glob: '994cc3', escape: 'aa0982' }
      : kind === 'lion'
        ? { negation: 'f48771', pattern: '4fc1ff', name: 'dcdcaa', value: 'ce9178', glob: 'c586c0', escape: 'd7ba7d' }
        : { negation: 'ff5874', pattern: '5ca7e4', name: 'addb67', value: 'ecc48d', glob: 'c792ea', escape: 'f78c6c' }
  return [
    { token: 'keyword.negation', foreground: c.negation },
    { token: 'regexp', foreground: c.pattern },
    { token: 'attribute.name', foreground: c.name },
    { token: 'attribute.value', foreground: c.value },
    { token: 'operator.globstar', foreground: c.glob },
    { token: 'string.escape', foreground: c.escape },
  ]
}
