#!/usr/bin/env node
// PRD v1.2 validations: 7 categories, $1 min, purchase stats trigger, is_free generated.
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

const builderId = '00000000-0000-0000-0000-0000deadbeef'
await client.query(`insert into auth.users (id, email) values ($1, 'v12@test.local') on conflict (id) do nothing`, [builderId])
await client.query(`
  insert into members (id, email, creator_grade, total_graduated)
    values ($1, 'v12@test.local', 'Builder', 1)
    on conflict (id) do update set creator_grade='Builder', total_graduated=1
`, [builderId])

// Test 1: Auth/Payment category (v1.2 추가) 허용
try {
  const { rows } = await client.query(`
    insert into md_library (creator_id, title, category, price_cents)
    values ($1, 'auth-module', 'Auth/Payment', 0)
    returning id, is_free, author_grade, verified_badge
  `, [builderId])
  console.log(`✓ Auth/Payment category: is_free=${rows[0].is_free} author_grade=${rows[0].author_grade} verified=${rows[0].verified_badge}`)
} catch (e) { console.log(`✗ Auth/Payment: ${e.message}`) }

// Test 2: $0.50 (50 cents) → 거부 ($1 최저가)
try {
  await client.query(`insert into md_library (creator_id, title, category, price_cents) values ($1, 'too-cheap', 'Scaffold', 50)`, [builderId])
  console.log('✗ $0.50 should have been rejected')
} catch (e) { console.log(`✓ $0.50 rejected: ${e.message.split('\n')[0]}`) }

// Test 3: $1.00 (100 cents) → 허용
let mdId
try {
  const { rows } = await client.query(`
    insert into md_library (creator_id, title, category, price_cents, status)
    values ($1, 'dollar-md', 'Scaffold', 100, 'published')
    returning id, is_free, price_cents
  `, [builderId])
  mdId = rows[0].id
  console.log(`✓ $1.00 accepted: is_free=${rows[0].is_free} price_cents=${rows[0].price_cents}`)
} catch (e) { console.log(`✗ $1.00: ${e.message}`) }

// Test 4: 구매 insert → md_library 집계 자동 업데이트
if (mdId) {
  await client.query(`
    insert into md_purchases (md_id, buyer_email, amount_paid_cents, author_share_cents, platform_fee_cents, payment_type)
    values ($1, 'buyer@t.local', 100, 80, 20, 'card')
  `, [mdId])
  const { rows } = await client.query(`select purchase_count, revenue_cents from md_library where id = $1`, [mdId])
  console.log(`✓ Purchase trigger: purchase_count=${rows[0].purchase_count} revenue_cents=${rows[0].revenue_cents}`)
}

// Test 5: md_library_feed 정렬 확인
const { rows: feed } = await client.query(`select title, verified_badge, is_free, downloads_count from md_library_feed where creator_id = $1`, [builderId])
console.log(`✓ md_library_feed rows: ${feed.length}`)
feed.forEach(r => console.log(`   ${r.title} verified=${r.verified_badge} free=${r.is_free}`))

// Cleanup
await client.query(`delete from md_purchases where buyer_email = 'buyer@t.local'`)
await client.query(`delete from md_library where creator_id = $1`, [builderId])
await client.query(`delete from members where id = $1`, [builderId])
await client.query(`delete from auth.users where id = $1`, [builderId])
console.log('\n(cleaned up)')

await client.end()
