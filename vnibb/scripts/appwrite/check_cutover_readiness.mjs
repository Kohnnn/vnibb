import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { Client, Databases, Query } from 'node-appwrite'

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
    if (docs.length === 0) break

    count += docs.length
    cursorAfter = docs[docs.length - 1].$id
    if (docs.length < pageSize) break
  }

  return count
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

function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return 100
  return Math.round((numerator / denominator) * 10000) / 100
}

async function main() {
  const loadedEnvFile = await loadEnvFile()

  const endpoint = getEnv('APPWRITE_ENDPOINT', getEnv('APPWRITE_URL', 'https://cloud.appwrite.io/v1'))
  const projectId = getEnv('APPWRITE_PROJECT_ID', getEnv('APPWRITE_NAME')) || getRequiredEnv('APPWRITE_PROJECT_ID')
  const apiKey = getEnv('APPWRITE_API_KEY', getEnv('APPWRITE_SECRET')) || getRequiredEnv('APPWRITE_API_KEY')

  const baselineFile = getEnv('VERIFY_BASELINE_FILE', './scripts/appwrite/supabase_baseline.json')
  const baseline = await loadBaselineCounts(baselineFile)

  const requiredTables = String(
    getEnv(
      'CUTOVER_REQUIRED_TABLES',
      'stocks,stock_prices,income_statements,balance_sheets,cash_flows,financial_ratios',
    ),
  )
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  const appwriteClient = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey)
  const databases = new Databases(appwriteClient)

  const databaseId = await resolveAppwriteDatabaseId(
    databases,
    getEnv('APPWRITE_DATABASE_ID', ''),
  )

  const collectionList = await databases.listCollections(databaseId)
  const collectionMap = new Map(collectionList.collections.map(c => [c.$id, c]))

  let hardFail = false

  console.log('--- Appwrite Cutover Readiness ---')
  console.log(`Project: ${projectId}`)
  console.log(`Database: ${databaseId}`)
  console.log(`Baseline: ${baseline.path}`)
  if (loadedEnvFile) {
    console.log(`Loaded env from: ${loadedEnvFile}`)
  }
  console.log('')

  for (const table of requiredTables) {
    const expected = baseline.tableCounts.get(table)
    if (expected === undefined) {
      console.log(`WARN  ${table}: not found in baseline file`) 
      continue
    }

    if (!collectionMap.has(table)) {
      console.log(`FAIL  ${table}: missing Appwrite collection`) 
      hardFail = true
      continue
    }

    const actual = await countCollectionDocuments(databases, databaseId, table, 250)
    const coverage = pct(actual, expected)

    if (actual >= expected) {
      console.log(`PASS  ${table}: target=${actual}, baseline=${expected}, coverage=${coverage}%`)
    } else {
      console.log(`FAIL  ${table}: target=${actual}, baseline=${expected}, coverage=${coverage}%`)
      hardFail = true
    }
  }

  console.log('')
  if (hardFail) {
    console.log('Result: NOT READY for full data cutover')
    process.exitCode = 2
  } else {
    console.log('Result: READY for data cutover (baseline-complete)')
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
