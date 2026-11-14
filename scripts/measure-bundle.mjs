// Misst die Größe der gebauten UI (Einstiegsdatei und die größten Teile), roh und gzip.
// Aufruf: cd app/ui && npx vite build && node ../../scripts/measure-bundle.mjs
// Die Zahlen gehören in die Tabelle "Messpunkte" von docs/ui-refactor-plan.md (vorher/nachher).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const dist = join(process.cwd(), 'dist')
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const entry = /src="\/assets\/([^"]+\.js)"/.exec(html)?.[1]

const rows = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => {
    const data = readFileSync(join(dist, 'assets', f))
    return { file: f, kb: statSync(join(dist, 'assets', f)).size / 1024, gzipKb: gzipSync(data).length / 1024 }
  })
  .sort((a, b) => b.kb - a.kb)

const fmt = (n) => `${n.toFixed(1)} kB`.padStart(11)
console.log(`Einstieg: ${entry}`)
for (const r of rows.filter((x) => x.file === entry)) console.log(`  ${fmt(r.kb)} roh, ${fmt(r.gzipKb)} gzip`)
const dialogs = rows.filter((r) => /Dialog|Studio|App-/.test(r.file) && r.file !== entry)
console.log('Dialoge und App (je ein eigener Teil):')
for (const r of dialogs.slice(0, 12)) console.log(`  ${fmt(r.kb)} roh, ${fmt(r.gzipKb)} gzip  ${r.file}`)
console.log(`Alle JS-Dateien: ${rows.length}, zusammen ${fmt(rows.reduce((s, r) => s + r.kb, 0))}`)
