import type { ForgeApi } from './ForgeApi'
import { logStatement } from '../core/outputBus'

// Wraps the API so that every database statement the app runs shows up in Output > Database, in the
// wording of the original Designer. The reads of the system editor and the deploy preview are
// logged with their real statements; the write transaction of a deploy is logged as one summary
// line because the single INSERT/UPDATE/DELETE statements are built inside the backend.

async function timed<T>(sqls: string[], run: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    const result = await run()
    const ms = performance.now() - started
    for (const sql of sqls) logStatement(sql, [], ms)
    return result
  } catch (e) {
    const ms = performance.now() - started
    for (const sql of sqls) logStatement(sql, [], ms, true)
    throw e
  }
}

export function withSqlLog(api: ForgeApi): ForgeApi {
  return {
    ...api,
    dbQuery: (sql, allowWrite) => timed([sql], () => api.dbQuery(sql, allowWrite)),
    dbSchema: () =>
      timed(["SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = DATABASE()"], () => api.dbSchema()),
    systemUsers: () => timed(["SELECT * FROM ASYS_USERS WHERE GROUPID = 'BASIC' ORDER BY ID"], () => api.systemUsers()),
    systemAliasList: (serverIds) =>
      timed(['SELECT ASYS_ALIASCONFIG.ALIASID, ASYS_ALIASCONFIG.DESCRIPTION, CAST(ASYS_ALIASCONFIG.XMLDATA AS CHAR) FROM ASYS_ALIASCONFIG WHERE ASYS_ALIASCONFIG.SERVERID IN (?)'], () => api.systemAliasList(serverIds)),
    systemAliasConfigs: () => timed(['SELECT * FROM ASYS_ALIASCONFIG'], () => api.systemAliasConfigs()),
    deployPlan: (projectRoot, force, mapping) =>
      timed([`SELECT \`${mapping?.name_column ?? 'ID'}\`, \`${mapping?.content_column ?? 'XMLDATA'}\` FROM \`${mapping?.table ?? 'ASYS_SYSTEM'}\``], () => api.deployPlan(projectRoot, force, mapping)),
    deployShowChanges: (projectRoot, key, mapping) =>
      timed([`SELECT \`${mapping?.content_column ?? 'XMLDATA'}\` FROM \`${mapping?.table ?? 'ASYS_SYSTEM'}\` WHERE \`${mapping?.name_column ?? 'ID'}\` = ?`], () => api.deployShowChanges(projectRoot, key, mapping)),
    deployExecute: (projectRoot, keys, force, mapping, confirmed) =>
      timed([`TRANSACTION ${mapping?.table ?? 'ASYS_SYSTEM'}: ${keys.length} change(s) (INSERT/UPDATE/DELETE)`], () => api.deployExecute(projectRoot, keys, force, mapping, confirmed)),
  }
}
