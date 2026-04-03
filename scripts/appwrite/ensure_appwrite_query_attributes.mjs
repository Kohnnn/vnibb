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

function isAlreadyExistsError(err) {
  if (!err) return false
  if (err.code === 409) return true
  if (typeof err.type === 'string' && err.type.includes('already_exists')) return true
  if (typeof err.message === 'string' && err.message.toLowerCase().includes('already exists')) return true
  return false
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

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
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

async function waitForAttribute(databases, databaseId, collectionId, key, timeoutMs = parseIntSafe(getEnv('APPWRITE_SCHEMA_WAIT_MS', '180000'), 180000)) {
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

async function createAttribute(databases, databaseId, collectionId, spec) {
  const common = {
    databaseId,
    collectionId,
    key: spec.key,
    required: Boolean(spec.required ?? false),
    array: Boolean(spec.array ?? false)
  }
  const type = String(spec.type || 'string').toLowerCase()

  if (type === 'integer') {
    return databases.createIntegerAttribute({
      ...common,
      min: spec.min,
      max: spec.max,
      xdefault: spec.default
    })
  }

  if (type === 'float') {
    return databases.createFloatAttribute({
      ...common,
      min: spec.min,
      max: spec.max,
      xdefault: spec.default
    })
  }

  if (type === 'datetime') {
    return databases.createDatetimeAttribute({
      ...common,
      xdefault: spec.default
    })
  }

  return databases.createStringAttribute({
    ...common,
    size: Number(spec.size || 255),
    xdefault: spec.default
  })
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
  let pending = 0
  const skipWait = ['1', 'true', 'yes', 'on'].includes(String(getEnv('APPWRITE_SCHEMA_SKIP_WAIT', '0')).toLowerCase())

  for (const item of selectedCollections(schemaMap)) {
    const collectionId = item.collectionId
    const queryAttributes = Array.isArray(item.queryAttributes) ? item.queryAttributes : []
    if (!collectionId || queryAttributes.length === 0) continue

    const existing = await databases.listAttributes(databaseId, collectionId)
    const existingKeys = new Set(existing.attributes.map(attr => attr.key))

    for (const spec of queryAttributes) {
      if (!spec?.key) continue
      if (existingKeys.has(spec.key)) {
        skipped += 1
        console.log(`[skip] ${collectionId}.${spec.key} already exists`)
        continue
      }

      try {
        await createAttribute(databases, databaseId, collectionId, spec)
        if (!skipWait) {
          await waitForAttribute(databases, databaseId, collectionId, spec.key)
        }
        existingKeys.add(spec.key)
        created += 1
        console.log(`[attr] ${collectionId}.${spec.key} (${spec.type || 'string'})`)
      } catch (err) {
        if (isAlreadyExistsError(err)) {
          skipped += 1
          existingKeys.add(spec.key)
          console.log(`[skip] ${collectionId}.${spec.key} already exists`)
          continue
        }
        if (!skipWait && String(err?.message || '').toLowerCase().includes('timed out waiting for attribute')) {
          existingKeys.add(spec.key)
          pending += 1
          console.log(`[pending] ${collectionId}.${spec.key} created but still processing`)
          continue
        }
        throw err
      }
    }
  }

  console.log('\nQuery attribute bootstrap complete')
  console.log(`Database: ${databaseId}`)
  console.log(`Created query attrs: ${created}`)
  console.log(`Skipped query attrs: ${skipped}`)
  console.log(`Pending query attrs: ${pending}`)
  if (loadedEnvFile) {
    console.log(`Loaded env from: ${loadedEnvFile}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
