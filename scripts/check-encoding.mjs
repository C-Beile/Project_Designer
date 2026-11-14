// Prüft Quelldateien auf gültiges UTF-8 und auf kaputte Umlaute (Mojibake). Exit-Code = Anzahl Fehler.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const folders = ['app/ui/src', 'app/src-tauri/src', 'crates', 'cli', 'scripts', 'docs']
const extensions = new Set(['.ts', '.tsx', '.css', '.rs', '.toml', '.md', '.mjs', '.json', '.ps1'])
const skipped = new Set(['node_modules', 'target', 'dist', 'vendor', '.git'])
const mojibake = /Ã[\u0080-¿]|â€[\u0080-¿™œ]/
const decoder = new TextDecoder('utf-8', { fatal: true })

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (skipped.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (extensions.has(extname(name))) yield path
  }
}

let errors = 0
for (const folder of folders) {
  const start = join(root, folder)
  try {
    statSync(start)
  } catch {
    continue
  }
  for (const path of files(start)) {
    const label = relative(root, path)
    let text
    try {
      text = decoder.decode(readFileSync(path))
    } catch {
      console.error(`${label}: kein gültiges UTF-8`)
      errors++
      continue
    }
    if (mojibake.test(text)) {
      console.error(`${label}: kaputte Umlaute (doppelt kodiert)`)
      errors++
    }
  }
}
console.log(errors === 0 ? 'Kodierung ok' : `${errors} Fehler`)
process.exit(errors)
