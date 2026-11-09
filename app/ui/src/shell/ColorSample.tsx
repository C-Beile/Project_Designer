import type { CSSProperties, ReactNode } from 'react'

// A concrete example next to every colour of Options > Appearance > Colours: it shows where the colour is used, drawn
// with the colour the user has picked right now, so the effect of a change can be judged without leaving the page.

const mono: CSSProperties = { fontFamily: 'Consolas, monospace', fontSize: 12, whiteSpace: 'pre' }

function Editor({ bg, fg, children, style }: { bg: string; fg: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="forge-sample forge-sample-editor" style={{ background: bg, color: fg, ...mono, ...style }}>
      {children}
    </span>
  )
}

/**
 * @param itemKey the colour (`--accent`, `editor:editor.background`, `syntax:comment` ...)
 * @param value   the colour as chosen now
 * @param editorBg and `editorFg`: the editor colours as chosen now, the ground of the code examples
 */
export function ColorSample({ itemKey, value, editorBg, editorFg }: { itemKey: string; value: string; editorBg: string; editorFg: string }) {
  if (itemKey.startsWith('syntax:')) {
    const kind = itemKey.slice('syntax:'.length)
    const hit = (text: string) => <span style={{ color: value, fontStyle: kind === 'comment' ? 'italic' : undefined }}>{text}</span>
    const lines: Record<string, ReactNode> = {
      comment: <>{hit('// opens the project')}{'\n'}name = open()</>,
      string: <>name = {hit('"Pichler"')}{'\n'}title = {hit("'Contact'")}</>,
      number: <>count = {hit('42')}{'\n'}price = {hit('19.99')}</>,
      keyword: <>{hit('const')} name = 1{'\n'}{hit('if')} (name) {'{'} {hit('return')} {'}'}</>,
      type: <>let list: {hit('Map')}&lt;{hit('string')}&gt;{'\n'}new {hit('Date')}()</>,
      function: <>{hit('open')}(name){'\n'}vars.{hit('get')}("$sys.filter")</>,
      identifier: <>{hit('resultList')} = []{'\n'}{hit('count')} += 1</>,
      operator: <>total {hit('+')} 1 {hit('===')} count{'\n'}a {hit('&&')} b</>,
      delimiter: <>{hit('{')} list{hit('[')}0{hit(']')}{hit('(')}x{hit(')')}{hit(';')} {hit('}')}</>,
      constant: <>return {hit('null')}{'\n'}flag = {hit('true')}</>,
      tag: <>{hit('<entity>')} … {hit('</entity>')}</>,
      'attribute.name': <>&lt;field {hit('name')}="title" {hit('type')}="text"/&gt;</>,
    }
    return <Editor bg={editorBg} fg={editorFg}>{lines[kind] ?? hit('Sample')}</Editor>
  }

  if (itemKey.startsWith('editor:')) {
    const id = itemKey.slice('editor:'.length)
    if (id === 'editor.background') return <Editor bg={value} fg={editorFg}>{'name = open()\nreturn name'}</Editor>
    if (id === 'editor.foreground') return <Editor bg={editorBg} fg={value}>{'name = open()\nreturn name'}</Editor>
    if (id === 'editor.selectionBackground') return <Editor bg={editorBg} fg={editorFg}>name = <span style={{ background: value }}>open(name)</span>{'\nreturn name'}</Editor>
    if (id === 'editor.lineHighlightBackground') return <Editor bg={editorBg} fg={editorFg} style={{ padding: 0 }}><span className="forge-sample-line">name = open()</span><span className="forge-sample-line" style={{ background: value }}>return name</span><span className="forge-sample-line">close()</span></Editor>
    if (id === 'editorCursor.foreground') return <Editor bg={editorBg} fg={editorFg}>name = op<span style={{ borderLeft: `2px solid ${value}`, marginLeft: -1 }} />en(){'\nreturn name'}</Editor>
    if (id === 'editorLineNumber.foreground' || id === 'editorLineNumber.activeForeground') {
      const active = id.endsWith('activeForeground')
      return <Editor bg={editorBg} fg={editorFg}><span style={{ color: active ? '#808080' : value }}>11 </span>name = open(){'\n'}<span style={{ color: active ? value : '#808080' }}>12 </span>return name</Editor>
    }
    if (id === 'editorWhitespace.foreground') return <Editor bg={editorBg} fg={editorFg}>if<span style={{ color: value }}>·</span>(a)<span style={{ color: value }}>·→</span>run()</Editor>
  }

  switch (itemKey) {
    case '--accent':
      return <span className="forge-sample" style={{ color: value, textDecoration: 'underline' }}>Link · active tab · focus</span>
    case '--button-bg':
      return <span className="forge-sample forge-sample-button" style={{ background: value, color: 'var(--button-fg)' }}>OK</span>
    case '--button-fg':
      return <span className="forge-sample forge-sample-button" style={{ background: 'var(--button-bg)', color: value }}>OK</span>
    case '--focus-ring':
      return <span className="forge-sample forge-sample-box" style={{ outline: `2px solid ${value}`, outlineOffset: 1 }}>Focused field</span>
    case '--accent-2':
      return <span className="forge-sample" style={{ color: value, fontWeight: 600 }}>Secondary highlight</span>
    case '--selected-bg':
      return <span className="forge-sample forge-sample-row" style={{ background: value, color: 'var(--selected-fg)' }}>entity ▸ Address</span>
    case '--selected-fg':
      return <span className="forge-sample forge-sample-row" style={{ background: 'var(--selected-bg)', color: value }}>entity ▸ Address</span>
    case '--warm':
      return <span className="forge-sample" style={{ color: value }}>Warm accent (strings, warnings)</span>
    case '--cyan':
      return <span className="forge-sample" style={{ color: value }}>Cool accent (operators)</span>
    case '--bg':
      return <span className="forge-sample forge-sample-box" style={{ background: value, color: 'var(--fg)' }}>Window background</span>
    case '--bg-panel':
      return <span className="forge-sample forge-sample-box" style={{ background: value, color: 'var(--fg)' }}>Panels: Projects, Properties</span>
    case '--bg-elevated':
      return <span className="forge-sample forge-sample-box" style={{ background: value, color: 'var(--fg)', boxShadow: '0 2px 8px rgb(0 0 0 / 0.4)' }}>Menus, dialogs, pop-ups</span>
    case '--bg-inset':
      return <span className="forge-sample forge-sample-box" style={{ background: value, color: 'var(--fg-muted)' }}>Inactive tab</span>
    case '--bg-titlebar':
    case '--bg-titlebar-inactive':
      return <span className="forge-sample forge-sample-box" style={{ background: value, color: 'var(--fg-titlebar)' }}>● Dito Designer — Pichler</span>
    case '--fg':
      return <span className="forge-sample" style={{ color: value }}>Normal text in trees and dialogs</span>
    case '--fg-muted':
      return <span className="forge-sample" style={{ color: value }}>Secondary text · 3 databases</span>
    case '--fg-comment':
      return <span className="forge-sample" style={{ color: value, fontStyle: 'italic' }}>Hints and comments</span>
    case '--fg-titlebar':
    case '--fg-titlebar-inactive':
      return <span className="forge-sample forge-sample-box" style={{ background: 'var(--bg-titlebar)', color: value }}>Dito Designer — Pichler</span>
    case '--border':
      return <span className="forge-sample forge-sample-box" style={{ border: `1px solid ${value}` }}>Divider line</span>
    case '--border-strong':
      return <span className="forge-sample forge-sample-box" style={{ border: `2px solid ${value}` }}>Strong border</span>
    case '--error':
      return <span className="forge-sample" style={{ color: value }}>✖ 1 error</span>
    case '--warning':
      return <span className="forge-sample" style={{ color: value }}>▲ Warning</span>
    case '--success':
      return <span className="forge-sample" style={{ color: value }}>✔ Connected</span>
    default:
      if (itemKey.startsWith('--folder-')) {
        return (
          <span className="forge-sample">
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 6 }}>
              <path d="M1.5 3.5h5l1.5 1.5h6.5v7.5h-13z" fill={value} />
            </svg>
            {itemKey.slice('--folder-'.length)}
          </span>
        )
      }
      return <span className="forge-sample" style={{ color: value }}>Sample</span>
  }
}
