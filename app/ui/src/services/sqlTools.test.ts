import { describe, expect, it } from 'vitest'
import { buildDelete, buildInsert, buildUpdate, editableTable, matchesFilter, splitStatements, sqlLiteral, statementAt, toCsv } from './sqlTools'

describe('splitStatements', () => {
  it('splits on semicolons outside quotes and comments and drops empty parts', () => {
    const sql = "select 'a;b' from t; -- trailing; comment\n/* x; y */ delete from u where n = \"p;q\";;\n"
    expect(splitStatements(sql).map((s) => s.text)).toEqual(["select 'a;b' from t", '-- trailing; comment\n/* x; y */ delete from u where n = "p;q"'])
  })

  it('finds the statement under the cursor', () => {
    const sql = 'select 1;\nselect 2;\nselect 3'
    expect(statementAt(sql, 12)?.text).toBe('select 2')
    expect(statementAt(sql, sql.length)?.text).toBe('select 3')
    expect(statementAt('', 0)).toBeNull()
  })
})

describe('result helpers', () => {
  it('exports CSV with quoting and empty cells for NULL', () => {
    expect(toCsv(['A', 'B'], [['x;y', null], ['he said "hi"', '2']])).toBe('A;B\r\n"x;y";\r\n"he said ""hi""";2\r\n')
  })

  it('filters rows over all columns, case-insensitively', () => {
    expect(matchesFilter(['Alpha', null], 'alp')).toBe(true)
    expect(matchesFilter(['Alpha', null], 'zzz')).toBe(false)
    expect(matchesFilter([null], '')).toBe(true)
  })
})

describe('grid statements', () => {
  it('only plain selects of one table are editable', () => {
    expect(editableTable('select * from ASYS_SYSTEM')).toBe('ASYS_SYSTEM')
    expect(editableTable('SELECT a FROM t WHERE a = 1')).toBe('t')
    expect(editableTable('select * from a join b on 1=1')).toBeNull()
    expect(editableTable('delete from t')).toBeNull()
  })

  it('escapes literals and identifies the row by its whole original content', () => {
    expect(sqlLiteral("it's \\ ok")).toBe("'it''s \\\\ ok'")
    expect(buildUpdate('t', ['ID', 'NAME'], ['1', null], ['1', 'x'])).toBe("UPDATE t SET `NAME` = 'x' WHERE `ID` = '1' AND `NAME` IS NULL LIMIT 1")
    expect(buildUpdate('t', ['ID'], ['1'], ['1'])).toBeNull()
    expect(buildDelete('t', ['ID'], ['1'])).toBe("DELETE FROM t WHERE `ID` = '1' LIMIT 1")
    expect(buildInsert('t', ['ID', 'NAME'], ['1', null])).toBe("INSERT INTO t (`ID`, `NAME`) VALUES ('1', NULL)")
  })
})
