import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import process from 'node:process'
import pg from 'pg'
import { Client as AppwriteClient, Databases, Permission, Query, Role } from 'node-appwrite'

const { Client: PgClient } = pg

function getEnv(name, fallback = undefined) {
  const value = process.env[name]
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  return value
}

function getRequiredEnv(name) {
  const value = getEnv(name)
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseDotEnv(content) {
  const parsed = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const idx = line.indexOf('=')
    if (idx <= 0) continue

    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    parsed[key] = value
  }

  return parsed
}

async function loadEnvFile() {
  const envFile = resolve(getEnv('APPWRITE_ENV_FILE', './apps/api/.env'))
  try {
    const content = await readFile(envFile, 'utf8')
    const parsed = parseDotEnv(content)
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
    return envFile
  } catch {
    return null
  }
}

async function loadMigrationState(pathLike) {
  const absolutePath = resolve(pathLike)
  try {
    const content = await readFile(absolutePath, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') {
      return { path: absolutePath, state: { tables: {} } }
    }
    if (!parsed.tables || typeof parsed.tables !== 'object') {
      parsed.tables = {}
    }
    return { path: absolutePath, state: parsed }
  } catch {
    return { path: absolutePath, state: { tables: {} } }
  }
}

async function saveMigrationState(pathLike, state) {
  const absolutePath = resolve(pathLike)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, JSON.stringify(state, null, 2), 'utf8')
}

function serializeCursor(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  return String(value)
}

function quoteIdentifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`)
  }
  return `"${name}"`
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

function parseIntEnv(name, fallback = 0) {
  return parseIntSafe(getEnv(name, String(fallback)), fallback)
}

function normalizeValue(value, key, precisionColumns, coerceAllToString) {
  if (value === null || value === undefined) return null

  if (value instanceof Date) {
    const iso = value.toISOString()
    return coerceAllToString ? iso : iso
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (Buffer.isBuffer(value)) {
    const raw = value.toString('base64')
    return coerceAllToString ? raw : raw
  }

  if (Array.isArray(value)) {
    if (coerceAllToString) {
      return JSON.stringify(value)
    }
    return value.map(item => normalizeValue(item, key, precisionColumns, coerceAllToString))
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (coerceAllToString || precisionColumns.has(key)) {
      return value.toString()
    }
    return value
  }

  if (typeof value === 'boolean') {
    return coerceAllToString ? String(value) : value
  }

  if (coerceAllToString) {
    return String(value)
  }

  return value
}

function normalizeQueryValue(value, spec) {
  if (value === null || value === undefined) return null

  const type = String(spec.type || 'string').toLowerCase()
  const normalizeMode = String(spec.normalize || '').toLowerCase()

  if (type === 'datetime') {
    if (value instanceof Date) {
      return value.toISOString()
    }

    const raw = String(value).trim()
    if (!raw) return null

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return `${raw}T00:00:00Z`
    }

    const candidate = raw.includes('T') ? raw : raw.replace(' ', 'T')
    const parsed = new Date(candidate)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }

  if (type === 'integer') {
    const parsed = Number.parseInt(String(value), 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (type === 'float') {
    const parsed = Number.parseFloat(String(value))
    return Number.isFinite(parsed) ? parsed : null
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    const raw = String(value).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true
    if (['0', 'false', 'no', 'off'].includes(raw)) return false
    return null
  }

  let text = String(value).trim()
  if (!text) return null

  if (normalizeMode === 'upper') {
    text = text.toUpperCase()
  } else if (normalizeMode === 'lower') {
    text = text.toLowerCase()
  }

  const size = Number.parseInt(String(spec.size ?? 0), 10)
  if (Number.isFinite(size) && size > 0) {
    text = text.slice(0, size)
  }

  return text
}

function buildQueryOverlay(row, queryAttributes) {
  const output = {}

  for (const spec of queryAttributes || []) {
    const key = spec?.key
    if (!key) continue

    const sourceKey = spec.source || key
    output[key] = normalizeQueryValue(row[sourceKey], spec)
  }

  return output
}

function buildDocumentData(row, precisionColumns, coerceAllToString, queryAttributes = []) {
  const output = {}
  for (const [key, value] of Object.entries(row)) {
    output[key] = normalizeValue(value, key, precisionColumns, coerceAllToString)
  }
  Object.assign(output, buildQueryOverlay(row, queryAttributes))
  return output
}

function deterministicDocumentId(collectionId, row, documentIdColumns) {
  const keys = documentIdColumns && documentIdColumns.length > 0 ? documentIdColumns : ['id']
  const raw = keys.map(key => String(row[key] ?? '')).join('|')
  const hash = createHash('sha1').update(`${collectionId}|${raw}`).digest('hex')
  const prefix = collectionId.replace(/[^A-Za-z0-9_\-.]/g, '').slice(0, 10) || 'doc'
  return `${prefix}_${hash.slice(0, 24)}`
}

function buildPermissions(collectionConfig, row) {
  const mode = collectionConfig.permissionsMode || 'collectionDefault'

  if (mode === 'publicRead') {
    return [Permission.read(Role.any())]
  }

  if (mode === 'ownerReadWrite') {
    const ownerField = collectionConfig.ownerField || 'user_id'
    const ownerId = row[ownerField]
    if (!ownerId) {
      return undefined
    }
    const ownerRole = Role.user(String(ownerId))
    return [
      Permission.read(ownerRole),
      Permission.update(ownerRole),
      Permission.delete(ownerRole)
    ]
  }

  return undefined
}

function isDocumentAlreadyExistsError(err) {
  if (!err) return false
  if (err.code === 409) return true
  if (typeof err.type === 'string' && err.type.includes('document_already_exists')) return true
  if (typeof err.message === 'string' && err.message.toLowerCase().includes('already exists')) return true
  return false
}

function isRetriableError(err) {
  if (!err) return false
  if (typeof err.code === 'number' && [408, 425, 429, 500, 502, 503, 504].includes(err.code)) {
    return true
  }
  const message = String(err.message || '').toLowerCase()
  return (
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('rate limit')
  )
}

async function withRetries(fn, maxAttempts = 3, baseDelayMs = 250) {
  let attempt = 0
  let lastError = null

  while (attempt < maxAttempts) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      attempt += 1

      if (attempt >= maxAttempts || !isRetriableError(err)) {
        throw err
      }

      const waitMs = baseDelayMs * Math.pow(2, attempt - 1)
      await sleep(waitMs)
    }
  }

  throw lastError || new Error('Unknown retry failure')
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = []
  let cursor = 0

  async function runner() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }

  const runners = []
  const safeConcurrency = Math.max(1, concurrency)
  for (let i = 0; i < safeConcurrency; i += 1) {
    runners.push(runner())
  }

  await Promise.all(runners)
  return results
}

async function countCollectionDocuments(databases, databaseId, collectionId, pageSize = 250) {
  let count = 0
  let cursorAfter = null

  while (true) {
    const queries = [Query.limit(pageSize), Query.select(['$id'])]
    if (cursorAfter) {
      queries.push(Query.cursorAfter(cursorAfter))
    }

    const page = await databases.listDocuments(databaseId, collectionId, queries)
    const docs = page.documents || []
    if (docs.length === 0) {
      break
    }

    count += docs.length
    cursorAfter = docs[docs.length - 1].$id

    if (docs.length < pageSize) {
      break
    }
  }

  return count
}

async function loadSchemaMap(pathLike) {
  const absolutePath = resolve(pathLike)
  const content = await readFile(absolutePath, 'utf8')
  const parsed = JSON.parse(content)
  if (!parsed.collections || !Array.isArray(parsed.collections)) {
    throw new Error('Schema map must include a collections array')
  }
  return parsed
}

async function resolveAppwriteDatabaseId(databases, preferredId) {
  if (preferredId) {
    try {
      await databases.get(preferredId)
      return preferredId
    } catch (err) {
      if (err?.type !== 'database_not_found') {
        throw err
      }
    }
  }

  const databaseList = await databases.list()
  if (databaseList.total === 0) {
    throw new Error('No Appwrite databases found. Create a database first and rerun.')
  }

  return databaseList.databases[0].$id
}

async function main() {
  const loadedEnvFile = await loadEnvFile()

  const supabaseUrl = getEnv('SUPABASE_DATABASE_URL', getEnv('DATABASE_URL_SYNC'))
  if (!supabaseUrl) {
    throw new Error('Set SUPABASE_DATABASE_URL or DATABASE_URL_SYNC')
  }

  const dryRun = parseBool(getEnv('MIGRATION_DRY_RUN', 'true'), true)

  const appwriteEndpoint = dryRun
    ? getEnv('APPWRITE_ENDPOINT', getEnv('APPWRITE_URL', 'https://cloud.appwrite.io/v1'))
    : getEnv('APPWRITE_ENDPOINT', getEnv('APPWRITE_URL', 'https://cloud.appwrite.io/v1'))
  const appwriteProjectId = dryRun
    ? getEnv('APPWRITE_PROJECT_ID', getEnv('APPWRITE_NAME', ''))
    : getEnv('APPWRITE_PROJECT_ID', getEnv('APPWRITE_NAME')) || getRequiredEnv('APPWRITE_PROJECT_ID')
  const appwriteApiKey = dryRun
    ? getEnv('APPWRITE_API_KEY', getEnv('APPWRITE_SECRET', ''))
    : getEnv('APPWRITE_API_KEY', getEnv('APPWRITE_SECRET')) || getRequiredEnv('APPWRITE_API_KEY')

  const schemaMapPath = getEnv('MIGRATION_SCHEMA_MAP', './scripts/appwrite/schema-map.example.json')
  const paginationMode = String(getEnv('MIGRATION_PAGINATION_MODE', 'keyset')).toLowerCase()
  if (!['keyset', 'offset'].includes(paginationMode)) {
    throw new Error(`Invalid MIGRATION_PAGINATION_MODE='${paginationMode}'. Use 'keyset' or 'offset'.`)
  }

  const resumeState = parseBool(getEnv('MIGRATION_RESUME', 'true'), true)
  const resetState = parseBool(getEnv('MIGRATION_RESET_STATE', 'false'), false)
  const snapshotUpperBound = parseBool(getEnv('MIGRATION_SNAPSHOT_UPPER_BOUND', 'true'), true)
  const bootstrapCursorFromTargetCount = parseBool(
    getEnv('MIGRATION_BOOTSTRAP_CURSOR_FROM_TARGET_COUNT', 'false'),
    false,
  )
  const stateFile = getEnv('MIGRATION_STATE_FILE', './scripts/appwrite/migration_state.json')

  const defaultBatchSize = parseIntSafe(getEnv('MIGRATION_BATCH_SIZE', '500'), 500)
  const concurrency = parseIntSafe(getEnv('MIGRATION_CONCURRENCY', '5'), 5)
  const throttleMs = parseIntSafe(getEnv('MIGRATION_THROTTLE_MS', '0'), 0)
  const startOffset = parseIntEnv('MIGRATION_START_OFFSET', 0)
  const startCursor = getEnv('MIGRATION_START_CURSOR', '')
  const maxRows = parseIntEnv('MIGRATION_MAX_ROWS', 0)
  const coerceAllToString = parseBool(getEnv('MIGRATION_COERCE_ALL_TO_STRING', 'false'), false)

  const schemaMap = await loadSchemaMap(schemaMapPath)
  const tableFilterRaw = getEnv('MIGRATION_TABLES', '')
  const tableFilter = new Set(
    tableFilterRaw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )

  const selectedCollections = schemaMap.collections.filter(item => {
    if (tableFilter.size === 0) return true
    return tableFilter.has(item.table) || tableFilter.has(item.collectionId)
  })

  if (selectedCollections.length === 0) {
    throw new Error(
      `No collections selected. Check MIGRATION_TABLES='${tableFilterRaw}' against schema map entries.`
    )
  }
  const configuredAppwriteDatabaseId = getEnv('APPWRITE_DATABASE_ID', schemaMap.databaseId || '')
  const { path: resolvedStatePath, state: migrationState } = await loadMigrationState(stateFile)

  const pgClient = new PgClient({ connectionString: supabaseUrl })

  let appwriteDatabases = null
  let resolvedAppwriteDatabaseId = configuredAppwriteDatabaseId
  if (!dryRun) {
    const appwriteClient = new AppwriteClient()
      .setEndpoint(appwriteEndpoint)
      .setProject(appwriteProjectId)
      .setKey(appwriteApiKey)
    appwriteDatabases = new Databases(appwriteClient)
    resolvedAppwriteDatabaseId = await resolveAppwriteDatabaseId(
      appwriteDatabases,
      configuredAppwriteDatabaseId
    )
  } else if (!resolvedAppwriteDatabaseId) {
    resolvedAppwriteDatabaseId = 'unresolved-dry-run'
  }

  await pgClient.connect()

  console.log('--- VNIBB Supabase -> Appwrite Migration ---')
  console.log(`Dry run: ${dryRun}`)
  console.log(`Schema map: ${schemaMapPath}`)
  console.log(`Appwrite database: ${resolvedAppwriteDatabaseId}`)
  console.log(`Pagination mode: ${paginationMode}`)
  console.log(`State resume: ${resumeState}`)
  console.log(`State file: ${resolvedStatePath}`)
  console.log(`Snapshot upper bound: ${snapshotUpperBound}`)
  console.log(`Bootstrap cursor from target count: ${bootstrapCursorFromTargetCount}`)
  console.log(`Coerce all values to string: ${coerceAllToString}`)
  if (tableFilter.size > 0) {
    console.log(`Filtered tables/collections: ${Array.from(tableFilter).join(', ')}`)
  }
  console.log(`Selected collections: ${selectedCollections.length}`)
  if (startOffset > 0 || maxRows > 0) {
    console.log(`Windowing: startOffset=${startOffset}, maxRows=${maxRows}`)
  }
  if (paginationMode === 'keyset' && startOffset > 0) {
    console.log('Note: MIGRATION_START_OFFSET is ignored in keyset mode; use MIGRATION_START_CURSOR instead.')
  }
  if (startCursor) {
    console.log(`Windowing: startCursor=${startCursor}`)
  }
  if (loadedEnvFile) {
    console.log(`Loaded env from: ${loadedEnvFile}`)
  }

  const globalStats = {
    collections: 0,
    rowsRead: 0,
    created: 0,
    updated: 0,
    failed: 0
  }

  for (const collectionConfig of selectedCollections) {
    const tableName = collectionConfig.table
    const collectionId = collectionConfig.collectionId
    const cursorColumn = collectionConfig.cursorColumn || 'id'
    const batchSize = collectionConfig.batchSize || defaultBatchSize
    const documentIdColumns = collectionConfig.documentIdColumns || ['id']
    const precisionColumns = new Set(collectionConfig.precisionColumns || [])
    const queryAttributes = Array.isArray(collectionConfig.queryAttributes)
      ? collectionConfig.queryAttributes
      : []

    if (!tableName || !collectionId) {
      throw new Error('Each collection config needs table and collectionId')
    }

    const tableSql = quoteIdentifier(tableName)
    const cursorSql = quoteIdentifier(cursorColumn)

    const countQuery = `SELECT COUNT(*)::bigint AS count FROM ${tableSql}`
    const countResult = await pgClient.query(countQuery)
    const totalRows = Number(countResult.rows[0]?.count ?? 0)

    console.log(`\n[${collectionId}] table=${tableName} rows=${totalRows}`)

    const stats = {
      read: 0,
      created: 0,
      updated: 0,
      failed: 0
    }

    const tableStateKey = tableName
    if (resetState) {
      delete migrationState.tables[tableStateKey]
    }
    const tableState = migrationState.tables[tableStateKey] || {}
    migrationState.tables[tableStateKey] = tableState
    tableState.table = tableName
    tableState.collectionId = collectionId
    tableState.cursorColumn = cursorColumn
    tableState.paginationMode = paginationMode

    const processRows = async (rows) => {
      stats.read += rows.length

      await runWithConcurrency(rows, concurrency, async row => {
        const documentData = buildDocumentData(
          row,
          precisionColumns,
          coerceAllToString,
          queryAttributes
        )
        const documentId = deterministicDocumentId(collectionId, row, documentIdColumns)
        const permissions = buildPermissions(collectionConfig, row)

        if (dryRun) {
          return
        }

        if (!appwriteDatabases) {
          throw new Error('Appwrite client is not initialized')
        }

        try {
          await withRetries(() => appwriteDatabases.createDocument(
            resolvedAppwriteDatabaseId,
            collectionId,
            documentId,
            documentData,
            permissions
          ))
          stats.created += 1
        } catch (err) {
          if (isDocumentAlreadyExistsError(err)) {
            try {
              await withRetries(() => appwriteDatabases.updateDocument(
                resolvedAppwriteDatabaseId,
                collectionId,
                documentId,
                documentData,
                permissions
              ))
              stats.updated += 1
            } catch (updateErr) {
              stats.failed += 1
              console.error(
                `[${collectionId}] update failed id=${documentId}: ${updateErr?.message || updateErr}`
              )
            }
          } else {
            stats.failed += 1
            console.error(`[${collectionId}] create failed id=${documentId}: ${err?.message || err}`)
          }
        }

        if (throttleMs > 0) {
          await sleep(throttleMs)
        }
      })
    }

    if (paginationMode === 'offset') {
      let offset = Math.max(0, startOffset)
      const targetEnd = maxRows > 0 ? Math.min(totalRows, offset + maxRows) : totalRows

      while (offset < targetEnd) {
        const selectSql = `SELECT * FROM ${tableSql} ORDER BY ${cursorSql} ASC LIMIT $1 OFFSET $2`
        const result = await pgClient.query(selectSql, [batchSize, offset])
        const rows = result.rows
        if (rows.length === 0) break

        await processRows(rows)

        offset += rows.length
        tableState.lastOffset = offset
        tableState.updatedAt = new Date().toISOString()
        await saveMigrationState(resolvedStatePath, migrationState)

        console.log(
          `[${collectionId}] progress ${Math.min(offset, targetEnd)}/${targetEnd}` +
            ` created=${stats.created} updated=${stats.updated} failed=${stats.failed}`
        )
      }
    } else {
      let lastCursor = null
      if (startCursor) {
        lastCursor = startCursor
      } else if (resumeState && tableState.lastCursor) {
        lastCursor = tableState.lastCursor
      }

      let upperBound = null
      if (snapshotUpperBound) {
        if (resumeState && tableState.upperBound) {
          upperBound = tableState.upperBound
        } else {
          const maxCursorResult = await pgClient.query(`SELECT MAX(${cursorSql}) AS max_cursor FROM ${tableSql}`)
          upperBound = serializeCursor(maxCursorResult.rows[0]?.max_cursor)
          tableState.upperBound = upperBound
        }
      }

      if (
        bootstrapCursorFromTargetCount &&
        !lastCursor &&
        !dryRun &&
        appwriteDatabases
      ) {
        const targetCount = await countCollectionDocuments(
          appwriteDatabases,
          resolvedAppwriteDatabaseId,
          collectionId,
          250,
        )

        if (targetCount > 0) {
          const sourceOffset = Math.max(0, targetCount - 1)
          const params = []
          let whereSql = ''

          if (upperBound !== null && upperBound !== undefined && String(upperBound) !== '') {
            params.push(upperBound)
            whereSql = ` WHERE ${cursorSql} <= $${params.length}`
          }

          params.push(sourceOffset)
          const offsetParamIndex = params.length

          const bootstrapSql =
            `SELECT ${cursorSql} AS cursor_value FROM ${tableSql}${whereSql}` +
            ` ORDER BY ${cursorSql} ASC LIMIT 1 OFFSET $${offsetParamIndex}`
          const bootstrapResult = await pgClient.query(bootstrapSql, params)
          const bootstrapCursorValue = bootstrapResult.rows[0]?.cursor_value

          if (bootstrapCursorValue !== null && bootstrapCursorValue !== undefined) {
            lastCursor = serializeCursor(bootstrapCursorValue)
            tableState.lastCursor = lastCursor
            tableState.bootstrapFromTargetCount = targetCount
            console.log(
              `[${collectionId}] bootstrapped cursor from targetCount=${targetCount}, lastCursor=${lastCursor}`,
            )
          }
        }
      }

      if (lastCursor) {
        tableState.lastCursor = lastCursor
      }

      let processedThisRun = 0

      while (true) {
        if (maxRows > 0 && processedThisRun >= maxRows) {
          break
        }

        const currentBatchSize = maxRows > 0
          ? Math.min(batchSize, maxRows - processedThisRun)
          : batchSize
        if (currentBatchSize <= 0) {
          break
        }

        const params = []
        let whereSql = ''

        if (lastCursor !== null && lastCursor !== undefined && String(lastCursor) !== '') {
          params.push(lastCursor)
          whereSql = ` WHERE ${cursorSql} > $${params.length}`
        }

        if (upperBound !== null && upperBound !== undefined && String(upperBound) !== '') {
          params.push(upperBound)
          whereSql += whereSql ? ` AND ${cursorSql} <= $${params.length}` : ` WHERE ${cursorSql} <= $${params.length}`
        }

        params.push(currentBatchSize)
        const selectSql = `SELECT * FROM ${tableSql}${whereSql} ORDER BY ${cursorSql} ASC LIMIT $${params.length}`
        const result = await pgClient.query(selectSql, params)
        const rows = result.rows
        if (rows.length === 0) {
          break
        }

        await processRows(rows)

        processedThisRun += rows.length
        lastCursor = serializeCursor(rows[rows.length - 1]?.[cursorColumn])
        tableState.lastCursor = lastCursor
        tableState.updatedAt = new Date().toISOString()
        tableState.lastRunRows = processedThisRun
        tableState.finished = false
        await saveMigrationState(resolvedStatePath, migrationState)

        const cursorStatus = upperBound
          ? `${lastCursor}/${upperBound}`
          : String(lastCursor)
        console.log(
          `[${collectionId}] progress cursor=${cursorStatus}` +
            ` created=${stats.created} updated=${stats.updated} failed=${stats.failed}`
        )
      }

      if (snapshotUpperBound && upperBound) {
        const remParams = []
        let remWhereSql = ''
        if (lastCursor !== null && lastCursor !== undefined && String(lastCursor) !== '') {
          remParams.push(lastCursor)
          remWhereSql = ` WHERE ${cursorSql} > $${remParams.length}`
        }
        remParams.push(upperBound)
        remWhereSql += remWhereSql ? ` AND ${cursorSql} <= $${remParams.length}` : ` WHERE ${cursorSql} <= $${remParams.length}`

        const remSql = `SELECT COUNT(*)::bigint AS count FROM ${tableSql}${remWhereSql}`
        const remResult = await pgClient.query(remSql, remParams)
        const remainingRows = Number(remResult.rows[0]?.count ?? 0)
        tableState.finished = remainingRows === 0
        tableState.remainingRows = remainingRows
      }

      tableState.updatedAt = new Date().toISOString()
      await saveMigrationState(resolvedStatePath, migrationState)
    }

    console.log(
      `[${collectionId}] done read=${stats.read} created=${stats.created}` +
        ` updated=${stats.updated} failed=${stats.failed}`
    )

    globalStats.collections += 1
    globalStats.rowsRead += stats.read
    globalStats.created += stats.created
    globalStats.updated += stats.updated
    globalStats.failed += stats.failed
  }

  await pgClient.end()

  console.log('\n--- Migration Summary ---')
  console.log(JSON.stringify(globalStats, null, 2))
  console.log(`Migration state saved: ${resolvedStatePath}`)
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
