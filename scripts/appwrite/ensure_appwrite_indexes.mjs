import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { Client, Databases } from 'node-appwrite'

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

function selectedCollections(schemaMap) {
  const tableFilterRaw = getEnv('MIGRATION_TABLES', '')
  const tableFilter = new Set(
    tableFilterRaw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )

  return schemaMap.collections.filter(item => {
    if (tableFilter.size === 0) return true
    return tableFilter.has(item.table) || tableFilter.has(item.collectionId)
  })
}

async function waitForAttribute(databases, databaseId, collectionId, key, timeoutMs = 180000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const attribute = await databases.getAttribute({ databaseId, collectionId, key })
    if (attribute?.status === 'available') {
      return attribute
    }
    if (attribute?.status === 'failed') {
      throw new Error(`Attribute failed: ${collectionId}.${key}`)
    }
    await new Promise(resolveSleep => setTimeout(resolveSleep, 2000))
  }
  throw new Error(`Timed out waiting for attribute: ${collectionId}.${key}`)
}

async function waitForIndex(databases, databaseId, collectionId, key, timeoutMs = 180000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const index = await databases.getIndex({ databaseId, collectionId, key })
    if (index?.status === 'available') {
      return index
    }
    if (index?.status === 'failed') {
      throw new Error(`Index failed: ${collectionId}.${key}`)
    }
    await new Promise(resolveSleep => setTimeout(resolveSleep, 2000))
  }
  throw new Error(`Timed out waiting for index: ${collectionId}.${key}`)
}

async function main() {
  const loadedEnvFile = await loadEnvFile()
  const endpoint = getEnv('APPWRITE_ENDPOINT', getEnv('APPWRITE_URL', 'https://cloud.appwrite.io/v1'))
  const projectId = getEnv('APPWRITE_PROJECT_ID', getEnv('APPWRITE_NAME')) || getRequiredEnv('APPWRITE_PROJECT_ID')
  const apiKey = getEnv('APPWRITE_API_KEY', getEnv('APPWRITE_SECRET')) || getRequiredEnv('APPWRITE_API_KEY')
  const schemaMapPath = getEnv('MIGRATION_SCHEMA_MAP', './scripts/appwrite/schema-map.example.json')
  const schemaMap = await loadSchemaMap(schemaMapPath)

  const appwriteClient = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey)
  const databases = new Databases(appwriteClient)
  const databaseId = await getResolvedDatabaseId(databases, getEnv('APPWRITE_DATABASE_ID', schemaMap.databaseId || ''))

  let created = 0
  let skipped = 0

  for (const item of selectedCollections(schemaMap)) {
    const collectionId = item.collectionId
    const indexes = Array.isArray(item.indexes) ? item.indexes : []
    if (!collectionId || indexes.length === 0) continue

    const existing = await databases.listIndexes(databaseId, collectionId)
    const existingKeys = new Set(existing.indexes.map(index => index.key))

    for (const indexSpec of indexes) {
      if (!indexSpec?.key) continue
      if (existingKeys.has(indexSpec.key)) {
        skipped += 1
        console.log(`[skip] ${collectionId}.${indexSpec.key} already exists`)
        continue
      }

      for (const attrKey of indexSpec.attributes || []) {
        await waitForAttribute(databases, databaseId, collectionId, attrKey)
      }

      await databases.createIndex({
        databaseId,
        collectionId,
        key: indexSpec.key,
        type: indexSpec.type || 'key',
        attributes: indexSpec.attributes || [],
        orders: indexSpec.orders,
        lengths: indexSpec.lengths
      })
      await waitForIndex(databases, databaseId, collectionId, indexSpec.key)
      existingKeys.add(indexSpec.key)
      created += 1
      console.log(`[index] ${collectionId}.${indexSpec.key}`)
    }
  }

  console.log('\nIndex bootstrap complete')
  console.log(`Database: ${databaseId}`)
  console.log(`Created indexes: ${created}`)
  console.log(`Skipped indexes: ${skipped}`)
  if (loadedEnvFile) {
    console.log(`Loaded env from: ${loadedEnvFile}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
