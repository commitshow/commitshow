// Lookup: ArtifactFormat → icon component. Central so UI stays consistent.
import type { ArtifactFormat } from '../lib/supabase'
import type { ExpertRole } from '../lib/analysis'
import {
  IconMcpConfig,
  IconIdeRules,
  IconAgentSkill,
  IconProjectRules,
  IconPromptPack,
  IconPatchRecipe,
  IconScaffold,
  IconArtifactGeneric,
  IconStaffEngineer,
  IconSecurityOfficer,
  IconDesigner,
  IconCeo,
} from './icons'

type IconComp = React.FC<{ size?: number }>

export const FORMAT_ICON_MAP: Record<ArtifactFormat, IconComp> = {
  mcp_config:    IconMcpConfig,
  ide_rules:     IconIdeRules,
  agent_skill:   IconAgentSkill,
  project_rules: IconProjectRules,
  prompt_pack:   IconPromptPack,
  patch_recipe:  IconPatchRecipe,
  scaffold:      IconScaffold,
}

export function FormatIcon({ format, size = 14 }: { format: ArtifactFormat | null | undefined; size?: number }) {
  const Comp = format ? FORMAT_ICON_MAP[format] : IconArtifactGeneric
  return <Comp size={size} />
}

export const ROLE_ICON_MAP: Record<ExpertRole, IconComp> = {
  staff_engineer:   IconStaffEngineer,
  security_officer: IconSecurityOfficer,
  designer:         IconDesigner,
  ceo:              IconCeo,
}

export function RoleIcon({ role, size = 16 }: { role: ExpertRole; size?: number }) {
  const Comp = ROLE_ICON_MAP[role] ?? IconStaffEngineer
  return <Comp size={size} />
}
