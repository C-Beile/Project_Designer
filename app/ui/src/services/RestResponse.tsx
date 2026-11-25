import { useMemo, useState } from 'react'
import type { RestResponseDto } from '../wire/types'
import { Button, Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'
import { copyText } from '../core/clipboard'
import { JsonText } from './RestJson'
import { describeJson, formatSize, prettyBody, shortenLongStrings, statusClass, type LoginKind } from './restTools'

type ResTab = 'body' | 'headers' | 'sent'

const STATUS_HINT: Record<number, string> = {
  400: 'The server did not understand the request. Check the parameters and the body.',
  401: 'Not signed in or wrong password.',
  403: 'Signed in, but this user may not call this web service.',
  404: 'No web service or record with this address.',
  405: 'This method is not allowed for this address.',
  409: 'The data conflicts with the current state.',
  415: 'The server does not accept this content type.',
  500: 'The web service failed on the server. The Output of the server has the stack trace.',
  502: 'The server behind the gateway did not answer.',
  503: 'The server is not ready or is being restarted.',
}

export function RestResponse({
  response,
  error,
  loginKind,
  user,
  onChangePassword,
}: {
  response: RestResponseDto | null
  error: string | null
  loginKind: LoginKind
  user: string
  onChangePassword: () => void
}) {
  const [tab, setTab] = useState<ResTab>('body')
  const [wrap, setWrap] = useState(false)
  const [shorten, setShorten] = useState(true)
  const [copied, setCopied] = useState(false)

  const pretty = useMemo(() => (response ? prettyBody(response) : ''), [response])
  const hasLong = useMemo(() => shortenLongStrings(pretty) !== pretty, [pretty])
  const shown = shorten && hasLong ? shortenLongStrings(pretty) : pretty
  const shape = useMemo(() => describeJson(pretty), [pretty])
  const contentType = response?.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]?.split(';')[0] ?? null

  async function copy(text: string) {
    const ok = await copyText(text)
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 1200)
  }

  const tabButton = (id: ResTab, label: string, badge?: number) => (
    <Button variant="bare" className={`rest-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
      {label}
      {badge !== undefined ? <span className="rest-badge">{badge}</span> : null}
    </Button>
  )

  return (
    <div className="rest-res">
      {error ? (
        <p className="rest-error" role="alert">
          {error}
        </p>
      ) : null}
      {response && response.status === 401 && loginKind === 'basic' ? (
        <p className="rest-error" role="alert">
          The server rejected the login of {user === '' ? 'this call' : user}
          {response.headers.find(([k]) => k.toLowerCase() === 'www-authenticate') ? ` (it asks for: ${response.headers.find(([k]) => k.toLowerCase() === 'www-authenticate')?.[1]})` : ''}. If the password is wrong, change it.{' '}
          <Button variant="bare" className="rest-link" onClick={onChangePassword}>
            Change password
          </Button>
        </p>
      ) : null}
      {response ? (
        <>
          <div className="rest-res-bar">
            <span className={`rest-status s-${statusClass(response.status)}`} title={STATUS_HINT[response.status] ?? undefined}>
              {response.status} {response.reason}
            </span>
            <span className="rest-meta">{response.elapsedMs} ms</span>
            <span className="rest-meta">{formatSize(response.size)}</span>
            {contentType ? <span className="rest-meta rest-ctype">{contentType}</span> : null}
            {shape ? <span className="rest-meta rest-shape">{shape}</span> : null}
            <span className="rest-spacer" />
            {tabButton('body', 'Body')}
            {tabButton('headers', 'Headers', response.headers.length)}
            {tabButton('sent', 'Sent request')}
          </div>
          {STATUS_HINT[response.status] && response.status >= 400 && !(response.status === 401 && loginKind === 'basic') ? <p className="rest-hint rest-status-hint">{STATUS_HINT[response.status]}</p> : null}
          {tab === 'body' ? (
            <div className="rest-view-tools" role="group" aria-label="Body view">
              <label className="rest-check" title="Break long lines instead of scrolling sideways">
                <Input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
                <span>Wrap lines</span>
              </label>
              {hasLong ? (
                <label className="rest-check" title="Show long values (Base64 images, documents) cut short. Copy still takes the full text.">
                  <Input type="checkbox" checked={shorten} onChange={(e) => setShorten(e.target.checked)} />
                  <span>Shorten long values</span>
                </label>
              ) : null}
              <span className="rest-spacer" />
              <Button variant="bare" className="rest-copy" onClick={() => void copy(tab === 'body' ? pretty : '')}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : (
            <div className="rest-view-tools">
              <span className="rest-spacer" />
              <Button variant="bare" className="rest-copy" onClick={() => void copy(tab === 'sent' ? response.sent : response.headers.map(([k, v]) => `${k}: ${v}`).join('\n'))}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}
          {tab === 'body' ? (
            <pre className={`rest-code${wrap ? ' is-wrap' : ''}`} aria-label="Response body">
              {response.body === '' ? <span className="rest-nobody">(empty body)</span> : <JsonText text={shown} />}
            </pre>
          ) : tab === 'sent' ? (
            <pre className={`rest-code${wrap ? ' is-wrap' : ''}`} aria-label="Sent request">
              {response.sent}
            </pre>
          ) : (
            <Table className="rest-headers" aria-label="Response headers">
              <TableHeader>
                <TableColumn isRowHeader className="forge-sr-only">
                  Name
                </TableColumn>
                <TableColumn className="forge-sr-only">Value</TableColumn>
              </TableHeader>
              <TableBody>
                {response.headers.map(([k, v], i) => (
                  <TableRow key={i}>
                    <TableCell>{k}</TableCell>
                    <TableCell>{v}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      ) : error ? null : (
        <p className="rest-empty rest-placeholder">Pick a call on the left, check the URL and press Send (Ctrl+Enter).</p>
      )}
    </div>
  )
}
