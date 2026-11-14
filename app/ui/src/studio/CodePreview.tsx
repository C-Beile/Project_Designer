import { useEffect, useRef, useState } from 'react'
import { MonacoText, type MonacoTextHandle } from '../tabs/MonacoText'
import { ensureMonacoWorkers } from '../theme/monacoWorkers'

const JAVASCRIPT = `// Adds up all active items
function total(items) {
  const limit = 100
  let sum = 0
  for (const item of items) {
    if (item.active && item.price != null) sum += item.price * 1.2
  }
  return sum > limit ? "over limit" : "ok: " + sum.toFixed(2)
}
`

const SQL = `-- Open orders of the last month
SELECT o.ORDERID, c.NAME, SUM(i.PRICE) AS TOTAL
FROM ORDERS o JOIN CUSTOMER c ON c.CUSTOMERID = o.CUSTOMER_ID
WHERE o.STATUS = 'OPEN' AND o.AMOUNT > 42
GROUP BY o.ORDERID, c.NAME;
`

/** Dieses Fenster startet Monaco selbst: die Web-Worker müssen stehen, bevor der erste Editor entsteht (sonst meldet der Browser ein nacktes Ereignis). */
function useMonacoWorkers(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    const done = () => active && setReady(true)
    ensureMonacoWorkers().then(done, done)
    return () => {
      active = false
    }
  }, [])
  return ready
}

function Sample({ title, text, language }: { title: string; text: string; language: string }) {
  const handle = useRef<MonacoTextHandle | null>(null)
  return (
    <section className="ui-CodePreview-sample">
      <h4>{title}</h4>
      <div className="ui-CodePreview-editor">
        <MonacoText initial={text} language={language} readOnly label={`${title} sample`} onChange={() => {}} handleRef={handle} />
      </div>
    </section>
  )
}

/** Echte Code-Editoren mit Beispieltext. Sie folgen den Code-Farben des Themes, das gerade bearbeitet wird. */
export function CodePreview() {
  const ready = useMonacoWorkers()
  if (!ready) return <p className="ui-Gallery-empty">Loading the code editors…</p>
  return (
    <div className="ui-CodePreview">
      <Sample title="JavaScript" text={JAVASCRIPT} language="javascript" />
      <Sample title="SQL" text={SQL} language="sql" />
    </div>
  )
}
