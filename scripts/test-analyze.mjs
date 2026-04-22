#!/usr/bin/env node
// Trigger analyze-project Edge Function against an existing project row.
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env.local'), quiet: true })

const ref = process.env.SUPABASE_PROJECT_REF
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const url = `https://${ref}.supabase.co/functions/v1/analyze-project`

// Need a project with a real github_url + live_url to exercise the pipeline.
// Upsert a known-good test project so we don't depend on the 'ktrenz' stub row.
const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST, port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER, database: process.env.SUPABASE_DB_NAME,
  password: process.env.SUPABASE_DB_PASSWORD, ssl: { rejectUnauthorized: false },
})
await client.connect()

const testId = '00000000-0000-0000-0000-00000000e2e2'
const seasonRow = await client.query(`select id from seasons where name='season_zero' limit 1`)
const seasonId = seasonRow.rows[0]?.id

await client.query(`
  insert into projects (id, project_name, creator_email, github_url, live_url, description, season_id, season, status)
  values ($1, 'commit.show itself', 'test@commit.show',
          'https://github.com/hans1329/vibe', 'https://example.com', 'meta test run', $2, 'season_zero', 'active')
  on conflict (id) do update set
    github_url=excluded.github_url, live_url=excluded.live_url, description=excluded.description
`, [testId, seasonId])

await client.query(`
  insert into build_briefs (project_id, problem, features, ai_tools, target_user, integrity_score)
  values ($1,
    'Vibe coding projects have no objective quality bar and disappear into the feed.',
    'Scoring engine combining Lighthouse, GitHub, and Claude insight; 3-week season; verified MD library.',
    'Claude Code · Supabase · Vite · Tailwind',
    'AI-assisted indie builders launching production apps',
    4)
  on conflict (project_id) do update set
    problem=excluded.problem, features=excluded.features,
    ai_tools=excluded.ai_tools, target_user=excluded.target_user, integrity_score=4
`, [testId])

await client.end()

console.log(`→ POST ${url}`)
const t0 = Date.now()
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  },
  body: JSON.stringify({ project_id: testId }),
})
const body = await res.text()
console.log(`← ${res.status} in ${Date.now() - t0}ms`)
try {
  const parsed = JSON.parse(body)
  console.log(JSON.stringify(parsed, null, 2))
} catch {
  console.log(body)
}
