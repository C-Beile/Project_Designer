import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EditorTabBar } from '../../src/tabs/EditorTabBar'
import type { EditorTab } from '../../src/tabs/tabModel'
import { _resetAppConfigForTests, configSet } from '../../src/settings/appConfig'

function tab(id: string, project: string): EditorTab {
  return { id, project, sub: 'editor', node: { id, label: `${id}_entity`, object_type: 'entity', is_leaf: true, children: [], kind: 'object' } }
}

const tabs = [tab('a', 'C:/p/one'), tab('b', 'C:/p/two'), tab('c', 'C:/p/one')]

function open(extra: Partial<Parameters<typeof EditorTabBar>[0]>) {
  render(<EditorTabBar projects={['C:/p/one', 'C:/p/two']} tabs={tabs} activeId="a" dirtyIds={new Set()} onActivate={() => {}} onClose={() => {}} {...extra} />)
}

describe('close all documents of a project', () => {
  afterEach(() => _resetAppConfigForTests())

  it('offers it in the tab menu when several projects are open and closes that project', () => {
    const onCloseProject = vi.fn()
    open({ onCloseProject })
    fireEvent.contextMenu(screen.getAllByRole('tab')[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close All Documents of This Project' }))
    expect(onCloseProject).toHaveBeenCalledWith('C:/p/two')
  })

  it('opens the same menu from the project label above the tabs', () => {
    configSet(['appearance', 'tabGrouping'], 'grouped')
    const onCloseProject = vi.fn()
    open({ onCloseProject })
    fireEvent.contextMenu(screen.getByText('one'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close All Documents of This Project' }))
    expect(onCloseProject).toHaveBeenCalledWith('C:/p/one')
  })

  it('has no such entry with a single project', () => {
    open({ projects: ['C:/p/one'], tabs: [tab('a', 'C:/p/one')], onCloseProject: vi.fn() })
    fireEvent.contextMenu(screen.getByRole('tab'))
    expect(screen.queryByRole('menuitem', { name: 'Close All Documents of This Project' })).toBeNull()
  })
})
