// Client API for the Artifact Discovery table (§15.6 · v1.5 format-aware).
// Creators see library-worthy suggestions (MCP/IDE/Skills/Rules/Patch/Prompts)
// on their analysis result card and can publish, dismiss, or preview each one.

import {
  supabase,
  type MDCategory,
  type CreatorGrade,
  type ArtifactFormat,
  type ArtifactBundleFile,
} from './supabase'

export interface DetectedVariable {
  name: string
  occurrences: number
  sample?: string
  default?: string
}

export interface MDDiscoveryRow {
  id: string
  project_id: string
  snapshot_id: string | null
  creator_id: string | null
  file_path: string
  sha: string | null
  claude_scores: {
    iter_depth: number
    prod_anchor: number
    token_saving: number
    distilled: number
  }
  total_score: number
  suggested_category: MDCategory
  suggested_title: string | null
  suggested_description: string | null
  excerpt: string | null
  status: 'suggested' | 'dismissed' | 'published'
  published_md_id: string | null
  created_at: string
  resolved_at: string | null
  // v1.5 format-aware fields
  detected_format: ArtifactFormat | null
  detected_tools: string[]
  detected_variables: DetectedVariable[]
  bundle_paths: string[]
}

export async function loadDiscoveriesForProject(projectId: string): Promise<MDDiscoveryRow[]> {
  const { data } = await supabase
    .from('md_discoveries')
    .select('*')
    .eq('project_id', projectId)
    .order('total_score', { ascending: false })
  return (data ?? []) as MDDiscoveryRow[]
}

export async function dismissDiscovery(id: string): Promise<void> {
  const { error } = await supabase
    .from('md_discoveries')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export interface PublishDiscoveryInput {
  discoveryId: string
  title: string
  description: string
  category: MDCategory
  contentMd: string
  priceCents: number              // 0 for free · gated by DB trigger for paid
  tags?: string[]
  authorGrade: CreatorGrade
  linkedProjectId: string
  creatorId: string
  // v1.5 format-aware fields (optional · pulled from discovery if omitted)
  targetFormat?: ArtifactFormat | null
  targetTools?: string[]
  variables?: Array<{ name: string; default?: string; description?: string; sample?: string }>
  bundleFiles?: ArtifactBundleFile[]
  stackTags?: string[]
  discoveryTotalScore?: number | null
}

export async function publishDiscovery(input: PublishDiscoveryInput): Promise<{ mdId: string }> {
  const { data: md, error } = await supabase
    .from('md_library')
    .insert([{
      creator_id:         input.creatorId,
      linked_project_id:  input.linkedProjectId,
      title:              input.title,
      description:        input.description,
      category:           input.category,
      tags:               input.tags ?? [],
      content_md:         input.contentMd,
      price_cents:        Math.max(0, Math.round(input.priceCents)),
      author_grade:       input.authorGrade,
      status:             'published',
      is_public:          true,
      // v1.5 · format-aware metadata
      target_format:      input.targetFormat ?? null,
      target_tools:       input.targetTools ?? [],
      variables:          input.variables ?? [],
      bundle_files:       input.bundleFiles ?? [],
      stack_tags:         input.stackTags ?? [],
      discovery_total_score: input.discoveryTotalScore ?? null,
    }])
    .select('id')
    .single()
  if (error || !md) throw new Error(`Library publish failed: ${error?.message ?? 'unknown'}`)

  await supabase
    .from('md_discoveries')
    .update({
      status: 'published',
      published_md_id: md.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', input.discoveryId)

  return { mdId: md.id }
}
