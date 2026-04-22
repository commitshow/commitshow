#!/usr/bin/env node
// Execute supabase/schema.sql against the Supabase Postgres DB.
// Reads credentials from .env.local.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

dotenv.config({ path: resolve(root, '.env.local') })

const { SUPABASE_DB_HOST, SUPABASE_DB_PORT, SUPABASE_DB_USER, SUPABASE_DB_NAME, SUPABASE_DB_PASSWORD } = process.env

if (!SUPABASE_DB_HOST || !SUPABASE_DB_PASSWORD) {
  console.error('Missing SUPABASE_DB_* in .env.local')
  process.exit(1)
}

const sqlPath = resolve(root, 'supabase/schema.sql')
const sql = readFileSync(sqlPath, 'utf8')

const client = new pg.Client({
  host: SUPABASE_DB_HOST,
  port: Number(SUPABASE_DB_PORT || 5432),
  user: SUPABASE_DB_USER || 'postgres',
  database: SUPABASE_DB_NAME || 'postgres',
  password: SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

try {
  console.log(`→ Connecting to ${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}...`)
  await client.connect()
  console.log('✓ Connected')

  console.log(`→ Running ${sqlPath} (${sql.length} bytes)...`)
  await client.query(sql)
  console.log('✓ Migration applied')

  const { rows: tables } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `)
  console.log('\nTables in public schema:')
  tables.forEach(t => console.log('  -', t.table_name))

  const { rows: seasons } = await client.query('select name, status, start_date, end_date from seasons')
  console.log('\nSeasons:')
  seasons.forEach(s => console.log(`  - ${s.name} [${s.status}] ${s.start_date} → ${s.end_date}`))
} catch (err) {
  console.error('✗ Migration failed:', err.message)
  if (err.position) console.error('  at position:', err.position)
  process.exit(1)
} finally {
  await client.end()
}
