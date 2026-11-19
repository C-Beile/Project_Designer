import { useState } from 'react'
import { Button, Dropdown, Input } from '../core/ui/controls'
import { ListTableDialog, type ListColumn } from './ListTableDialog'
import { emptyLogin, LOGIN_PROPERTY_KEYS, LOGIN_TYPES, propertiesSummary, trimLogins, validateLoginProperties, validateLogins, type LoginEntry, type LoginProperty } from './loginList'

const TYPE_OPTIONS = LOGIN_TYPES.map((t) => ({ id: t, label: t }))

function keyOptions(current: string) {
  const keys = LOGIN_PROPERTY_KEYS.includes(current) || current === '' ? LOGIN_PROPERTY_KEYS : [current, ...LOGIN_PROPERTY_KEYS]
  return keys.map((k) => ({ id: k, label: k }))
}

function newProperty(rows: LoginProperty[]): LoginProperty {
  const used = new Set(rows.map((r) => r.key))
  return { key: LOGIN_PROPERTY_KEYS.find((k) => !used.has(k)) ?? LOGIN_PROPERTY_KEYS[0], value: '' }
}

interface Editing {
  login: LoginEntry
  apply: (properties: LoginProperty[]) => void
}

export function LoginListDialog({ logins, readOnly = false, onOk, onCancel }: { logins: LoginEntry[]; readOnly?: boolean; onOk: (logins: LoginEntry[]) => void; onCancel: () => void }) {
  const [editing, setEditing] = useState<Editing | null>(null)

  const columns: ListColumn<LoginEntry>[] = [
    {
      id: 'name',
      label: 'Name',
      width: '24%',
      cell: (row, change) => <Input className="list-dialog-input" aria-label="Name" value={row.name} readOnly={readOnly} onChange={(e) => change({ name: e.target.value })} />,
    },
    {
      id: 'type',
      label: 'Type',
      width: '22%',
      cell: (row, change) => <Dropdown aria-label="Type" value={row.loginType} options={TYPE_OPTIONS} isDisabled={readOnly} onChange={(loginType) => change({ loginType })} />,
    },
    {
      id: 'title',
      label: 'Title',
      width: '16%',
      cell: (row, change) => <Input className="list-dialog-input" aria-label="Title" value={row.title} readOnly={readOnly} onChange={(e) => change({ title: e.target.value })} />,
    },
    {
      id: 'description',
      label: 'Description',
      width: '18%',
      cell: (row, change) => <Input className="list-dialog-input" aria-label="Description" value={row.description} readOnly={readOnly} onChange={(e) => change({ description: e.target.value })} />,
    },
    {
      id: 'properties',
      label: 'Properties',
      cell: (row, change) => (
        <span className="list-dialog-popup">
          <span className="list-dialog-summary" title={propertiesSummary(row.properties)}>
            {propertiesSummary(row.properties)}
          </span>
          <Button variant="bare" aria-label={`Properties of ${row.name}`} title="Edit the properties of this login" onClick={() => setEditing({ login: row, apply: (properties) => change({ properties }) })}>
            …
          </Button>
        </span>
      ),
    },
  ]

  const propertyColumns: ListColumn<LoginProperty>[] = [
    {
      id: 'key',
      label: 'Key',
      width: '55%',
      cell: (row, change) => <Dropdown aria-label="Key" value={row.key} options={keyOptions(row.key)} isDisabled={readOnly} onChange={(key) => change({ key })} />,
    },
    {
      id: 'value',
      label: 'Value',
      cell: (row, change) => <Input className="list-dialog-input" aria-label="Value" value={row.value} readOnly={readOnly} onChange={(e) => change({ value: e.target.value })} />,
    },
  ]

  return (
    <>
      <ListTableDialog
        title="Login"
        label="Logins"
        rows={logins}
        columns={columns}
        newRow={emptyLogin}
        validate={validateLogins}
        readOnly={readOnly}
        onOk={(rows) => onOk(trimLogins(rows))}
        onCancel={onCancel}
      />
      {editing ? (
        <ListTableDialog
          title={`${editing.login.loginType} Properties`}
          label="Login properties"
          rows={editing.login.properties}
          columns={propertyColumns}
          newRow={newProperty}
          validate={validateLoginProperties}
          readOnly={readOnly}
          onOk={(rows) => {
            editing.apply(rows)
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}
