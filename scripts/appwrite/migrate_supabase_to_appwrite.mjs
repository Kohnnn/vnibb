import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import process from 'node:process'
import pg from 'pg'
import { Client as AppwriteClient, Databases, Permission, Role } from 'node-appwrite'

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

function quoteIdentifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`)
  }
  return `"${name}"`
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

function normalizeValue(value, key, precisionColumns) {
  if (value === null || value === undefined) return null

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64')
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(item, key, precisionColumns))
  }

  if (typeof value === 'object') {
    const out = {}
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      out[nestedKey] = normalizeValue(nestedValue, nestedKey, precisionColumns)
    }
    return out
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (precisionColumns.has(key)) {
      return value.toString()
    }
    return value
  }

  return value
}

function buildDocumentData(row, precisionColumns) {
  const output = {}
  for (const [key, value] of Object.entries(row)) {
    output[key] = normalizeValue(value, key, precisionColumns)
  }
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

async function loadSchemaMap(pathLike) {
  const absolutePath = resolve(pathLike)
  const content = await readFile(absolutePath, 'utf8')
  const parsed = JSON.parse(content)
  if (!parsed.collections || !Array.isArray(parsed.collections)) {
    throw new Error('Schema map must include a collections array')
  }
  return parsed
}

async function main() {
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
  const defaultBatchSize = parseIntSafe(getEnv('MIGRATION_BATCH_SIZE', '500'), 500)
  const concurrency = parseIntSafe(getEnv('MIGRATION_CONCURRENCY', '5'), 5)
  const throttleMs = parseIntSafe(getEnv('MIGRATION_THROTTLE_MS', '0'), 0)

  const schemaMap = await loadSchemaMap(schemaMapPath)
  const appwriteDatabaseId = getEnv('APPWRITE_DATABASE_ID', schemaMap.databaseId)
  if (!appwriteDatabaseId) {
    throw new Error('Set APPWRITE_DATABASE_ID or databaseId in schema map')
  }

  const pgClient = new PgClient({ connectionString: supabaseUrl })

  let appwriteDatabases = null
  if (!dryRun) {
    const appwriteClient = new AppwriteClient()
      .setEndpoint(appwriteEndpoint)
      .setProject(appwriteProjectId)
      .setKey(appwriteApiKey)
    appwriteDatabases = new Databases(appwriteClient)
  }

  await pgClient.connect()

  console.log('--- VNIBB Supabase -> Appwrite Migration ---')
  console.log(`Dry run: ${dryRun}`)
  console.log(`Schema map: ${schemaMapPath}`)
  console.log(`Appwrite database: ${appwriteDatabaseId}`)

  const globalStats = {
    collections: 0,
    rowsRead: 0,
    created: 0,
    updated: 0,
    failed: 0
  }

  for (const collectionConfig of schemaMap.collections) {
    const tableName = collectionConfig.table
    const collectionId = collectionConfig.collectionId
    const cursorColumn = collectionConfig.cursorColumn || 'id'
    const batchSize = collectionConfig.batchSize || defaultBatchSize
    const documentIdColumns = collectionConfig.documentIdColumns || ['id']
    const precisionColumns = new Set(collectionConfig.precisionColumns || [])

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

    let offset = 0
    while (offset < totalRows) {
      const selectSql = `SELECT * FROM ${tableSql} ORDER BY ${cursorSql} ASC LIMIT $1 OFFSET $2`
      const result = await pgClient.query(selectSql, [batchSize, offset])
      const rows = result.rows
      if (rows.length === 0) break

      stats.read += rows.length

      await runWithConcurrency(rows, concurrency, async row => {
        const documentData = buildDocumentData(row, precisionColumns)
        const documentId = deterministicDocumentId(collectionId, row, documentIdColumns)
        const permissions = buildPermissions(collectionConfig, row)

        if (dryRun) {
          return
        }

        if (!appwriteDatabases) {
          throw new Error('Appwrite client is not initialized')
        }

        try {
          await appwriteDatabases.createDocument(
            appwriteDatabaseId,
            collectionId,
            documentId,
            documentData,
            permissions
          )
          stats.created += 1
        } catch (err) {
          if (isDocumentAlreadyExistsError(err)) {
            try {
              await appwriteDatabases.updateDocument(
                appwriteDatabaseId,
                collectionId,
                documentId,
                documentData,
                permissions
              )
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

      offset += rows.length
      console.log(
        `[${collectionId}] progress ${Math.min(offset, totalRows)}/${totalRows}` +
          ` created=${stats.created} updated=${stats.updated} failed=${stats.failed}`
      )
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
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
