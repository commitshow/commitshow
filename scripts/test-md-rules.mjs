#!/usr/bin/env node
// Sanity check: md_library trigger rules
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env.local'), quiet: true })

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST, port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER, database: process.env.SUPABASE_DB_NAME,
  password: process.env.SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false },
})

await client.connect()

// Create two test members: Rookie and Builder w/ graduation
const rookieId = '00000000-0000-0000-0000-00000000aaaa'
const builderId = '00000000-0000-0000-0000-00000000bbbb'

await client.query(`
  insert into auth.users (id, email) values
    ('${rookieId}', 'rookie@test.local'),
    ('${builderId}', 'builder@test.local')
  on conflict (id) do nothing
`)
await client.query(`
  insert into members (id, email, creator_grade, total_graduated) values
    ('${rookieId}',  'rookie@test.local',  'Rookie',  0),
    ('${builderId}', 'builder@test.local', 'Builder', 1)
  on conflict (id) do update set
    creator_grade   = excluded.creator_grade,
    total_graduated = excluded.total_graduated
`)

async function tryInsert(label, creator_id, price_cents) {
  try {
    const { rows } = await client.query(`
      insert into md_library (creator_id, title, category, price_cents)
      values ($1, $2, 'Scaffold', $3)
      returning id, verified_badge, price_cents
    `, [creator_id, `test-${label}`, price_cents])
    console.log(`✓ ${label}: inserted id=${rows[0].id.slice(0,8)} verified=${rows[0].verified_badge} price=${rows[0].price_cents}`)
    return rows[0].id
  } catch (err) {
    console.log(`✗ ${label}: ${err.message}`)
    return null
  }
}

console.log('── Rule tests ──')
const a = await tryInsert('Rookie free', rookieId, 0)           // should pass, verified=false
const b = await tryInsert('Rookie paid', rookieId, 500)         // should FAIL
const c = await tryInsert('Builder free', builderId, 0)         // should pass, verified=true
const d = await tryInsert('Builder paid', builderId, 1999)      // should pass, verified=true

// Cleanup
await client.query(`delete from md_library where creator_id in ($1, $2)`, [rookieId, builderId])
await client.query(`delete from members where id in ($1, $2)`, [rookieId, builderId])
await client.query(`delete from auth.users where id in ($1, $2)`, [rookieId, builderId])
console.log('\n(test data cleaned up)')

await client.end()
