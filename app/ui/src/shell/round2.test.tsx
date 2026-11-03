import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from './Shell'
import { OutputBody, type OutputLine, type OutputSubTab } from './OutputPanel'
import { PluginsDialog } from './PluginsDialog'
import { LocalDataDialog, formatBytes } from './LocalDataDialog'
import { OpenModelDialog, matchModels } from './OpenModelDialog'
import { TableCenterDialog, buildRows } from './TableCenterDialog'
import { RefactoringPanel } from './RefactoringPanel'
import { ScanServicesPanel, groupProblems } from '../diagnostics/ScanServicesPanel'
import { ProblemsPanel } from '../diagnostics/ProblemsPanel'
import { buildMenus, type MenuContext } from './menuModel'
import { createMockForgeApi } from '../test/mockApi'
import { resetProblemsForTests, setProblems, fromProblemDto, type Problem } from '../problems/problemStore'
import { resetPluginsForTests } from '../settings/plugins'
import { resetOptionsForTests } from '../settings/options'
import type { ProblemDto, TreeNode } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const EMPTY: Record<OutputSubTab, OutputLine[]> = { database: [], build: [], default: [], nodejs: [] }

const ctx: MenuContext = {
  hasProject: true,
  projectName: 'p',
  hasSelection: false,
  hasUnsaved: false,
  canUndo: false,
  canRedo: false,
  recentProject: null,
  theme: 'dark',
  transpileRunning: false,
  engine: 'official',
}

const problem = (over: Partial<Problem> = {}): Problem => ({
  id: 'p1',
  channel: 'scan:p',
  source: 'validator',
  severity: 'Error',
  message: 'Field is broken',
  nodeId: 'C:/p/entity/A_entity/A_entity.aod',
  object: 'A_entity',
  objectType: 'entity',
  file: 'C:/p/entity/A_entity/A_entity.aod',
  line: 7,
  ...over,
})

beforeEach(() => {
  window.localStorage.clear()
  resetProblemsForTests()
  resetPluginsForTests()
  resetOptionsForTests()
})

describe('menu model (manual chapter 4)', () => {
  it('follows the screenshots: New submenu, Open, Project Properties, Toolbars submenu, Code Folds', () => {
    const menus = buildMenus(ctx)
    const file = menus[0].items
    expect(file[0]).toMatchObject({ kind: 'item', label: 'New' })
    expect(file.map((i) => i.label)).toEqual(expect.arrayContaining(['Find', 'Open Project', 'Import Project...', 'Export Project...', 'Exit']))
    expect(file.map((i) => i.label)).not.toContain('Project Properties')
    const view = menus[2].items
    const toolbars = view.find((i) => i.id === 'view.toolbars')!
    expect(toolbars.children!.map((c) => c.label)).toEqual(['analytics', 'convert', 'open', 'undoredo', 'git', 'deploy', 'Run', 'Performance', 'Transpiler', 'Small Toolbar Icons', '', 'Reset Toolbars', 'Customize'])
    expect(toolbars.children!.find((c) => c.label === 'Performance')!.checked).toBe(false)
    expect(view.find((i) => i.id === 'view.codeFolds')!.enabled).toBe(false)
  })

  it('enables the editor commands only while a code editor is open', () => {
    const find = (c: MenuContext) => buildMenus(c)[1].items.find((i) => i.id === 'edit.find')!
    expect(find(ctx).enabled).toBe(false)
    expect(find({ ...ctx, hasCodeEditor: true })).toMatchObject({ enabled: true, command: 'editor.action', arg: 'actions.find' })
  })

  it('dims the Team menu when the Git plugin is deactivated', () => {
    const gitMenu = buildMenus({ ...ctx, gitActive: false })[6].items.find((i) => i.id === 'team.git')!
    const commit = gitMenu.children!.find((i) => i.id === 'team.commit')!
    expect(commit.enabled).toBe(false)
    expect(commit.hint).toMatch(/Git plugin/)
  })
})

describe('Output window (manual chapter 7)', () => {
  const lines = (n: number): OutputLine[] => Array.from({ length: n }, (_, i) => ({ text: `line ${i}`, level: i === 1 ? 'error' : 'info' }))
  const base = { sub: 'build' as const, onSelectSub: () => {}, problems: [], scanning: false, onOpenProblem: () => {}, onClear: vi.fn(), onRefreshScan: () => {}, refactoring: null, onOpenUsage: () => {}, onDoRefactoring: () => {}, onCloseRefactoring: () => {} }

  it('has the four server buttons dimmed and clears and filters the log', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<OutputBody active="output" {...base} onClear={onClear} logs={{ ...EMPTY, build: lines(3) }} />)
    for (const name of ['Start', 'Stop', 'Exit', 'Clear cache']) expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.getByText('line 0')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show lines' }), 'error')
    expect(screen.queryByText('line 0')).toBeNull()
    expect(screen.getByText('line 1')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show lines' }), 'all')
    await user.type(screen.getByRole('textbox', { name: 'Filter output' }), 'line 2')
    expect(screen.getByText('line 2')).toBeInTheDocument()
    expect(screen.queryByText('line 0')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear log' }))
    expect(onClear).toHaveBeenCalledWith('build')
  })
})

describe('Problems and Scan Services', () => {
  it('lists problems with file, line and message and jumps on double click', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ProblemsPanel problems={[problem(), problem({ id: 'p2', severity: 'Warning', message: 'Only a warning', line: undefined })]} scanning={false} onOpen={onOpen} />)
    const row = screen.getByText('Field is broken').closest('tr')!
    expect(within(row).getByText('7')).toBeInTheDocument()
    expect(within(row).getByText('entity/A_entity/')).toBeInTheDocument()
    expect(within(row).getByText('A_entity.aod')).toBeInTheDocument()
    await user.dblClick(row)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
    await user.click(screen.getByRole('checkbox', { name: /Warnings/ }))
    expect(screen.queryByText('Only a warning')).toBeNull()
  })

  it('groups tasks by type and object, ignores warnings but never errors', async () => {
    const user = userEvent.setup()
    const list = [problem(), problem({ id: 'p2', severity: 'Warning', message: 'Doc missing', object: 'B_entity', nodeId: 'C:/p/entity/B_entity/B_entity.aod' })]
    expect(groupProblems(list, 'type')[0]).toMatchObject({ key: 'entity', count: 2 })
    render(<ScanServicesPanel problems={list} scanning={false} onRefresh={() => {}} onOpen={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    const warning = screen.getByText('Doc missing')
    await user.click(warning)
    await user.click(screen.getByRole('button', { name: 'Ignore selected tasks' }))
    expect(screen.queryByText('Doc missing')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show ignored tasks' }))
    expect(screen.getByText('Doc missing')).toBeInTheDocument()
    await user.click(screen.getByText('Field is broken'))
    expect(screen.getByRole('button', { name: 'Ignore selected tasks' })).toBeDisabled()
  })

  it('the shell scans the project and shows the errors in the status bar, the tree and the Problems tab', async () => {
    const user = userEvent.setup()
    const objectId = 'C:/demo/entity/A_entity/A_entity.aod'
    const tree: TreeNode[] = [
      {
        id: 'C:/demo',
        label: 'demo',
        object_type: null,
        is_leaf: false,
        kind: 'project',
        children: [{ id: objectId, label: 'A_entity', object_type: 'entity', is_leaf: true, children: [] }],
      },
    ]
    const dto: ProblemDto = { node_id: objectId, object: 'A_entity', object_type: 'entity', source: 'reference', severity: 'Error', message: "Reference to entity 'X' not found", line: 5 }
    const api = createMockForgeApi({ projectTree: tree, documents: {}, problems: [dto] })
    render(<Shell api={api} projectRoot="C:/demo" />)
    const status = screen.getByRole('contentinfo', { name: 'Status bar' })
    await waitFor(() => expect(status).toHaveTextContent('1 error'), { timeout: 3000 })
    await user.click(within(status).getByRole('button', { name: /1 error/ }))
    expect(await screen.findByText("Reference to entity 'X' not found")).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Problems/ })).toHaveTextContent('1')
  })
})

describe('Refactoring tab', () => {
  it('blocks Safely Delete while usages exist unless forced, and lists the usages', async () => {
    const user = userEvent.setup()
    const onDo = vi.fn()
    const state = { mode: 'delete' as const, object: 'A_entity', objectType: 'entity', nodeId: 'x', usages: [{ node_id: 'c', object: 'Ctx', object_type: 'neonContext', line: 3, kind: 'NeonContextEntity' }] }
    render(<RefactoringPanel state={state} onOpenUsage={() => {}} onDo={onDo} onClose={() => {}} />)
    expect(screen.getByText('Ctx')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Do Refactoring' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Do Refactoring' }))
    expect(onDo).toHaveBeenCalled()
  })

  it('allows a safe delete without usages', () => {
    render(<RefactoringPanel state={{ mode: 'delete', object: 'A', objectType: 'entity', nodeId: 'x', usages: [] }} onOpenUsage={() => {}} onDo={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Do Refactoring' })).toBeEnabled()
  })
})

describe('Plugins dialog (manual 14.1)', () => {
  it('shows the five tabs, the installed list and switches Git off and on', async () => {
    const user = userEvent.setup()
    render(<PluginsDialog onClose={() => {}} />)
    for (const t of ['Updates', 'Available Plugins', 'Downloaded', /Installed/, 'Settings']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument()
    const row = screen.getByText('Git').closest('tr')!
    await user.click(row)
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(within(row).getByRole('img', { name: 'Deactivated' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    expect(within(row).getByRole('img', { name: 'Active' })).toBeInTheDocument()
  })

  it('marks missing components and does not let them be deactivated', async () => {
    const user = userEvent.setup()
    render(<PluginsDialog onClose={() => {}} />)
    const row = screen.getByText('Liquibase').closest('tr')!
    expect(within(row).getByRole('img', { name: 'Not implemented' })).toBeInTheDocument()
    await user.click(row)
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeDisabled()
  })
})

describe('Local Data dialog (manual chapter 12)', () => {
  it('shows the data folder and marks outdated version folders without deleting anything', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<LocalDataDialog api={api} onClose={() => {}} />)
    expect(await screen.findByTestId('forge-data-dir')).toHaveTextContent('vendira-designer')
    const versions = screen.getByRole('table', { name: 'Version folders' })
    expect(within(versions).getByText('2020')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run Janitor Now' }))
    expect(screen.getByRole('status')).toHaveTextContent('does not delete them')
    expect(formatBytes(5_000_000)).toBe('4.8 MB')
  })
})

describe('Open dialog and System Table Control Center', () => {
  it('finds models with a wildcard and opens the chosen one with Enter', async () => {
    const user = userEvent.setup()
    const models = [
      { type: 'entity', name: 'Address_entity' },
      { type: 'neonView', name: 'AddressList_view' },
      { type: 'entity', name: 'Car_entity' },
    ]
    expect(matchModels(models, '*list').map((m) => m.name)).toEqual(['AddressList_view'])
    const onPick = vi.fn()
    render(<OpenModelDialog models={models} onPick={onPick} onClose={() => {}} />)
    await user.type(screen.getByRole('textbox', { name: 'Data model name' }), 'car{Enter}')
    expect(onPick).toHaveBeenCalledWith({ type: 'entity', name: 'Car_entity' })
  })

  it('lists the system tables with version information and shows missing required tables red', async () => {
    const user = userEvent.setup()
    const history = { columns: ['TABLENAME', 'VERSION', 'LASTUPGRADE', 'USER'], rows: [['ASYS_SYSTEM', '1.0.2', '2021-01-26', 'DB_INIT']], truncated: false, elapsed_ms: 1 }
    const rows = buildRows(['ASYS_SYSTEM', 'ASYS_VERSIONHISTORY'], history)
    expect(rows.find((r) => r.name === 'ASYS_ALIASCONFIG')).toMatchObject({ exists: false, required: true })
    expect(rows.find((r) => r.name === 'ASYS_SYSTEM')).toMatchObject({ version: '1.0.2', user: 'DB_INIT' })
    const api = createMockForgeApi({
      projectTree: [],
      documents: {},
      dbTables: [
        { schema: 's', name: 'ASYS_SYSTEM' },
        { schema: 's', name: 'ASYS_VERSIONHISTORY' },
      ],
      dbResults: { 'SELECT * FROM ASYS_VERSIONHISTORY': history },
    })
    await api.dbConnect('t', 's', null)
    render(<TableCenterDialog api={api} db={{ connected: true, tunnel_up: true, database: 'd', host: 'h' }} onClose={() => {}} />)
    const missing = await screen.findByText('ASYS_ALIASCONFIG')
    expect(missing.className).toContain('is-problem')
    await user.click(screen.getByText('ASYS_SYSTEM'))
    expect(screen.getByLabelText('Table information')).toHaveTextContent('1.0.2')
    expect(screen.getByRole('button', { name: 'Resolve problems' })).toBeDisabled()
  })
})

describe('Shell - menus and toolbar of round 2', () => {
  it('hides a toolbar group through View > Toolbars and brings it back with Reset Toolbars', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    expect(screen.getByRole('button', { name: 'Commit Changed Files' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    await user.click(within(screen.getByRole('menu', { name: 'View' })).getByRole('menuitem', { name: 'Toolbars' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'git' }))
    expect(screen.queryByRole('button', { name: 'Commit Changed Files' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    await user.click(within(screen.getByRole('menu', { name: 'View' })).getByRole('menuitem', { name: 'Toolbars' }))
    await user.click(screen.getByRole('menuitem', { name: 'Reset Toolbars' }))
    expect(screen.getByRole('button', { name: 'Commit Changed Files' })).toBeInTheDocument()
  })

  it('opens the Options dialog on ADITO > General and switches categories', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    await user.click(screen.getByRole('menuitem', { name: 'Tools' }))
    await user.click(within(screen.getByRole('menu', { name: 'Tools' })).getByRole('menuitem', { name: /^Options/ }))
    const dialog = screen.getByRole('dialog', { name: 'Options' })
    const cats = within(dialog).getByRole('tablist', { name: 'Option categories' })
    for (const c of ['General', 'Editor', 'Fonts & Colors', 'Keymap', 'Team', 'Appearance', 'Miscellaneous', 'ADITO', 'iReport']) {
      expect(within(cats).getByRole('tab', { name: new RegExp(c) })).toBeInTheDocument()
    }
    expect(within(dialog).getByLabelText(/ADITO Designer installation/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('tab', { name: /Miscellaneous/ }))
    await user.click(within(dialog).getByRole('tab', { name: 'Janitor' }))
    expect(within(dialog).getByRole('spinbutton', { name: 'Removal threshold' })).toHaveValue(30)
    await user.click(within(dialog).getByRole('tab', { name: /Keymap/ }))
    expect(within(dialog).getByRole('table', { name: 'Shortcuts' })).toHaveTextContent('Ctrl+Shift+U')
  })

  async function openUpdates(api: ReturnType<typeof createMockForgeApi>) {
    const user = userEvent.setup()
    render(<Shell api={api} projectRoot="" />)
    await user.click(screen.getByRole('menuitem', { name: 'Help' }))
    await user.click(within(screen.getByRole('menu', { name: 'Help' })).getByRole('menuitem', { name: 'Check for Updates' }))
    return { user, dialog: screen.getByRole('dialog', { name: 'Check for Updates' }) }
  }

  it('Help > Check for Updates reports a newer version and installs it only after a click', async () => {
    const onInstallUpdate = vi.fn()
    const api = createMockForgeApi({ projectTree: [], documents: {}, update: { version: '1.0.0-rc12', notes: 'Original Git dialogs', date: null }, onInstallUpdate })
    const { user, dialog } = await openUpdates(api)
    await waitFor(() => expect(within(dialog).getByTestId('installed-version')).toHaveTextContent('1.0.0-rc11'))
    expect(onInstallUpdate).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Check for Updates' }))
    expect(await within(dialog).findByText('1.0.0-rc12')).toBeInTheDocument()
    expect(within(dialog).getByText('Original Git dialogs')).toBeInTheDocument()
    expect(onInstallUpdate).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Install and restart' }))
    await waitFor(() => expect(onInstallUpdate).toHaveBeenCalledTimes(1))
  })

  it('Help > Check for Updates says when the version is current and shows a failed check', async () => {
    const current = await openUpdates(createMockForgeApi({ projectTree: [], documents: {} }))
    await current.user.click(within(current.dialog).getByRole('button', { name: 'Check for Updates' }))
    expect(await within(current.dialog).findByText('Dito Designer is up to date.')).toBeInTheDocument()
    cleanup()
    const failed = await openUpdates(createMockForgeApi({ projectTree: [], documents: {}, updateError: 'no access' }))
    await failed.user.click(within(failed.dialog).getByRole('button', { name: 'Check for Updates' }))
    expect(await within(failed.dialog).findByRole('alert')).toHaveTextContent('no access')
  })

  it('the SQL button of the toolbar opens a SQL tab', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    await user.click(screen.getByRole('button', { name: 'Execute SQL' }))
    expect(await screen.findByRole('toolbar', { name: 'SQL toolbar' })).toBeInTheDocument()
  })

  it('setProblems from outside shows up without a scan', () => {
    act(() => setProblems('build', [fromProblemDto({ node_id: 'x', object: 'o', object_type: 't', source: 'parse', severity: 'Error', message: 'boom' }, 'build')]))
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Shell api={api} projectRoot="" />)
    expect(screen.getByRole('contentinfo', { name: 'Status bar' })).toHaveTextContent('1 error')
  })
})

describe('Output log context menu', () => {
  it('opens an own menu instead of the browser menu and clears the log from it', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    const base = { sub: 'build' as const, onSelectSub: () => {}, problems: [], scanning: false, onOpenProblem: () => {}, onRefreshScan: () => {}, refactoring: null, onOpenUsage: () => {}, onDoRefactoring: () => {}, onCloseRefactoring: () => {} }
    const lines = (n: number): OutputLine[] => Array.from({ length: n }, (_, i) => ({ text: `line ${i}`, level: 'info' as const }))
    render(<OutputBody active="output" {...base} onClear={onClear} logs={{ ...EMPTY, build: lines(2) }} />)
    expect(fireEvent.contextMenu(screen.getByText('line 0'))).toBe(false)
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'Clear Log' }))
    expect(onClear).toHaveBeenCalledWith('build')
  })
})
