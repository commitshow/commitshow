import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Enums ─────────────────────────────────────────────────────

export type ScoutTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
export type CreatorGrade = 'Rookie' | 'Builder' | 'Maker' | 'Architect' | 'Vibe Engineer' | 'Legend'
export type ProjectStatus = 'active' | 'graduated' | 'valedictorian' | 'retry'
export type GraduationGrade = 'valedictorian' | 'honors' | 'graduate'
export type SeasonStatus = 'upcoming' | 'active' | 'applaud' | 'completed'
export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown'
export type UnlockLevel = 0 | 3 | 5 | 10 | 20

export type MDCategory =
  | 'Scaffold'
  | 'Prompt Library'
  | 'MCP Config'
  | 'Project Rules'
  | 'Backend'
  | 'Auth/Payment'
  | 'Playbooks'

export type MDStatus = 'draft' | 'published' | 'archived'
export type MDPaymentType = 'card' | 'usdc'

// Minimum price for paid artifacts · enforced by DB check constraint
export const MIN_PAID_PRICE_CENTS = 100     // $1

export const MD_CATEGORIES: MDCategory[] = [
  'Scaffold', 'Prompt Library', 'MCP Config', 'Project Rules', 'Backend', 'Auth/Payment', 'Playbooks',
]

export const PLATFORM_FEE_PCT = 20

// ── Tables ────────────────────────────────────────────────────

export type Season = {
  id: string
  name: string
  start_date: string
  end_date: string
  applaud_end: string
  graduation_date: string
  status: SeasonStatus
  graduation_results: Record<string, unknown> | null
  created_at: string
}

export type Member = {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  tier: ScoutTier
  activity_points: number
  monthly_votes_used: number
  votes_reset_at: string
  creator_grade: CreatorGrade
  total_graduated: number
  avg_auto_score: number
  preferred_stack: string[] | null        // v1.5 · null = use member_stack_auto
  created_at: string
  updated_at: string
}

// v1.5 · member_stack_auto view · auto-inferred from projects.tech_layers
export type MemberStackAuto = {
  member_id: string
  stack: string[]
}

export type Project = {
  id: string
  created_at: string
  updated_at: string
  project_name: string
  creator_id: string | null
  creator_name: string | null
  creator_email: string
  season_id: string | null
  season: string
  github_url: string | null
  live_url: string | null
  description: string | null
  lh_performance: number
  lh_accessibility: number
  lh_best_practices: number
  lh_seo: number
  github_accessible: boolean
  score_auto: number
  score_forecast: number
  score_community: number
  score_total: number
  creator_grade: CreatorGrade
  verdict: string | null
  claude_insight: string | null
  tech_layers: string[]
  unlock_level: UnlockLevel
  status: ProjectStatus
  graduation_grade: GraduationGrade | null
  graduated_at: string | null
  media_published_at: string | null
  thumbnail_url: string | null       // denormalized images[0].url · DB trigger keeps it synced
  thumbnail_path: string | null      // denormalized images[0].path
  images: ProjectImage[]             // up to 3 · [0] is primary
}

export interface ProjectImage {
  url: string
  path: string
}

export type BuildBrief = {
  id: string
  project_id: string
  created_at: string
  updated_at: string
  // Phase 1
  problem: string | null
  features: string | null
  ai_tools: string | null
  target_user: string | null
  // Phase 2 (revealed after graduation)
  stack_fingerprint: Record<string, string> | null
  failure_log: Array<{ symptom: string; cause: string; fix: string; prevention: string }> | null
  decision_archaeology: Array<{ chose: string; over: string; reason: string }> | null
  ai_delegation_map: Record<string, { ai_pct: number; human_pct: number }> | null
  live_proof: { deploy_url?: string; github_url?: string; api_url?: string; contract_addr?: string } | null
  next_blocker: string | null
  integrity_score: number
  phase2_unlocked: boolean
  phase2_unlocked_at: string | null
}

export type AnalysisResult = {
  id: string
  project_id: string
  created_at: string
  updated_at: string
  lighthouse_json: Record<string, unknown> | null
  github_json: Record<string, unknown> | null
  md_score: number
  security_score: number
  prod_ready_score: number
  unlocked_level: UnlockLevel
  level_0_data: Record<string, unknown> | null
  level_3_data: Record<string, unknown> | null
  level_5_data: Record<string, unknown> | null
  level_10_data: Record<string, unknown> | null
  level_20_data: Record<string, unknown> | null
  last_health_check: string | null
  health_status: HealthStatus
}

export type Vote = {
  id: string
  created_at: string
  project_id: string
  member_id: string | null
  voter_email: string | null
  vote_count: number
  weight: number
  scout_tier: ScoutTier
  season_id: string | null
  season: string
  ip_hash: string | null
  predicted_score: number | null    // v0.5 Forecast
  comment: string | null
}

// v2 polymorphic applaud target · §1-A ③ · §7.5
export type ApplaudTargetType =
  | 'product'
  | 'comment'
  | 'build_log'
  | 'stack'
  | 'brief'
  | 'recommit'

export type Applaud = {
  id:          string
  created_at:  string
  member_id:   string
  target_type: ApplaudTargetType
  target_id:   string
}

// v2 Community Posts (§13-B)
export type CommunityPostType  = 'build_log' | 'stack' | 'ask' | 'office_hours'
export type CommunityPostStatus = 'draft' | 'published' | 'archived' | 'resolved' | 'expired'

export type CommunityPost = {
  id:                string
  author_id:         string | null
  type:              CommunityPostType
  subtype:           string | null
  title:             string
  tldr:              string | null
  body:              string | null
  tags:              string[]
  linked_project_id: string | null
  status:            CommunityPostStatus
  published_at:      string | null
  created_at:        string
}

export type Comment = {
  id:           string
  project_id:   string
  member_id:    string | null
  parent_id:    string | null
  text:         string
  upvote_count: number
  simhash:      string | null
  created_at:   string
}

export type OfficeHoursFormat = 'ama' | 'toolmaker' | 'pair_building'

export type OfficeHoursEvent = {
  id:               string
  host_id:          string | null
  scheduled_at:     string
  format:           OfficeHoursFormat
  title:            string
  description:      string | null
  discord_url:      string | null
  recording_url:    string | null
  summary_post_id:  string | null
  attendees_count:  number
  created_at:       string
}

export type AwardVendor =
  | 'internal' | 'wise' | 'trolley' | 'tremendous' | 'stripe' | 'stripe_refund'
export type AwardType =
  | 'badge' | 'credit' | 'feature' | 'cash' | 'gift_card' | 'refund' | 'bonus'

export type AwardLedgerEntry = {
  id:           string
  member_id:    string | null
  month:        string | null
  tier:         string | null
  type:         AwardType
  amount_cents: number
  vendor:       AwardVendor | null
  vendor_ref:   string | null
  paid_at:      string | null
  note:         string | null
  created_at:   string
}

export type HallOfFame = {
  id: string
  created_at: string
  project_id: string
  member_id: string | null
  season_id: string | null
  grade: GraduationGrade
  score_final: number
  score_auto: number | null
  score_forecast: number | null
  score_community: number | null
  media_published_at: string | null
  media_url: string | null
  media_views: number
  badge_url: string | null
  nft_token_id: string | null
  last_health_check: string | null
  health_status: HealthStatus
  badge_active: boolean
}

// v1.5 Artifact Library · format taxonomy + tool targets
export type ArtifactFormat =
  | 'mcp_config'
  | 'ide_rules'
  | 'agent_skill'
  | 'project_rules'
  | 'prompt_pack'
  | 'patch_recipe'
  | 'scaffold'

export const ARTIFACT_FORMATS: ArtifactFormat[] = [
  'mcp_config', 'ide_rules', 'agent_skill', 'project_rules', 'prompt_pack', 'patch_recipe', 'scaffold',
]

export const ARTIFACT_FORMAT_LABELS: Record<ArtifactFormat, string> = {
  mcp_config:    'MCP Config',
  ide_rules:     'IDE Rules',
  agent_skill:   'Agent Skill',
  project_rules: 'Project Rules',
  prompt_pack:   'Prompt Pack',
  patch_recipe:  'Patch Recipe',
  scaffold:      'Scaffold',
}

export interface ArtifactVariable {
  name: string              // e.g. "PROJECT_NAME"
  default?: string
  description?: string
  sample?: string
}

export interface ArtifactBundleFile {
  path: string              // relative to artifact root (e.g. "SKILL.md" or "scripts/run.ts")
  content_sha: string
  content_md?: string       // inline text content (if small enough)
}

export type MDLibraryItem = {
  id: string
  created_at: string
  updated_at: string
  creator_id: string
  linked_project_id: string | null
  title: string
  description: string | null
  category: MDCategory
  tags: string[]
  content_md: string | null
  preview: string | null                     // free preview (first ~20%)
  storage_path: string | null
  price_cents: number                        // 0 or >= 100 (min $1) · v1.7 restored
  platform_fee_pct: number                   // default 20.00
  is_free: boolean                           // GENERATED column (price_cents = 0)
  verified_badge: boolean                    // auto-granted to graduates
  author_grade: CreatorGrade | null          // grade snapshot at INSERT time
  downloads_count: number
  purchase_count: number                     // v1.7 restored
  revenue_cents: number                      // v1.7 restored · author share accumulator
  is_public: boolean                         // creator may hide on retry
  status: MDStatus
  // v1.5 Artifact Library fields
  target_format: ArtifactFormat | null       // primary axis · format × tool
  target_tools: string[]                     // e.g. ['cursor','windsurf'] | ['claude-agent-sdk']
  variables: ArtifactVariable[]              // {{VAR}} placeholders
  bundle_files: ArtifactBundleFile[]         // multi-file artifacts (Skills, Recipes)
  stack_tags: string[]                       // e.g. ['nextjs','supabase','stripe']
  discovery_total_score: number | null       // snapshot of md_discoveries.total_score at publish
}

export type MDPurchase = {
  id: string
  created_at: string
  md_id: string
  buyer_id: string | null
  buyer_email: string | null
  amount_paid_cents: number
  author_share_cents: number                 // 80%
  platform_fee_cents: number                 // 20%
  payment_type: MDPaymentType
  stripe_session_id: string | null
  tx_hash: string | null
  refunded_at: string | null
  refund_reason: string | null
}

// Free/Trophy pivot: md_library_feed now carries adoption stats that
// replace the old price/revenue surface ("12 projects applied · 3 graduated").
export type MDLibraryFeedItem = MDLibraryItem & {
  author_name:               string | null
  author_email:              string
  current_author_grade:      CreatorGrade
  author_avatar_url:         string | null
  source_project_name:       string | null   // from projects.project_name
  source_project_score:      number | null   // graduation provenance signal
  source_project_status:     string | null
  projects_applied_count:    number          // distinct projects with a Apply-to-my-repo PR
  projects_graduated_count:  number          // of those, which ultimately graduated
  total_applications_count:  number          // raw count of PRs opened
  reputation_score:          number          // v1.7 composite: grade + adoption + downloads
}

// v1.5 · artifact_applications · Apply-to-my-repo feedback loop
export type ArtifactApplication = {
  id: string
  md_id: string
  applied_by: string | null
  applied_to_project: string | null
  github_pr_url: string | null
  variable_values: Record<string, string>
  created_at: string
}

// ── Views ─────────────────────────────────────────────────────

export type ProjectFeedItem = Project & {
  weighted_votes: number
  vote_count_raw: number
  applaud_count: number
  brief_problem: string | null
  brief_features: string | null
  brief_tools: string | null
  brief_target: string | null
}

export type MemberStats = Member & {
  total_projects: number
  graduated_count: number
  total_votes_cast: number
  total_applauds_given: number
  monthly_vote_cap: number
  monthly_votes_remaining: number
}

// ── Scout tier vote quota ─────────────────────────────────────

export const SCOUT_MONTHLY_VOTES: Record<ScoutTier, number> = {
  Bronze:   20,
  Silver:   40,
  Gold:     60,
  Platinum: 80,
}

// v1.7: Forecast Vote weight is uniform across tiers (all 1.0).
// Applaud (Craft Award Week) retains the original tier multiplier scale.
export const APPLAUD_TIER_WEIGHT: Record<ScoutTier, number> = {
  Bronze:   1.0,
  Silver:   1.5,
  Gold:     2.0,
  Platinum: 3.0,
}
