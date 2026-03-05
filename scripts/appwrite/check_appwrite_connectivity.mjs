import process from 'node:process'
import { Client, Databases } from 'node-appwrite'

function getRequiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

async function main() {
  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_URL || 'https://cloud.appwrite.io/v1'
  const projectId = process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_NAME || getRequiredEnv('APPWRITE_PROJECT_ID')
  const apiKey = process.env.APPWRITE_API_KEY || process.env.APPWRITE_SECRET || getRequiredEnv('APPWRITE_API_KEY')
  const databaseId = getRequiredEnv('APPWRITE_DATABASE_ID')

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey)

  const databases = new Databases(client)

  const database = await databases.get(databaseId)
  const collections = await databases.listCollections(databaseId)

  console.log('Appwrite connectivity check passed')
  console.log(`Project: ${projectId}`)
  console.log(`Database: ${database.name} (${database.$id})`)
  console.log(`Collections: ${collections.total}`)

  for (const collection of collections.collections) {
    console.log(`- ${collection.name} (${collection.$id})`)
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
