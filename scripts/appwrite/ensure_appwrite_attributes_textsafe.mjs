import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import pg from 'pg'
import { Client, Databases } from 'node-appwrite'

const { Client: PgClient } = pg

function getEnv(name, fallback = undefined) {
  const value = process.env[name]
  if (value === undefined || value === null || value === '') return fallback
  return value
}

function getRequiredEnv(name) {
  const value = getEnv(name)
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
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

function normalizeColumnKey(columnName) {
  // Appwrite attribute keys must be <= 36 chars.
  return String(columnName).slice(0, 36)
}

async function getResolvedDatabaseId(databases, preferredId) {
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

  const dbList = await databases.list()
  if (dbList.total === 0) {
    throw new Error('No Appwrite databases found. Create a database first and rerun.')
  }

  return dbList.databases[0].$id
}

async function main() {
  const loadedEnvFile = await loadEnvFile()

  const supabaseUrl = getEnv('SUPABASE_DATABASE_URL', getEnv('DATABASE_URL_SYNC'))
  if (!supabaseUrl) {
    throw new Error('Set SUPABASE_DATABASE_URL or DATABASE_URL_SYNC')
  }

  const endpoint = getEnv('APPWRITE_ENDPOINT', getEnv('APPWRITE_URL', 'https://cloud.appwrite.io/v1'))
  const projectId = getEnv('APPWRITE_PROJECT_ID', getEnv('APPWRITE_NAME')) || getRequiredEnv('APPWRITE_PROJECT_ID')
  const apiKey = getEnv('APPWRITE_API_KEY', getEnv('APPWRITE_SECRET')) || getRequiredEnv('APPWRITE_API_KEY')

  const schemaMapPath = getEnv('MIGRATION_SCHEMA_MAP', './scripts/appwrite/schema-map.example.json')
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

  const pgClient = new PgClient({ connectionString: supabaseUrl })
  await pgClient.connect()

  const appwriteClient = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey)
  const databases = new Databases(appwriteClient)

  const databaseId = await getResolvedDatabaseId(
    databases,
    getEnv('APPWRITE_DATABASE_ID', schemaMap.databaseId || '')
  )

  let createdAttributes = 0
  let skippedAttributes = 0

  for (const item of selectedCollections) {
    const tableName = item.table
    const collectionId = item.collectionId
    if (!tableName || !collectionId) {
      continue
    }

    const columnsResult = await pgClient.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    )

    if (columnsResult.rows.length === 0) {
      console.log(`[skip] ${collectionId} has no matching source columns`)
      continue
    }

    const existing = await databases.listAttributes(databaseId, collectionId)
    const existingKeys = new Set(existing.attributes.map(attr => attr.key))

    for (const row of columnsResult.rows) {
      const sourceKey = row.column_name
      const key = normalizeColumnKey(sourceKey)

      if (existingKeys.has(key)) {
        skippedAttributes += 1
        continue
      }

      await databases.createLongtextAttribute({
        databaseId,
        collectionId,
        key,
        required: false,
        array: false,
      })

      createdAttributes += 1
      existingKeys.add(key)
      console.log(`[attr] ${collectionId}.${key} (from ${sourceKey})`)
    }
  }

  await pgClient.end()

  console.log('\nText-safe attribute bootstrap complete')
  console.log(`Database: ${databaseId}`)
  console.log(`Created attributes: ${createdAttributes}`)
  console.log(`Skipped attributes: ${skippedAttributes}`)
  if (loadedEnvFile) {
    console.log(`Loaded env from: ${loadedEnvFile}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
