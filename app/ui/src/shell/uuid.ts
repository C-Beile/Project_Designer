// UUID generator (manual appendix D): a random 36-character UUID for Liquibase files and the like.

export function newUuid(): string {
  return crypto.randomUUID()
}

/** Puts a new UUID on the clipboard and returns the status line to show. */
export async function copyNewUuid(): Promise<string> {
  const id = newUuid()
  try {
    await navigator.clipboard.writeText(id)
    return `UUID copied to the clipboard: ${id}`
  } catch {
    return `UUID (clipboard not available): ${id}`
  }
}
