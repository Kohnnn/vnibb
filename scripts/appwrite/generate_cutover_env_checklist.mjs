import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

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

async function loadEnv(pathLike) {
  const absolutePath = resolve(pathLike)
  const content = await readFile(absolutePath, 'utf8')
  return { path: absolutePath, values: parseDotEnv(content) }
}

function maskSecret(value, reveal = false) {
  if (!value) return '<missing>'
  if (reveal) return value
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function required(name, value) {
  return {
    name,
    value,
    ok: Boolean(value),
  }
}

function presence(name, value, configuredLabel = '<configured>') {
  return {
    name,
    value: value ? configuredLabel : '<missing>',
    ok: Boolean(value),
  }
}

function printBlock(title, rows) {
  console.log(`\n${title}`)
  for (const row of rows) {
    const mark = row.ok ? 'OK  ' : 'MISS'
    console.log(`${mark} ${row.name}=${row.value || '<missing>'}`)
  }
}

async function main() {
  const envPath = process.env.APPWRITE_ENV_FILE || './apps/api/.env'
  const revealSecrets = ['1', 'true', 'yes'].includes(
    String(process.env.SHOW_SECRETS || '').toLowerCase(),
  )

  const { path, values } = await loadEnv(envPath)

  const appwriteEndpoint = values.APPWRITE_ENDPOINT || values.APPWRITE_URL || ''
  const appwriteProjectId = values.APPWRITE_PROJECT_ID || values.APPWRITE_NAME || ''
  const appwriteApiKey = values.APPWRITE_API_KEY || values.APPWRITE_SECRET || ''
  const appwriteDatabaseId = values.APPWRITE_DATABASE_ID || ''

  const zeaburRows = [
    required('APPWRITE_ENDPOINT', appwriteEndpoint),
    required('APPWRITE_PROJECT_ID', appwriteProjectId),
    required('APPWRITE_API_KEY', maskSecret(appwriteApiKey, revealSecrets)),
    required('APPWRITE_DATABASE_ID', appwriteDatabaseId),
    required('CACHE_BACKEND', values.CACHE_BACKEND || 'auto'),
    required('DATA_BACKEND', values.DATA_BACKEND || 'appwrite'),
    required('APPWRITE_POPULATE_MAX_ROWS', values.APPWRITE_POPULATE_MAX_ROWS || '1000'),
    presence('DATABASE_URL', values.DATABASE_URL || values.DATABASE_URL_SYNC),
  ]

  const vercelRows = [
    required('NEXT_PUBLIC_AUTH_PROVIDER', 'appwrite'),
    required('NEXT_PUBLIC_APPWRITE_ENDPOINT', appwriteEndpoint),
    required('NEXT_PUBLIC_APPWRITE_PROJECT_ID', appwriteProjectId),
  ]

  console.log('--- Appwrite Cutover Env Checklist ---')
  console.log(`Source env: ${path}`)
  console.log(`Secrets visible: ${revealSecrets}`)

  printBlock('Zeabur (backend)', zeaburRows)
  printBlock('Vercel (frontend)', vercelRows)

  const missing = zeaburRows.filter(row => row.value === '<missing>' || !row.ok)
  if (missing.length > 0) {
    console.log('\nResult: INCOMPLETE - fill missing backend vars before Appwrite-first runtime')
    process.exitCode = 2
  } else {
    console.log('\nResult: Backend env appears complete for Appwrite-first runtime with Postgres fallback')
  }

  console.log('\nNotes')
  console.log('- DATA_BACKEND should be appwrite for the new runtime path')
  console.log('- DATABASE_URL stays configured as the fallback source for Appwrite population and rollback')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
