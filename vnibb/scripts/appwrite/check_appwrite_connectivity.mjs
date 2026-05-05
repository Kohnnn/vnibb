import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client, Databases } from 'node-appwrite'

function getRequiredEnv(name) {
  const value = process.env[name]
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
  const envFile = resolve(process.env.APPWRITE_ENV_FILE || './apps/api/.env')
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

async function main() {
  const envFile = await loadEnvFile()

  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_URL || 'https://cloud.appwrite.io/v1'
  const projectId = process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_NAME || getRequiredEnv('APPWRITE_PROJECT_ID')
  const apiKey = process.env.APPWRITE_API_KEY || process.env.APPWRITE_SECRET || getRequiredEnv('APPWRITE_API_KEY')
  const databaseId = process.env.APPWRITE_DATABASE_ID || ''

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey)

  const databases = new Databases(client)

  let targetDatabaseId = databaseId
  let databaseName = databaseId

  if (!targetDatabaseId) {
    const dbList = await databases.list()
    if (dbList.total === 0) {
      console.log('Appwrite connectivity check passed')
      console.log(`Project: ${projectId}`)
      console.log('No databases found in project')
      if (envFile) {
        console.log(`Loaded env from: ${envFile}`)
      }
      return
    }
    targetDatabaseId = dbList.databases[0].$id
    databaseName = dbList.databases[0].name
  } else {
    const database = await databases.get(targetDatabaseId)
    databaseName = database.name
  }

  const collections = await databases.listCollections(targetDatabaseId)

  console.log('Appwrite connectivity check passed')
  console.log(`Project: ${projectId}`)
  console.log(`Database: ${databaseName} (${targetDatabaseId})`)
  console.log(`Collections: ${collections.total}`)
  if (envFile) {
    console.log(`Loaded env from: ${envFile}`)
  }

  for (const collection of collections.collections) {
    console.log(`- ${collection.name} (${collection.$id})`)
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
