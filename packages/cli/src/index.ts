import { audit }   from './commands/audit.js'
import { submit }  from './commands/submit.js'
import { install } from './commands/install.js'
import { status }  from './commands/status.js'
import { login }   from './commands/login.js'
import { whoami }  from './commands/whoami.js'
import { c } from './lib/colors.js'

const VERSION = '0.1.9'

const USAGE = `
${c.bold(c.gold('commit.show'))} ${c.dim(`v${VERSION}`)}  ${c.muted('—')} ${c.cream('audit any vibe-coded project from your terminal.')}
${c.muted('the')} ${c.gold('walk-on')} ${c.muted('lane: drop in, get scored, leave · no signup, no audition, no league entry.')}

${c.muted('USAGE')}
  ${c.cream('commitshow')} ${c.gold('<command>')} [target] [flags]   ${c.dim('# CLI is `commitshow` (no dot — npm constraint)')}

${c.muted('COMMANDS')}
  ${c.gold('audit')}    [target]    run audit and render the report
  ${c.gold('status')}   [target]    latest score, no re-run
  ${c.gold('submit')}   [target]    audition a project (requires login · coming soon)
  ${c.gold('install')}  <pack>      install a library artifact (coming soon)
  ${c.gold('login')}                device-flow sign-in (coming soon)
  ${c.gold('whoami')}                who am I signed in as

${c.muted('FLAGS')}
  ${c.gold('--json')}     stable machine-readable output (for agents · CI · jq pipes)
  ${c.gold('--refresh')}  bypass the 7-day cache · re-run a fresh audit ${c.dim('(counts against IP cap)')}

${c.muted('TARGET FORMS')}  ${c.dim('(default: cwd)')}
  ${c.cream('commitshow audit')}                          ${c.dim('# cwd · git remote origin')}
  ${c.cream('commitshow audit ./my-repo')}                ${c.dim('# local path')}
  ${c.cream('commitshow audit github.com/owner/repo')}    ${c.dim('# remote shorthand')}
  ${c.cream('commitshow audit https://github.com/o/r')}   ${c.dim('# full URL')}
  ${c.cream('commitshow audit owner/repo')}               ${c.dim('# last-ditch shorthand')}

${c.muted('FOR AGENTS')}
  ${c.cream('commitshow audit github.com/owner/repo --json | jq .concerns')}
  ${c.dim(' → agent reads concerns, picks a fix target, applies edits, re-audits')}

${c.muted('LEARN MORE')}
  https://commit.show
`

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv
  let code = 0
  try {
    switch (cmd) {
      case 'audit':   code = await audit(rest);   break
      case 'status':  code = await status(rest);  break
      case 'submit':  code = await submit(rest);  break
      case 'install': code = await install(rest); break
      case 'login':   code = await login(rest);   break
      case 'whoami':  code = await whoami(rest);  break
      case '-v':
      case '--version':
        console.log(VERSION); code = 0; break
      case undefined:
      case '-h':
      case '--help':
        console.log(USAGE); code = 0; break
      default:
        console.error(c.scarlet(`Unknown command: ${cmd}`))
        console.error(USAGE)
        code = 2
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(c.scarlet(`\n  ${msg}`))
    code = 1
  }
  process.exit(code)
}
