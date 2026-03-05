import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

function parseDotEnv(content) {
  const parsed = {}
  const lines = content.split(/\r?\n/)

  for (const rawLine of lines) {
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

function requiredValue(name, value) {
  if (!value) {
    throw new Error(`Missing required value for ${name}`)
  }
  return value
}

async function main() {
  const envFile = resolve(process.env.APPWRITE_ENV_FILE || './apps/api/.env')
  const envContent = await readFile(envFile, 'utf8')
  const fileEnv = parseDotEnv(envContent)

  for (const [key, value] of Object.entries(fileEnv)) {
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }

  const endpoint =
    process.env.APPWRITE_ENDPOINT ||
    process.env.APPWRITE_URL ||
    process.env.APPWRITE_ENDPOINT_URL ||
    'https://cloud.appwrite.io/v1'

  const projectId = process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_NAME
  const apiKey = process.env.APPWRITE_API_KEY || process.env.APPWRITE_SECRET

  process.env.APPWRITE_ENDPOINT = endpoint
  process.env.APPWRITE_PROJECT_ID = requiredValue('APPWRITE_PROJECT_ID/APPWRITE_NAME', projectId)
  process.env.APPWRITE_API_KEY = requiredValue('APPWRITE_API_KEY/APPWRITE_SECRET', apiKey)

  const args = process.argv.slice(2)
  const mcpArgs = args.length > 0 ? args : ['--databases']

  console.log('Starting Appwrite MCP server with env file:', envFile)
  console.log('Enabled MCP tools args:', mcpArgs.join(' '))

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('uvx', ['mcp-server-appwrite', ...mcpArgs], {
      stdio: 'inherit',
      env: process.env,
      shell: true,
    })

    child.on('error', rejectPromise)
    child.on('exit', (code) => {
      if (code === 0 || code === null) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`mcp-server-appwrite exited with code ${code}`))
      }
    })
  })
}

main().catch((err) => {
  console.error(err.message || err)
  process.exitCode = 1
})
