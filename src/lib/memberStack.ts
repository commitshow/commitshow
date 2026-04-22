// Member stack resolution (§15.6 · Hybrid auto + override).
//
//   preferred_stack (set?) → use it as override
//   otherwise             → pull union from member_stack_auto view
//                           (auto-inferred from projects.tech_layers)

import { supabase } from './supabase'

export interface EffectiveStack {
  stack: string[]              // final list of stack chips
  isAutoInferred: boolean      // true when preferred_stack is null
  autoStack: string[]          // the raw auto-derived list (for comparison)
}

export async function loadEffectiveStack(memberId: string): Promise<EffectiveStack> {
  const [memberRes, autoRes] = await Promise.all([
    supabase.from('members').select('preferred_stack').eq('id', memberId).maybeSingle(),
    supabase.from('member_stack_auto').select('stack').eq('member_id', memberId).maybeSingle(),
  ])
  const preferred = (memberRes.data?.preferred_stack ?? null) as string[] | null
  const autoStack = (autoRes.data?.stack ?? []) as string[]
  if (preferred) {
    return { stack: preferred, isAutoInferred: false, autoStack }
  }
  return { stack: autoStack, isAutoInferred: true, autoStack }
}
