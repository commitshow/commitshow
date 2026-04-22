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

const { rows: projects } = await client.query(`
  select id, creator_name, creator_email, season, season_id, score_total, status
  from projects order by created_at
`)
console.log('Projects after migration:')
projects.forEach(p => console.log(' ', p))

const { rows: briefs } = await client.query(`
  select project_id, problem, features, ai_tools, target_user from build_briefs
`)
console.log('\nBuild briefs:')
briefs.forEach(b => console.log(' ', b))

const { rows: seasons } = await client.query(`select id, name, status from seasons`)
console.log('\nSeasons:')
seasons.forEach(s => console.log(' ', s))

const { rows: fk } = await client.query(`
  select conname, conrelid::regclass as tbl, confrelid::regclass as refs
  from pg_constraint
  where contype = 'f' and connamespace = 'public'::regnamespace
  order by conrelid::regclass::text, conname
`)
console.log('\nForeign keys:')
fk.forEach(f => console.log(' ', f.tbl, '→', f.refs, '(' + f.conname + ')'))

await client.end()
