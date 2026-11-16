import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorTabBar } from '../../src/tabs/EditorTabBar'
import type { EditorTab } from '../../src/tabs/tabModel'
import { _resetAppConfigForTests, configSet } from '../../src/settings/appConfig'

function tab(id: string, objectType = 'entity'): EditorTab {
  return { id, project: 'P', sub: 'editor', node: { id, label: `${id}_entity`, object_type: objectType, is_leaf: true, children: [], kind: 'object' } }
}

function setup(overrides: Partial<Parameters<typeof EditorTabBar>[0]> = {}) {
  const onActivate = vi.fn()
  const onClose = vi.fn()
  const tabs = [tab('a'), tab('b'), tab('c')]
  render(<EditorTabBar tabs={tabs} activeId="b" dirtyIds={new Set()} onActivate={onActivate} onClose={onClose} {...overrides} />)
  return { onActivate, onClose }
}

describe('EditorTabBar', () => {
  afterEach(() => _resetAppConfigForTests())

  it('renders nothing without tabs', () => {
    const { container } = render(<EditorTabBar tabs={[]} activeId={null} dirtyIds={new Set()} onActivate={() => {}} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows one tab per open object, highlights the active one and gives each its type icon', () => {
    setup({ tabs: [tab('a'), tab('b', 'neonView')] })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['a_entity', 'b_entity'])
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveClass('is-active')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    for (const t of tabs) expect(t.querySelector('svg')).not.toBeNull()
  })

  it('switches on click and closes through the close button without switching', async () => {
    const user = userEvent.setup({ delay: null })
    const { onActivate, onClose } = setup()
    await user.click(screen.getByRole('tab', { name: 'c_entity' }))
    expect(onActivate).toHaveBeenCalledWith('c')
    onActivate.mockClear()
    await user.click(screen.getByRole('button', { name: 'Close a_entity' }))
    expect(onClose).toHaveBeenCalledWith('a')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('closes with the middle mouse button but not with the primary one', () => {
    const { onClose } = setup()
    const target = screen.getByRole('tab', { name: 'a_entity' })
    fireEvent.click(target)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent(target, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    expect(onClose).toHaveBeenCalledWith('a')
  })

  it('marks unsaved tabs with a dot and says so in the accessible name', () => {
    setup({ dirtyIds: new Set(['c']) })
    expect(screen.getByRole('tab', { name: 'c_entity (unsaved)' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Unsaved changes' })).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'a_entity' }).querySelector('.forge-tab-dirty')).toBeNull()
  })

  // jsdom has no layout: the strip is 200 wide and tab c reaches out to 300.
  function overflowLayout() {
    configSet(['appearance', 'tabOverflow'], 'dropdown')
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const right = this.classList.contains('forge-tabbar-strip') ? 200 : this.dataset.tabId === 'c' ? 300 : 100
      return { x: 0, y: 0, left: 0, top: 0, bottom: 0, width: right, height: 0, right, toJSON: () => ({}) }
    })
  }

  it('shows no overflow button while every tab fits', () => {
    configSet(['appearance', 'tabOverflow'], 'dropdown')
    setup()
    expect(screen.queryByRole('button', { name: 'Show hidden editors' })).not.toBeInTheDocument()
  })

  it('lists the tabs that do not fit in the overflow menu and switches from there', async () => {
    const spy = overflowLayout()
    const user = userEvent.setup({ delay: null })
    const { onActivate } = setup({ dirtyIds: new Set(['c']) })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show hidden editors' }))
    const items = within(screen.getByRole('menu', { name: 'Open editors' })).getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(['c_entity ●'])
    await user.click(items[0])
    expect(onActivate).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('closes the overflow menu with Escape and on an outside click', async () => {
    const spy = overflowLayout()
    const user = userEvent.setup({ delay: null })
    setup()
    await user.click(screen.getByRole('button', { name: 'Show hidden editors' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show hidden editors' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('moves between tabs with the arrow keys and closes with Delete', async () => {
    const user = userEvent.setup({ delay: null })
    const { onActivate, onClose } = setup()
    screen.getByRole('tab', { name: 'b_entity' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(onActivate).toHaveBeenLastCalledWith('c')
    await user.keyboard('{Home}')
    expect(onActivate).toHaveBeenLastCalledWith('a')
    screen.getByRole('tab', { name: 'b_entity' }).focus()
    await user.keyboard('{Delete}')
    expect(onClose).toHaveBeenCalledWith('b')
  })
})
