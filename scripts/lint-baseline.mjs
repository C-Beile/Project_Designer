// Zählt Lint-Warnungen je Regel (ESLint und Stylelint) und vergleicht sie mit app/ui/lint-baseline.json.
// Ohne Argument: prüfen, Exit-Code 1 bei mehr Warnungen als in der Basislinie.
// Mit --update: Basislinie neu schreiben.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ui = join(fileURLToPath(import.meta.url), '..', '..', 'app', 'ui')
const baselinePath = join(ui, 'lint-baseline.json')

function run(args) {
  const command = ['npx', ...args.map((a) => (a.includes('*') ? `"${a}"` : a))].join(' ')
  const result = spawnSync(command, { cwd: ui, encoding: 'utf8', shell: true, maxBuffer: 256 * 1024 * 1024 })
  const json = result.stdout.trim() || result.stderr.trim()
  if (!json.startsWith('[')) throw new Error(`${command}: keine JSON-Ausgabe\n${json.slice(0, 500)}`)
  return JSON.parse(json)
}

function count() {
  const counts = {}
  const add = (rule) => (counts[rule] = (counts[rule] ?? 0) + 1)
  for (const file of run(['eslint', 'src', '-f', 'json'])) for (const m of file.messages) add(`eslint:${m.ruleId ?? 'parse'}`)
  for (const file of run(['stylelint', 'src/**/*.css', '-f', 'json'])) for (const w of file.warnings) add(`stylelint:${w.rule}`)
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

const current = count()
if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n')
  console.log('Basislinie geschrieben:', current)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
let worse = 0
for (const [rule, n] of Object.entries(current)) {
  const allowed = baseline[rule] ?? 0
  if (n > allowed) {
    console.error(`${rule}: ${n} Warnungen (Basislinie ${allowed})`)
    worse++
  }
}
console.log(worse === 0 ? 'Lint ok (nicht schlechter als die Basislinie)' : `${worse} Regeln schlechter`)
process.exit(worse === 0 ? 0 : 1)
