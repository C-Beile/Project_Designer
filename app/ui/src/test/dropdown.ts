import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

// Test-Hilfen für `Dropdown` (core/ui/controls): Knopf mit Liste statt `<select>`.

/** Der Knopf der Auswahlliste mit dieser Beschriftung. */
export function dropdown(label: string | RegExp, scope: { getAllByRole: typeof screen.getAllByRole } = screen) {
  const found = scope.getAllByRole('button').filter((b) => b.classList.contains('ui-Dropdown-trigger') && (typeof label === 'string' ? b.getAttribute('data-label') === label : label.test(b.getAttribute('data-label') ?? '')))
  if (found.length !== 1) throw new Error(`Auswahlliste ${String(label)}: ${found.length} Treffer`)
  return found[0]
}

/** Öffnet die Liste und wählt den Eintrag mit diesem Wert (`id`) oder Text. */
export async function choose(user: UserEvent, label: string | RegExp, value: string, scope: { getAllByRole: typeof screen.getAllByRole } = screen) {
  await user.click(dropdown(label, scope))
  const list = await screen.findByRole('listbox')
  const byValue = list.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)
  await user.click(byValue ?? within(list).getByRole('option', { name: value }))
}

/** Der gewählte Wert (`id`) der Auswahlliste. */
export const selected = (label: string | RegExp, scope: { getAllByRole: typeof screen.getAllByRole } = screen) => dropdown(label, scope).getAttribute('data-value')

/** Der gezeigte Text der Auswahlliste. */
export const shown = (label: string | RegExp, scope: { getAllByRole: typeof screen.getAllByRole } = screen) => dropdown(label, scope).textContent ?? ''
