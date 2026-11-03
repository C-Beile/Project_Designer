// Text editors that can format their document register here under their tab id, so a save can
// format first when "Format on save" is switched on in Tools > Options > Editor > On Save.
const formatters = new Map<string, () => Promise<void>>()

export function registerFormatter(id: string, run: () => Promise<void>): () => void {
  formatters.set(id, run)
  return () => {
    if (formatters.get(id) === run) formatters.delete(id)
  }
}

export async function formatBeforeSave(id: string): Promise<void> {
  try {
    await formatters.get(id)?.()
  } catch {
    // a failing formatter must never block saving
  }
}
