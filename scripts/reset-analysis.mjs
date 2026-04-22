#!/usr/bin/env node
// Reset all projects' analysis data.
// Keeps: projects rows, members, votes, applauds, build_briefs.
// Clears: analysis_results (DELETE) + projects score/analysis-derived columns.

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

async function q(sql, params = []) {
  const { rows } = await client.query(sql, params)
  return rows
}

console.log('── BEFORE ──')
const [pCount] = await q(`select count(*)::int as n from projects`)
const [arCount] = await q(`select count(*)::int as n from analysis_results`)
const [scored] = await q(`select count(*)::int as n from projects where score_auto > 0 or score_total > 0`)
console.log(`  projects:           ${pCount.n}`)
console.log(`  analysis_results:   ${arCount.n}`)
console.log(`  projects w/ score:  ${scored.n}`)

console.log('\n── RESET ──')
const del = await client.query(`delete from analysis_results returning id`)
console.log(`  ✓ Deleted ${del.rowCount} analysis_results rows`)

const upd = await client.query(`
  update projects set
    score_auto         = 0,
    score_forecast     = 0,
    score_community    = 0,
    score_total        = 0,
    verdict            = null,
    claude_insight     = null,
    tech_layers        = '{}',
    unlock_level       = 0,
    lh_performance     = 0,
    lh_accessibility   = 0,
    lh_best_practices  = 0,
    lh_seo             = 0,
    github_accessible  = false,
    creator_grade      = 'Rookie',
    status             = 'active',
    graduation_grade   = null,
    graduated_at       = null,
    media_published_at = null,
    updated_at         = now()
  returning id
`)
console.log(`  ✓ Reset ${upd.rowCount} projects rows`)

console.log('\n── AFTER ──')
const [pCount2] = await q(`select count(*)::int as n from projects`)
const [arCount2] = await q(`select count(*)::int as n from analysis_results`)
const [scored2] = await q(`select count(*)::int as n from projects where score_auto > 0 or score_total > 0`)
console.log(`  projects:           ${pCount2.n} (unchanged)`)
console.log(`  analysis_results:   ${arCount2.n}`)
console.log(`  projects w/ score:  ${scored2.n}`)

// Also confirm we did NOT touch users/members/votes/applauds/briefs
const [mCount]   = await q(`select count(*)::int as n from members`)
const [vCount]   = await q(`select count(*)::int as n from votes`)
const [aCount]   = await q(`select count(*)::int as n from applauds`)
const [bbCount]  = await q(`select count(*)::int as n from build_briefs`)
console.log(`\n── PRESERVED ──`)
console.log(`  members:       ${mCount.n}`)
console.log(`  votes:         ${vCount.n}`)
console.log(`  applauds:      ${aCount.n}`)
console.log(`  build_briefs:  ${bbCount.n}`)

await client.end()
