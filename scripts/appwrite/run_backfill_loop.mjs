import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

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

async function runChunk(tableName, rowsPerChunk) {
  const env = {
    ...process.env,
    MIGRATION_TABLES: tableName,
    MIGRATION_DRY_RUN: 'false',
    MIGRATION_COERCE_ALL_TO_STRING: getEnv('MIGRATION_COERCE_ALL_TO_STRING', 'true'),
    MIGRATION_BATCH_SIZE: getEnv('MIGRATION_BATCH_SIZE', '300'),
    MIGRATION_CONCURRENCY: getEnv('MIGRATION_CONCURRENCY', '4'),
    MIGRATION_PAGINATION_MODE: 'keyset',
    MIGRATION_RESUME: 'true',
    MIGRATION_SNAPSHOT_UPPER_BOUND: getEnv('MIGRATION_SNAPSHOT_UPPER_BOUND', 'true'),
    MIGRATION_MAX_ROWS: String(rowsPerChunk),
    MIGRATION_STATE_FILE: getEnv('MIGRATION_STATE_FILE', './scripts/appwrite/migration_state.json'),
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', ['./scripts/appwrite/migrate_supabase_to_appwrite.mjs'], {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      shell: true,
    })

    child.on('error', rejectPromise)
    child.on('exit', (code) => {
      if (code === 0 || code === null) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`Chunk migration failed with code ${code}`))
      }
    })
  })
}

function getTableProgress(state, tableName) {
  const tableState = state?.tables?.[tableName]
  if (!tableState) return null

  return {
    lastCursor: tableState.lastCursor ?? null,
    upperBound: tableState.upperBound ?? null,
    remainingRows: tableState.remainingRows ?? null,
    finished: Boolean(tableState.finished),
    updatedAt: tableState.updatedAt ?? null,
  }
}

async function main() {
  const loadedEnvFile = await loadEnvFile()

  const tableName = getRequiredEnv('BACKFILL_TABLE')
  const maxChunks = parseIntSafe(getEnv('BACKFILL_MAX_CHUNKS', '5'), 5)
  const rowsPerChunk = parseIntSafe(getEnv('BACKFILL_CHUNK_ROWS', '5000'), 5000)
  const stateFile = getEnv('MIGRATION_STATE_FILE', './scripts/appwrite/migration_state.json')

  if (loadedEnvFile) {
    console.log(`Loaded env from: ${loadedEnvFile}`)
  }
  console.log(`Backfill table: ${tableName}`)
  console.log(`Chunk rows: ${rowsPerChunk}`)
  console.log(`Max chunks this run: ${maxChunks}`)
  console.log(`State file: ${resolve(stateFile)}`)

  for (let i = 0; i < maxChunks; i += 1) {
    const { state: beforeState } = await loadMigrationState(stateFile)
    const before = getTableProgress(beforeState, tableName)

    if (before?.finished) {
      console.log(`\n[status] ${tableName} is already marked finished in state file.`)
      break
    }

    console.log(`\n[chunk ${i + 1}/${maxChunks}] launching chunked keyset migration...`)
    await runChunk(tableName, rowsPerChunk)

    const { state: afterState } = await loadMigrationState(stateFile)
    const after = getTableProgress(afterState, tableName)

    if (!after) {
      console.log('[status] No table progress found in migration state yet.')
      continue
    }

    console.log(
      `[status] lastCursor=${after.lastCursor}, upperBound=${after.upperBound}, ` +
      `remainingRows=${after.remainingRows}, finished=${after.finished}`
    )

    const stalled =
      before &&
      before.lastCursor === after.lastCursor &&
      before.remainingRows === after.remainingRows &&
      before.finished === after.finished

    if (stalled) {
      console.log('[status] No progress detected in this chunk run; stopping to avoid loop thrash.')
      break
    }

    if (after.finished) {
      console.log('[status] Table marked finished by migration state.')
      break
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
