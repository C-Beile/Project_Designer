import { useMemo } from 'react'
import { tokenizeJson } from './restTools'

const MAX_HIGHLIGHT = 200_000

export function JsonText({ text }: { text: string }) {
  const parts = useMemo(() => (text.length > MAX_HIGHLIGHT ? null : tokenizeJson(text)), [text])
  if (!parts) return <>{text}</>
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={`j-${p.kind}`}>
          {p.text}
        </span>
      ))}
    </>
  )
}
