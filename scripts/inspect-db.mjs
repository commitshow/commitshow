#!/usr/bin/env node
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env.local'), quiet: true })

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  database: process.env.SUPABASE_DB_NAME,
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

const { rows: tables } = await client.query(`
  select table_name from information_schema.tables
  where table_schema='public' order by table_name
`)
console.log('Public tables:', tables.map(t => t.table_name).join(', ') || '(none)')

for (const t of tables) {
  const { rows: cols } = await client.query(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema='public' and table_name=$1 order by ordinal_position
  `, [t.table_name])
  const { rows: count } = await client.query(`select count(*)::int as n from "${t.table_name}"`)
  console.log(`\n[${t.table_name}] (${count[0].n} rows)`)
  cols.forEach(c => console.log(`  ${c.column_name}  ${c.data_type}${c.is_nullable==='NO'?' NOT NULL':''}`))
}

await client.end()
