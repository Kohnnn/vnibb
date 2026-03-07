import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

async function main() {
  const statePath = resolve(process.env.MIGRATION_STATE_FILE || './scripts/appwrite/migration_state.json')

  let parsed
  try {
    const content = await readFile(statePath, 'utf8')
    parsed = JSON.parse(content)
  } catch (err) {
    console.error(`Failed to read migration state: ${statePath}`)
    console.error(err?.message || err)
    process.exitCode = 1
    return
  }

  const tables = parsed?.tables || {}
  const entries = Object.entries(tables)

  console.log(`Migration state file: ${statePath}`)
  console.log(`Tracked tables: ${entries.length}`)

  for (const [table, state] of entries) {
    console.log(
      `- ${table}: finished=${Boolean(state?.finished)}, ` +
      `lastCursor=${state?.lastCursor ?? 'null'}, ` +
      `upperBound=${state?.upperBound ?? 'null'}, ` +
      `remainingRows=${state?.remainingRows ?? 'n/a'}, ` +
      `updatedAt=${state?.updatedAt ?? 'n/a'}`
    )
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
