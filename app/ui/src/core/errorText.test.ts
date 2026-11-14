import { describe, expect, it } from 'vitest'
import { errorDetails, errorText } from './errorText'

describe('errorText', () => {
  it('keeps messages of errors and strings', () => {
    expect(errorText(new Error('bad'))).toBe('bad')
    expect(errorText('plain')).toBe('plain')
  })

  it('describes an event instead of [object Event]', () => {
    const script = document.createElement('script')
    script.src = 'http://localhost/x.js'
    const event = new Event('error')
    script.dispatchEvent(event)
    expect(errorText(event)).toContain('"error" on <script src="http://localhost/x.js">')
    expect(errorText(new Event('error'))).not.toContain('[object Event]')
  })

  it('reads the message of an error event and of plain objects', () => {
    expect(errorText(new ErrorEvent('error', { message: 'worker died', filename: 'w.js', lineno: 3, colno: 4 }))).toBe('ErrorEvent "error" on no target - worker died - at w.js:3:4')
    expect(errorText({ message: 'from object' })).toBe('from object')
    expect(errorText({ code: 7 })).toBe('{"code":7}')
  })
})

describe('errorDetails', () => {
  it('adds the stack and the cause of an error', () => {
    const text = errorDetails(new Error('outer', { cause: new Error('inner') }))
    expect(text).toContain('Error: outer')
    expect(text).toContain('Caused by: Error: inner')
  })
})
