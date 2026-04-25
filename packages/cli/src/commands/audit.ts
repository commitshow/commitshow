import { resolveTarget, TargetError } from '../lib/target.js'
import {
  findProjectByGithubUrl, fetchLatestSnapshot, fetchStanding,
  runPreviewAudit, waitForPreviewSnapshot,
  type PreviewEnvelope, type PreviewError, type PreviewPending,
} from '../lib/api.js'
import {
  renderAudit, renderMarkdown, renderJson, renderUpsell,
  writeAuditMarkdown, writeAuditJson,
} from '../lib/render.js'
import { c } from '../lib/colors.js'

export async function audit(args: string[]): Promise<number> {
  const asJson = args.includes('--json')
  const positional = args.find(a => !a.startsWith('--'))

  let target
  try {
    target = resolveTarget(positional)
  } catch (err) {
    if (err instanceof TargetError) {
      emitError(asJson, 'bad_target', err.message, positional)
      return 2
    }
    throw err
  }

  if (!asJson) console.log(c.dim(`Auditing ${target.slug}…`))

  // 1. Try cached/registered flow first — avoid re-running Claude if we
  // already have the snapshot. Covers all full-audition projects.
  const project = await findProjectByGithubUrl(target.github_url)

  if (project) {
    const [snapshot, standing] = await Promise.all([
      fetchLatestSnapshot(project.id),
      fetchStanding(project.id),
    ])
    const view = { project, snapshot, standing }
    if (asJson) {
      process.stdout.write(renderJson(view) + '\n')
    } else {
      console.log('')
      console.log(renderAudit(view))
      if (project.status === 'preview') {
        console.log('')
        console.log(renderUpsell())
      }
      console.log('')
    }
    if (target.kind === 'local') {
      const mdPath   = writeAuditMarkdown(target.localPath, renderMarkdown(view))
      const jsonPath = writeAuditJson(target.localPath, renderJson(view))
      if (!asJson) {
        if (mdPath)   console.log(c.dim(`  Saved → ${mdPath}`))
        if (jsonPath) console.log(c.dim(`  Saved → ${jsonPath}`))
      }
    }
    return 0
  }

  // 2. Unregistered repo — kick off a preview audit. Full Claude depth,
  // no season entry. Rate-limited server-side.
  if (!asJson) console.log(c.dim('First time on commit.show for this repo — running a preview audit…'))

  const result = await runPreviewAudit(target.github_url)

  // Error envelope
  if ('error' in result) {
    const err = result as PreviewError
    if (err.error === 'rate_limited') {
      emitError(asJson, 'rate_limited', err.message ?? 'Rate limit hit. Try again tomorrow or sign in.', target.github_url)
      return 1
    }
    emitError(asJson, err.error, err.message ?? 'Preview audit failed.', target.github_url)
    return 1
  }

  // Background job — poll until the snapshot lands.
  let envelope: PreviewEnvelope
  if ('status' in result && result.status === 'running') {
    const pending = result as PreviewPending
    if (!asJson) console.log(c.dim('  This runs the full Claude audit · ~60-90 seconds. Hang tight.'))
    const waited = await waitForPreviewSnapshot(pending.project_id)
    if (!waited) {
      emitError(asJson, 'timeout', 'Preview audit is taking longer than expected. Try `commitshow status <repo>` in a minute.', target.github_url)
      return 1
    }
    envelope = waited
  } else {
    envelope = result as PreviewEnvelope
  }

  const view = { project: envelope.project, snapshot: envelope.snapshot, standing: null }
  if (asJson) {
    process.stdout.write(renderJson(view) + '\n')
  } else {
    console.log('')
    console.log(renderAudit(view))
    console.log('')
    console.log(renderUpsell())
    console.log('')
  }
  if (target.kind === 'local') {
    const mdPath   = writeAuditMarkdown(target.localPath, renderMarkdown(view))
    const jsonPath = writeAuditJson(target.localPath, renderJson(view))
    if (!asJson) {
      if (mdPath)   console.log(c.dim(`  Saved → ${mdPath}`))
      if (jsonPath) console.log(c.dim(`  Saved → ${jsonPath}`))
    }
  }
  return 0
}

function emitError(asJson: boolean, code: string, message: string, target?: string): void {
  if (asJson) {
    process.stdout.write(JSON.stringify({ error: code, message, target: target ?? null }) + '\n')
  } else {
    console.error(c.scarlet(message))
  }
}
