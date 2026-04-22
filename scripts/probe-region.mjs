#!/usr/bin/env node
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env.local'), quiet: true })

const REF = process.env.SUPABASE_PROJECT_REF
const PW = process.env.SUPABASE_DB_PASSWORD

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ca-central-1', 'sa-east-1',
  'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1',
  'ap-northeast-1', 'ap-northeast-2', 'ap-south-1',
  'ap-southeast-1', 'ap-southeast-2',
]
const PREFIXES = ['aws-0', 'aws-1']
const PORTS = [6543, 5432]

for (const prefix of PREFIXES) {
  for (const region of REGIONS) {
    for (const port of PORTS) {
      const host = `${prefix}-${region}.pooler.supabase.com`
      const client = new pg.Client({
        host, port, database: 'postgres',
        user: `postgres.${REF}`, password: PW,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 4000,
      })
      try {
        await client.connect()
        const { rows } = await client.query("select current_database() as db")
        console.log(`\n✓✓✓ FOUND: ${host}:${port} (db=${rows[0].db})\n`)
        await client.end()
        process.exit(0)
      } catch (err) {
        const msg = String(err.message).slice(0, 60)
        if (!msg.includes('Tenant or user not found') && !msg.includes('ENOTFOUND')) {
          console.log(`? ${prefix}-${region}:${port} — ${msg}`)
        }
        try { await client.end() } catch {}
      }
    }
  }
}
console.error('\nNo pooler endpoint matched.')
process.exit(1)
