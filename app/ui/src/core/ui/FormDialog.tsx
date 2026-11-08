import { useState } from 'react'
import { Modal } from '../Modal'
import { errorText } from '../errorText'

// Maske "Formular": Felder aus einer Beschreibung, Pflichtfelder, eigene Prüfung, OK/Abbrechen.
// Nutzt die Klassen der vorhandenen Dialoge (forge-field, forge-check, forge-field-error).

export type FormValue = string | number | boolean | null
export type FormValues = Record<string, FormValue>

interface FieldBase {
  id: string
  label: string
  hint?: string
  required?: boolean
  disabled?: boolean
  /** Fehlertext oder null. Läuft bei jeder Eingabe; OK bleibt aus, solange ein Fehler da ist. */
  validate?: (value: FormValue, values: FormValues) => string | null
}

export type FieldDef =
  | (FieldBase & { type: 'text'; placeholder?: string })
  | (FieldBase & { type: 'number'; min?: number; max?: number })
  | (FieldBase & { type: 'select'; options: { value: string; label: string }[] })
  | (FieldBase & { type: 'checkbox' })

export interface FormDialogProps {
  title: string
  fields: FieldDef[]
  /** Startwerte nach Feld-Id. */
  initial?: FormValues
  okLabel?: string
  cancelLabel?: string
  /** Wirft der Aufruf, bleibt der Dialog offen und zeigt die Meldung. */
  onSubmit: (values: FormValues) => void | Promise<void>
  onCancel: () => void
}

function startValue(f: FieldDef, initial: FormValues | undefined): string | boolean {
  const v = initial?.[f.id]
  if (f.type === 'checkbox') return v === true
  if (v === undefined || v === null) return f.type === 'select' ? (f.options[0]?.value ?? '') : ''
  return String(v)
}

/** Wandelt die Eingabe in den Ergebnistyp des Feldes (number: Zahl oder null). */
function result(f: FieldDef, raw: string | boolean): FormValue {
  if (f.type === 'checkbox') return raw === true
  if (f.type === 'number') return raw === '' ? null : Number(raw)
  return raw as string
}

function fieldError(f: FieldDef, raw: string | boolean, values: FormValues): string | null {
  const v = result(f, raw)
  if (f.type === 'number' && v !== null && !Number.isFinite(v)) return 'Not a number.'
  if (f.type === 'number' && typeof v === 'number') {
    if (f.min !== undefined && v < f.min) return `Must be at least ${f.min}.`
    if (f.max !== undefined && v > f.max) return `Must be at most ${f.max}.`
  }
  return f.validate?.(v, values) ?? null
}

function missing(f: FieldDef, raw: string | boolean): boolean {
  if (!f.required) return false
  if (f.type === 'checkbox') return raw !== true
  return typeof raw === 'string' && raw.trim() === ''
}

export function FormDialog({ title, fields, initial, okLabel = 'OK', cancelLabel = 'Cancel', onSubmit, onCancel }: FormDialogProps) {
  const [raw, setRaw] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map((f) => [f.id, startValue(f, initial)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const values: FormValues = Object.fromEntries(fields.map((f) => [f.id, result(f, raw[f.id])]))
  const errors = Object.fromEntries(fields.map((f) => [f.id, fieldError(f, raw[f.id], values)]))
  const valid = fields.every((f) => !errors[f.id] && !missing(f, raw[f.id]))

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(values)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const set = (id: string, v: string | boolean) => setRaw((r) => ({ ...r, [id]: v }))

  return (
    <Modal
      title={title}
      onClose={onCancel}
      onEnter={() => void submit()}
      footer={
        <>
          <button type="button" disabled={!valid || busy} onClick={() => void submit()}>
            {okLabel}
          </button>
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        </>
      }
    >
      <div className="forge-dialog-form">
        {fields.map((f, i) => (
          <div key={f.id}>
            {f.type === 'checkbox' ? (
              <label className="forge-check">
                <input type="checkbox" checked={raw[f.id] === true} disabled={f.disabled} aria-label={f.label} onChange={(e) => set(f.id, e.target.checked)} />
                <span>{f.label}</span>
              </label>
            ) : (
              <label className="forge-field">
                <span>{f.label}</span>
                {f.type === 'select' ? (
                  <select aria-label={f.label} value={raw[f.id] as string} disabled={f.disabled} onChange={(e) => set(f.id, e.target.value)}>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    aria-label={f.label}
                    value={raw[f.id] as string}
                    disabled={f.disabled}
                    autoFocus={i === 0}
                    placeholder={f.type === 'text' ? f.placeholder : undefined}
                    min={f.type === 'number' ? f.min : undefined}
                    max={f.type === 'number' ? f.max : undefined}
                    onChange={(e) => set(f.id, e.target.value)}
                  />
                )}
              </label>
            )}
            {f.hint ? <p className="forge-field-hint">{f.hint}</p> : null}
            {errors[f.id] ? (
              <p className="forge-field-error" role="alert">
                {errors[f.id]}
              </p>
            ) : null}
          </div>
        ))}
        {error ? (
          <p className="forge-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
