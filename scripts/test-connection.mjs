#!/usr/bin/env node
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env.local') })

const REF = process.env.SUPABASE_PROJECT_REF
const PW = process.env.SUPABASE_DB_PASSWORD

const candidates = [
  { label: 'Direct IPv6',                host: 'db.tekemubwihsjdzittoqf.supabase.co', port: 5432, user: 'postgres', db: 'postgres' },
  { label: 'Pooler us-east-1 :6543 tx',  host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543, user: `postgres.${REF}`, db: 'postgres' },
  { label: 'Pooler us-east-1 :5432 sess',host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: `postgres.${REF}`, db: 'postgres' },
]

for (const c of candidates) {
  const client = new pg.Client({
    host: c.host, port: c.port, user: c.user, database: c.db, password: PW,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  try {
    await client.connect()
    const { rows } = await client.query("select current_database() as db, current_user as usr, inet_server_addr() as ip")
    console.log(`✓ ${c.label} — db=${rows[0].db} user=${rows[0].usr} ip=${rows[0].ip}`)
    await client.end()
  } catch (err) {
    console.log(`✗ ${c.label} — ${String(err.message).slice(0, 120)}`)
    try { await client.end() } catch {}
  }
}
