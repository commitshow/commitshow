// Client helper for the scale-aware graduation evaluator (PRD v1.5.1 §6).
// Calls the evaluate_graduation(project_id) SQL function and returns a typed
// result. Safe for all viewers — RLS-agnostic via security-definer.

import { supabase } from './supabase'

export type GraduationCriterionId =
  | 'score_total'
  | 'score_auto'
  | 'forecast_count'
  | 'sustained_score'
  | 'health_ok'

export interface GraduationCriterion {
  id: GraduationCriterionId
  label: string
  pass: boolean
  value?: number
  target?: number
  note?: string
  snapshots_over_75_last_14d?: number
}

export interface GraduationEvaluation {
  ok: boolean
  project_id: string
  pass_count: number
  total: number
  graduation_ready: boolean
  criteria: GraduationCriterion[]
  error?: string
}

export async function evaluateGraduation(projectId: string): Promise<GraduationEvaluation | null> {
  const { data, error } = await supabase.rpc('evaluate_graduation', { p_project_id: projectId })
  if (error || !data) return null
  return data as GraduationEvaluation
}
