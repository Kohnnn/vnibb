import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import process from 'node:process'
import pg from 'pg'

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

async function loadSchemaMap(pathLike) {
  const absolutePath = resolve(pathLike)
  const content = await readFile(absolutePath, 'utf8')
  const parsed = JSON.parse(content)
  if (!parsed.collections || !Array.isArray(parsed.collections)) {
    throw new Error('Schema map must include collections array')
  }
  return parsed
}

function normalizeRow(row) {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      out[key] = value.toISOString()
      continue
    }
    if (typeof value === 'bigint') {
      out[key] = value.toString()
      continue
    }
    if (Buffer.isBuffer(value)) {
      out[key] = value.toString('base64')
      continue
    }
    out[key] = value
  }
  return out
}

function hashRows(rows) {
  const normalized = rows.map(normalizeRow)
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

async function main() {
  const supabaseUrl = getEnv('SUPABASE_DATABASE_URL', getEnv('DATABASE_URL_SYNC'))
  if (!supabaseUrl) {
    throw new Error('Set SUPABASE_DATABASE_URL or DATABASE_URL_SYNC')
  }

  const schemaMapPath = getEnv('MIGRATION_SCHEMA_MAP', './scripts/appwrite/schema-map.example.json')
  const outPath = resolve(getEnv('MIGRATION_BASELINE_OUT', './scripts/appwrite/supabase_baseline.json'))
  const sampleSize = parseIntSafe(getEnv('MIGRATION_BASELINE_SAMPLE_SIZE', '500'), 500)
  const schemaMap = await loadSchemaMap(schemaMapPath)

  const pgClient = new PgClient({ connectionString: supabaseUrl })
  await pgClient.connect()

  const baseline = {
    generatedAt: new Date().toISOString(),
    schemaMapPath: resolve(schemaMapPath),
    sampleSize,
    tables: []
  }

  for (const item of schemaMap.collections) {
    const table = item.table
    const cursorColumn = item.cursorColumn || 'id'

    if (!table) continue

    const tableSql = quoteIdentifier(table)
    const cursorSql = quoteIdentifier(cursorColumn)

    const countQuery = `SELECT COUNT(*)::bigint AS count FROM ${tableSql}`
    const boundsQuery = `SELECT MIN(${cursorSql}) AS min_cursor, MAX(${cursorSql}) AS max_cursor FROM ${tableSql}`
    const headQuery = `SELECT * FROM ${tableSql} ORDER BY ${cursorSql} ASC LIMIT $1`
    const tailQuery = `SELECT * FROM ${tableSql} ORDER BY ${cursorSql} DESC LIMIT $1`

    const countResult = await pgClient.query(countQuery)
    const boundsResult = await pgClient.query(boundsQuery)
    const headRowsResult = await pgClient.query(headQuery, [sampleSize])
    const tailRowsResult = await pgClient.query(tailQuery, [sampleSize])

    const count = Number(countResult.rows[0]?.count ?? 0)
    const minCursor = boundsResult.rows[0]?.min_cursor ?? null
    const maxCursor = boundsResult.rows[0]?.max_cursor ?? null

    baseline.tables.push({
      table,
      cursorColumn,
      rowCount: count,
      minCursor,
      maxCursor,
      headSampleHash: hashRows(headRowsResult.rows),
      tailSampleHash: hashRows(tailRowsResult.rows)
    })

    console.log(`[baseline] ${table}: rows=${count}`)
  }

  await pgClient.end()
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(baseline, null, 2), 'utf8')

  console.log(`Baseline report written: ${outPath}`)
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
