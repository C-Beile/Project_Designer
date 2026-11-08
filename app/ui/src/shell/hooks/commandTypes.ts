// Ein Menü-/Toolbar-Befehl; `arg` kommt aus dem Menüeintrag.
export type CommandRun = (arg?: string) => void | Promise<void>
export type CommandMap = Record<string, CommandRun>

// Nur eigene Einträge zählen (kein "constructor" o. ä. aus dem Prototyp).
export function findCommand(map: CommandMap, id: string): CommandRun | undefined {
  return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined
}
