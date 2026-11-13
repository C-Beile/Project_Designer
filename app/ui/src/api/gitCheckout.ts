// Branch-Wechsel mit lokalen Änderungen im Weg. Git verweigert ihn ("would be overwritten by checkout");
// ein Handler des Git-Plugins fragt den Benutzer (stash / discard / abbrechen) und der Wechsel läuft mit
// der Wahl erneut. Ohne Handler bleibt das Ergebnis von Git unverändert.

import type { GitOutput } from '../wire/types'

export type CheckoutMode = 'stash' | 'discard'

/** Fragt den Benutzer; null = abbrechen. */
/** `switch`: Branch-Wechsel (stash, discard); `pull`: Pull (nur stash). */
export type ConflictKind = 'switch' | 'pull'

export type CheckoutConflictHandler = (ctx: { kind: ConflictKind; branch: string; message: string }) => Promise<CheckoutMode | null>

let handler: CheckoutConflictHandler | null = null

export function setCheckoutConflictHandler(h: CheckoutConflictHandler): () => void {
  handler = h
  return () => {
    if (handler === h) handler = null
  }
}

const CONFLICT = /would be overwritten by (checkout|merge)|please commit your changes or stash them|please commit or stash them|you have unstaged changes|cannot pull with rebase|your index contains uncommitted changes/i

/** Git verweigert den Wechsel wegen lokaler Änderungen oder Dateien im Weg. */
export function isCheckoutConflict(text: string): boolean {
  return CONFLICT.test(text)
}

/** Führt den Wechsel aus; bei einem Konflikt fragt der Handler und `call` läuft einmal mit der Wahl erneut. */
export async function withCheckoutChoice(branch: string, call: (mode?: CheckoutMode) => Promise<GitOutput>, kind: ConflictKind = 'switch'): Promise<GitOutput> {
  const first = await call()
  if (first.ok || !handler || !isCheckoutConflict(first.text)) return first
  const mode = await handler({ kind, branch, message: first.text })
  return mode ? call(mode) : first
}
