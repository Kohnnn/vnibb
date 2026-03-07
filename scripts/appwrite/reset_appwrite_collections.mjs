import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { Client, Databases, Permission, Role } from 'node-appwrite'

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

function buildCollectionPermissions(permissionsMode) {
  if (permissionsMode === 'publicRead') {
    return [Permission.read(Role.any())]
  }
  return []
}

function useDocumentSecurity(permissionsMode) {
  return permissionsMode === 'ownerReadWrite'
}

async function main() {
  const loadedEnvFile = await loadEnvFile()

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
    if (tableFilter.size === 0) return false
    return tableFilter.has(item.table) || tableFilter.has(item.collectionId)
  })

  if (selectedCollections.length === 0) {
    throw new Error('Set MIGRATION_TABLES with one or more target table/collection IDs')
  }

  const appwriteClient = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey)
  const databases = new Databases(appwriteClient)

  const databaseId = await resolveAppwriteDatabaseId(
    databases,
    getEnv('APPWRITE_DATABASE_ID', schemaMap.databaseId || '')
  )

  const existing = await databases.listCollections(databaseId)
  const existingIds = new Set(existing.collections.map(c => c.$id))

  for (const item of selectedCollections) {
    const collectionId = item.collectionId
    const collectionName = item.collectionName || collectionId
    const permissionsMode = item.permissionsMode || 'collectionDefault'

    if (!collectionId) continue

    if (existingIds.has(collectionId)) {
      await databases.deleteCollection(databaseId, collectionId)
      console.log(`[delete] ${collectionId}`)
    }

    await databases.createCollection({
      databaseId,
      collectionId,
      name: collectionName,
      permissions: buildCollectionPermissions(permissionsMode),
      documentSecurity: useDocumentSecurity(permissionsMode),
      enabled: true,
    })

    console.log(`[recreate] ${collectionId}`)
  }

  console.log('\nCollection reset complete')
  console.log(`Database: ${databaseId}`)
  if (loadedEnvFile) {
    console.log(`Loaded env from: ${loadedEnvFile}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
