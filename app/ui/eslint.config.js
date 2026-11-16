import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

const RAW_ELEMENTS = ['button', 'input', 'select', 'textarea', 'table']

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src/**/*.generated.ts', 'src/api/bindings.ts'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': ['warn', { additionalHooks: 'useAbortableEffect' }],
      'max-lines': ['warn', { max: 250, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'no-restricted-syntax': [
        'warn',
        {
          selector: "VariableDeclarator[id.name='cancelled']",
          message: 'Laden mit cancelled-Flag: useResource oder useAbortableEffect nutzen (core/hooks/).',
        },
        {
          selector: "MemberExpression[object.name='navigator'][property.name='clipboard']",
          message: 'Zwischenablage über copyText aus core nutzen.',
        },
        ...RAW_ELEMENTS.map((name) => ({
          selector: `JSXOpeningElement[name.name='${name}']`,
          message: `Rohes <${name}>: das Control aus core/ui/controls nutzen (oder ein Block aus core/ui/blocks).`,
        })),
      ],
      'no-restricted-imports': [
        'warn',
        { paths: [{ name: 'react-aria-components', message: 'Nur in core/ui/controls importieren.' }, { name: 'dockview-react', message: 'Nur in shell/dock importieren.' }] },
      ],
    },
  },
  // Hier sind die Rohelemente und die Bibliotheken zu Hause (und die Tests: sie prüfen das Verhalten, nicht den Stil).
  {
    files: ['src/core/ui/controls/**', 'src/core/ui/blocks/**', 'src/shell/dock/**', 'tests/**'],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-imports': 'off' },
  },
  // Die Zwischenablage selbst.
  {
    files: ['src/core/clipboard.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
)
