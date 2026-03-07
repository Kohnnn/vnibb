import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import pg from 'pg'
import { Client, Databases, Query } from 'node-appwrite'

const { Client: PgClient } = pg

function getEnv(name, fallback = undefined) {
  const value = process.env[name]
  if (value === undefined || value === null || value === '') return fallback
  return value
}

function getRequiredEnv(name) {
  const value = getEnv(name)
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
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

async function loadSchemaMap(pathLike) {
  const absolutePath = resolve(pathLike)
  const content = await readFile(absolutePath, 'utf8')
  const parsed = JSON.parse(content)
  if (!parsed.collections || !Array.isArray(parsed.collections)) {
    throw new Error('Schema map must include collections array')
  }
  return parsed
}

async function loadBaselineCounts(pathLike) {
  const absolutePath = resolve(pathLike)
  const content = await readFile(absolutePath, 'utf8')
  const parsed = JSON.parse(content)
  const tableCounts = new Map()

  for (const row of parsed?.tables || []) {
    if (!row?.table) continue
    tableCounts.set(String(row.table), Number(row.rowCount ?? 0))
  }

  return { path: absolutePath, tableCounts }
}

async function resolveAppwriteDatabaseId(databases, preferredId) {
  if (preferredId) {
    try {
      await databases.get(preferredId)
      return preferredId
    } catch (err) {
      if (err?.type !== 'database_not_found') throw err
    }
  }

  const dbList = await databases.list()
  if (dbList.total === 0) {
    throw new Error('No Appwrite databases found')
  }
  return dbList.databases[0].$id
}

async function countCollectionDocuments(databases, databaseId, collectionId, pageSize = 100) {
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

function quoteIdentifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`)
  }
  return `"${name}"`
}

async function main() {
  const loadedEnvFile = await loadEnvFile()

  const endpoint = getEnv('APPWRITE_ENDPOINT', getEnv('APPWRITE_URL', 'https://cloud.appwrite.io/v1'))
  const projectId = getEnv('APPWRITE_PROJECT_ID', getEnv('APPWRITE_NAME')) || getRequiredEnv('APPWRITE_PROJECT_ID')
  const apiKey = getEnv('APPWRITE_API_KEY', getEnv('APPWRITE_SECRET')) || getRequiredEnv('APPWRITE_API_KEY')

  const schemaMapPath = getEnv('MIGRATION_SCHEMA_MAP', './scripts/appwrite/schema-map.example.json')
  const schemaMap = await loadSchemaMap(schemaMapPath)

  const verifySourceMode = String(getEnv('VERIFY_SOURCE_MODE', 'live')).toLowerCase()
  if (!['live', 'baseline'].includes(verifySourceMode)) {
    throw new Error(`Invalid VERIFY_SOURCE_MODE='${verifySourceMode}'. Use 'live' or 'baseline'.`)
  }
  const baselineFile = getEnv('VERIFY_BASELINE_FILE', './scripts/appwrite/supabase_baseline.json')
  let baseline = null
  if (verifySourceMode === 'baseline') {
    baseline = await loadBaselineCounts(baselineFile)
  }

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

  let pgClient = null
  if (verifySourceMode === 'live') {
    const supabaseUrl = getEnv('SUPABASE_DATABASE_URL', getEnv('DATABASE_URL_SYNC'))
    if (!supabaseUrl) {
      throw new Error('Set SUPABASE_DATABASE_URL or DATABASE_URL_SYNC for VERIFY_SOURCE_MODE=live')
    }
    pgClient = new PgClient({ connectionString: supabaseUrl })
    await pgClient.connect()
  }

  const appwriteClient = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey)
  const appwriteDatabases = new Databases(appwriteClient)

  const appwriteDatabaseId = await resolveAppwriteDatabaseId(
    appwriteDatabases,
    getEnv('APPWRITE_DATABASE_ID', schemaMap.databaseId || '')
  )

  console.log('--- Supabase vs Appwrite Count Verification ---')
  console.log(`Source mode: ${verifySourceMode}`)
  console.log(`Appwrite database: ${appwriteDatabaseId}`)
  if (baseline) {
    console.log(`Baseline file: ${baseline.path}`)
  }
  if (loadedEnvFile) {
    console.log(`Loaded env from: ${loadedEnvFile}`)
  }

  for (const item of selectedCollections) {
    if (!item.table || !item.collectionId) continue

    let sourceCount = 0
    if (verifySourceMode === 'baseline') {
      const fromBaseline = baseline?.tableCounts.get(item.table)
      if (fromBaseline === undefined) {
        console.log(`SKIP ${item.collectionId}: no baseline count for table '${item.table}'`)
        continue
      }
      sourceCount = Number(fromBaseline)
    } else {
      if (!pgClient) {
        throw new Error('Postgres client is not available for live source verification')
      }
      const tableSql = quoteIdentifier(item.table)
      const countResult = await pgClient.query(`SELECT COUNT(*)::bigint AS count FROM ${tableSql}`)
      sourceCount = Number(countResult.rows[0]?.count ?? 0)
    }

    const targetCount = await countCollectionDocuments(
      appwriteDatabases,
      appwriteDatabaseId,
      item.collectionId,
      250
    )

    const diff = targetCount - sourceCount
    const status = diff === 0 ? 'OK' : 'MISMATCH'

    console.log(
      `${status} ${item.collectionId}: source=${sourceCount}, target=${targetCount}, diff=${diff}`
    )
  }

  if (pgClient) {
    await pgClient.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
