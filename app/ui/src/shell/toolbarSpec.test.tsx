import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Toolbar } from './Toolbar'
import { defaultToolbarPrefs } from './toolbarPrefs'

// Toolbar buttons in the order of designer_gui/runtime.json (groups open, undoredo, deploy, Run, git, analytics, convert).
const RUNTIME = resolve(__dirname, '../../../../../../60_design/designer_gui/runtime.json')

describe.skipIf(!existsSync(RUNTIME))('toolbar against runtime.json', () => {
  const runtime = JSON.parse(readFileSync(RUNTIME, 'utf8')) as { toolbars: { group: string; buttons: { name: string; tooltip?: string }[] }[] }

  it('shows the buttons of every group in the original order, Vendira additions aside', () => {
    render(
      <Toolbar
        hasProject
        hasSelection
        hasUnsaved
        canUndo
        canRedo
        systems={['dev']}
        runConfig="dev"
        onRunConfigChange={() => {}}
        engine="official"
        onEngineChange={() => {}}
        transpileRunning={false}
        onCommand={() => {}}
        prefs={defaultToolbarPrefs()}
        onToggleGroup={() => {}}
      />,
    )
    const ours = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '')
    const wanted = runtime.toolbars.flatMap((t) => t.buttons).filter((b) => b.name && !b.name.startsWith('(')).map((b) => b.name)
    for (const name of wanted) expect(ours, name).toContain(name)
    expect(ours.filter((n) => wanted.includes(n))).toEqual(wanted)
  })

  it('writes the shortcut in brackets into the tooltip like the original', () => {
    render(
      <Toolbar hasProject hasSelection hasUnsaved canUndo canRedo systems={[]} runConfig="" onRunConfigChange={() => {}} engine="official" onEngineChange={() => {}} transpileRunning={false} onCommand={() => {}} prefs={defaultToolbarPrefs()} onToggleGroup={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Save All' }).title).toBe('Save All (Ctrl+S)')
    expect(screen.getByRole('button', { name: 'Deploy opened models' }).title).toMatch(/\(Ctrl\+Alt\+F8\)$/)
    expect(screen.getByRole('button', { name: 'Open in Extension Pack' }).title).toMatch(/\(F7\)$/)
  })
})
