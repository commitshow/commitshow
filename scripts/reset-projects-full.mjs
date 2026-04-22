#!/usr/bin/env node
// DANGER: Wipes all project-related state and resets member counters.
// Preserves: auth.users, members rows, seasons, MD categories.
// Removes:
//   - projects (cascades to analysis_snapshots, build_briefs, votes, applauds,
//     md_discoveries, hall_of_fame, and ap_events.related_project_id goes null)
//   - ap_events (all rows — AP was earned from now-deleted projects)
//   - members_grade_history (all rows)
//   - md_library (all test publishes — md_purchases cascade)
//   - Storage: every file under the project-thumbnails bucket
// Resets on members: activity_points=0, monthly_votes_used=0, tier=Bronze,
//   creator_grade=Rookie, total_graduated=0, avg_auto_score=0,
//   votes_reset_at=next month, grade_recalc_at=null.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Load both .env and .env.local — DB creds live in .env.local, VITE_* in .env.
dotenv.config({ path: resolve(__dirname, '..', '.env'),       quiet: true })
dotenv.config({ path: resolve(__dirname, '..', '.env.local'), quiet: true })

const {
  SUPABASE_DB_HOST, SUPABASE_DB_PORT, SUPABASE_DB_USER,
  SUPABASE_DB_NAME, SUPABASE_DB_PASSWORD,
  VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
} = process.env

if (!SUPABASE_DB_HOST || !SUPABASE_DB_PASSWORD) {
  console.error('Missing SUPABASE_DB_* in .env.local'); process.exit(1)
}
if (!VITE_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1)
}

const pgc = new pg.Client({
  host: SUPABASE_DB_HOST, port: Number(SUPABASE_DB_PORT || 5432),
  user: SUPABASE_DB_USER || 'postgres', database: SUPABASE_DB_NAME || 'postgres',
  password: SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false },
})
const admin = createClient(VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const q = async (sql, params = []) => (await pgc.query(sql, params)).rows
const count = async (tbl) => (await q(`select count(*)::int as n from ${tbl}`))[0].n

await pgc.connect()

console.log('── BEFORE ──')
for (const t of ['projects', 'analysis_snapshots', 'build_briefs', 'votes', 'applauds', 'md_discoveries', 'ap_events', 'members_grade_history', 'md_library', 'md_purchases', 'hall_of_fame', 'members']) {
  try { console.log(`  ${t.padEnd(24)} ${await count(t)}`) } catch { console.log(`  ${t.padEnd(24)} (not found)`) }
}

// 1) Storage — list & remove every object in project-thumbnails.
console.log('\n── STORAGE · project-thumbnails ──')
async function listAllInBucket(bucket) {
  const paths = []
  const stack = ['']
  while (stack.length) {
    const prefix = stack.pop()
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
    if (error) { console.warn(`  list ${prefix || '<root>'} failed: ${error.message}`); continue }
    for (const entry of (data ?? [])) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null || entry.metadata === null) {
        // folder (Supabase returns id=null for folders)
        stack.push(full)
      } else {
        paths.push(full)
      }
    }
  }
  return paths
}
const files = await listAllInBucket('project-thumbnails')
console.log(`  found ${files.length} files`)
if (files.length > 0) {
  for (let i = 0; i < files.length; i += 1000) {
    const chunk = files.slice(i, i + 1000)
    const { error } = await admin.storage.from('project-thumbnails').remove(chunk)
    if (error) console.warn(`  remove chunk failed: ${error.message}`)
    else console.log(`  ✓ removed ${chunk.length} files`)
  }
}

// 2) SQL deletes — order matters only if FKs don't cascade cleanly.
console.log('\n── SQL WIPE ──')

// md_purchases cascades from md_library, but delete explicitly to be safe.
const mp = await pgc.query(`delete from md_purchases returning id`)
console.log(`  ✓ md_purchases           ${mp.rowCount}`)
const ml = await pgc.query(`delete from md_library returning id`)
console.log(`  ✓ md_library             ${ml.rowCount}`)

// members_grade_history references snapshots (set null) + members (cascade).
// Snapshots will disappear when projects delete cascades, but history rows can
// survive that. Clear explicitly.
const gh = await pgc.query(`delete from members_grade_history returning id`)
console.log(`  ✓ members_grade_history  ${gh.rowCount}`)

// ap_events: keep rows tied to members but not to deleted projects? No —
// user wants a full reset of AP state, so wipe everything.
const ap = await pgc.query(`delete from ap_events returning id`)
console.log(`  ✓ ap_events              ${ap.rowCount}`)

// projects — triggers CASCADE on most children.
const pr = await pgc.query(`delete from projects returning id`)
console.log(`  ✓ projects (cascade)     ${pr.rowCount}`)

// 3) Members reset — keep rows, clear counters.
const mr = await pgc.query(`
  update members set
    activity_points    = 0,
    monthly_votes_used = 0,
    tier               = 'Bronze',
    creator_grade      = 'Rookie',
    total_graduated    = 0,
    avg_auto_score     = 0,
    votes_reset_at     = date_trunc('month', now()) + interval '1 month',
    grade_recalc_at    = null,
    updated_at         = now()
  returning id
`)
console.log(`  ✓ members reset          ${mr.rowCount}`)

console.log('\n── AFTER ──')
for (const t of ['projects', 'analysis_snapshots', 'build_briefs', 'votes', 'applauds', 'md_discoveries', 'ap_events', 'members_grade_history', 'md_library', 'md_purchases', 'hall_of_fame', 'members']) {
  try { console.log(`  ${t.padEnd(24)} ${await count(t)}`) } catch { console.log(`  ${t.padEnd(24)} (not found)`) }
}

// Sanity: any stranded children?
const strays = await q(`
  select 'analysis_snapshots' as tbl, count(*)::int as n from analysis_snapshots
  union all select 'build_briefs',    count(*)::int from build_briefs
  union all select 'votes',           count(*)::int from votes
  union all select 'applauds',        count(*)::int from applauds
  union all select 'md_discoveries',  count(*)::int from md_discoveries
  union all select 'hall_of_fame',    count(*)::int from hall_of_fame
`)
const stragglers = strays.filter(r => r.n > 0)
if (stragglers.length > 0) {
  console.log('\n⚠  Unexpected survivors:')
  stragglers.forEach(r => console.log(`   ${r.tbl}: ${r.n}`))
} else {
  console.log('\n✓ All project-linked tables are empty.')
}

await pgc.end()
console.log('\nReset complete.')
