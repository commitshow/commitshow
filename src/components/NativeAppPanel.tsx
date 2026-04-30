// Native-app surface · only renders when the latest snapshot's
// breakdown.is_native_app is true. Reads from
// snapshot.rich_analysis.breakdown.{native_distribution, native_completeness}.
//
// Strategic framing (errors-first · 2026-04-30 pivot): leads with the
// gates that block App Store / Play Store approval (privacy policy,
// permissions manifest), then surfaces distribution evidence as
// "where users can get this app". The score isn't repeated here;
// this panel is about *concrete things to fix*.

interface NativeDistribution {
  pts: number
  breakdown: {
    app_store:      boolean
    play_store:     boolean
    test_flight:    boolean
    f_droid:        boolean
    release_binary: boolean
  }
}

interface NativeCompleteness {
  pts: number
  breakdown: {
    privacy_policy:        boolean
    permissions_manifest:  boolean
  }
}

export interface NativeAppBreakdown {
  is_native_app:        true
  native_distribution?: NativeDistribution | null
  native_completeness?: NativeCompleteness | null
}

// Native-specific footguns surface (extension · 2026-04-30). Read from
// gh.signals so we don't duplicate detection · the native equivalent
// of AI Coder Frames but specific to mobile/desktop apps.
export interface NativeFootguns {
  permissions: {
    android_count:            number
    android_dangerous:        string[]
    ios_keys:                 string[]
    ios_missing_descriptions: string[]
  } | null
  secrets_in_bundle: {
    samples: Array<{ file: string; pattern: string }>
    total:   number
  } | null
  has_privacy_manifest:       boolean
  has_permissions_manifest:   boolean
}

interface Props {
  breakdown: NativeAppBreakdown
  footguns?: NativeFootguns | null
}

export function NativeAppPanel({ breakdown, footguns }: Props) {
  const dist = breakdown.native_distribution
  const compl = breakdown.native_completeness

  const distRows: Array<{ label: string; ok: boolean; hint: string }> = [
    { label: 'App Store',   ok: !!dist?.breakdown.app_store,      hint: 'iTunes / App Store listing link in README' },
    { label: 'Play Store',  ok: !!dist?.breakdown.play_store,     hint: 'play.google.com/store/apps link in README' },
    { label: 'TestFlight',  ok: !!dist?.breakdown.test_flight,    hint: 'testflight.apple.com/join invite link' },
    { label: 'F-Droid',     ok: !!dist?.breakdown.f_droid,        hint: 'f-droid.org/packages listing' },
    { label: 'Release binary', ok: !!dist?.breakdown.release_binary, hint: 'APK / DMG / MSI / AAB / etc mentioned in README' },
  ]

  const gateRows: Array<{ label: string; ok: boolean; hint: string }> = [
    { label: 'Privacy policy URL',   ok: !!compl?.breakdown.privacy_policy,        hint: 'Public privacy-policy URL · App Store / Play Store rejection gate' },
    { label: 'Permissions manifest', ok: !!compl?.breakdown.permissions_manifest,  hint: 'AndroidManifest.xml · Info.plist · entitlements.plist present in repo' },
  ]

  return (
    <div className="card-navy w-full max-w-full overflow-hidden" style={{ borderRadius: '2px' }}>
      {/* Header */}
      <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="font-mono text-xs tracking-widest mb-1.5" style={{ color: 'var(--gold-500)' }}>
          // NATIVE APP TRACK
        </div>
        <div className="font-display font-bold text-lg" style={{ color: 'var(--cream)' }}>
          Where this app ships, and what gatekeepers will check
        </div>
        <p className="font-light text-xs mt-1.5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          We don't run Lighthouse on a native app — the runtime is the user's phone, not a server.
          Instead we look for the things App Store / Play Store reviewers and your own users will check.
        </p>
      </div>

      {/* Store-gating row · errors-first */}
      <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="font-mono text-[10px] tracking-widest mb-3 flex items-baseline justify-between" style={{ color: 'var(--text-muted)' }}>
          <span>STORE GATES</span>
          <span className="tabular-nums" style={{ color: compl && compl.pts === 2 ? '#00D4AA' : '#F88771' }}>
            {compl?.pts ?? 0} / 2
          </span>
        </div>
        <div className="space-y-2">
          {gateRows.map(r => (
            <div key={r.label} className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] flex-shrink-0" style={{
                color: r.ok ? '#00D4AA' : '#F88771', width: 14, textAlign: 'center',
              }}>
                {r.ok ? '✓' : '✗'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs" style={{ color: r.ok ? 'var(--cream)' : '#F88771' }}>
                  {r.label}
                </div>
                <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {r.hint}
                </div>
              </div>
            </div>
          ))}
        </div>
        {compl && compl.pts < 2 && (
          <div className="mt-3 pl-3 py-2 pr-3 font-mono text-[11px]" style={{
            borderLeft: '2px solid #F88771',
            background: 'rgba(248,120,113,0.04)',
            color: '#F88771',
            lineHeight: 1.55,
          }}>
            App / Play Store will reject submissions without these.
            Add them before you ship.
          </div>
        )}
      </div>

      {/* Native footguns · errors-first frames specific to native apps */}
      {footguns && (
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="font-mono text-[10px] tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            NATIVE FOOTGUNS
          </div>
          <div className="space-y-3">
            <FootgunRow
              title="Permissions over-request"
              status={(() => {
                const p = footguns.permissions
                if (!p) return 'na'
                const danger = p.android_dangerous.length
                const missing = p.ios_missing_descriptions.length
                if (danger >= 4 || missing > 0) return 'warn'
                return 'pass'
              })()}
              finding={(() => {
                const p = footguns.permissions
                if (!p) return 'No AndroidManifest / Info.plist found.'
                const parts: string[] = []
                if (p.android_count > 0) {
                  parts.push(`${p.android_count} Android permission${p.android_count === 1 ? '' : 's'}${
                    p.android_dangerous.length > 0 ? ` (${p.android_dangerous.length} sensitive)` : ''
                  }`)
                }
                if (p.ios_keys.length > 0) {
                  parts.push(`${p.ios_keys.length} iOS usage key${p.ios_keys.length === 1 ? '' : 's'}${
                    p.ios_missing_descriptions.length > 0 ? ` · ${p.ios_missing_descriptions.length} missing descriptions` : ''
                  }`)
                }
                return parts.length > 0 ? parts.join(' · ') : 'No permission entries detected.'
              })()}
              why="Each sensitive permission you request reduces App Store approval probability and user trust. AI tools tend to request superset perms ('just in case')."
              evidence={[
                ...(footguns.permissions?.android_dangerous ?? []).slice(0, 3).map(p => `Android · ${p}`),
                ...(footguns.permissions?.ios_missing_descriptions ?? []).slice(0, 3).map(k => `iOS · ${k} (no description)`),
              ]}
            />
            <FootgunRow
              title="Secrets in native bundle"
              status={
                !footguns.secrets_in_bundle ? 'na'
                : footguns.secrets_in_bundle.total > 0 ? 'fail'
                : 'pass'
              }
              finding={
                !footguns.secrets_in_bundle ? 'No native source files scanned.'
                : footguns.secrets_in_bundle.total > 0
                  ? `${footguns.secrets_in_bundle.total} hardcoded API key${footguns.secrets_in_bundle.total === 1 ? '' : 's'} in Swift / Kotlin / Dart source.`
                  : 'No hardcoded API keys in native source.'
              }
              why="Native binaries are reverse-engineerable in minutes. Every key embedded in the IPA / APK leaks to anyone with the app. Use a server-side proxy or short-lived tokens instead."
              evidence={(footguns.secrets_in_bundle?.samples ?? []).slice(0, 3).map(s => `${s.file} · ${s.pattern}`)}
            />
            <FootgunRow
              title="iOS Privacy Manifest (PrivacyInfo.xcprivacy)"
              status={
                !footguns.has_permissions_manifest ? 'na'
                : footguns.has_privacy_manifest ? 'pass'
                : 'fail'
              }
              finding={
                !footguns.has_permissions_manifest ? 'iOS not detected (no Info.plist).'
                : footguns.has_privacy_manifest
                  ? 'PrivacyInfo.xcprivacy present.'
                  : 'No PrivacyInfo.xcprivacy file detected.'
              }
              why="Apple's 2024 App Store rule. Apps using common APIs (UserDefaults, file timestamps, system boot time, disk space) without a PrivacyInfo manifest get rejected at submission."
              evidence={[]}
            />
          </div>
        </div>
      )}

      {/* Distribution evidence */}
      <div className="px-5 py-4">
        <div className="font-mono text-[10px] tracking-widest mb-3 flex items-baseline justify-between" style={{ color: 'var(--text-muted)' }}>
          <span>DISTRIBUTION</span>
          <span className="tabular-nums" style={{ color: 'var(--gold-500)' }}>
            {dist?.pts ?? 0} / 5
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {distRows.map(r => (
            <div key={r.label} className="flex items-baseline gap-2 px-2.5 py-2" style={{
              background: r.ok ? 'rgba(0,212,170,0.04)' : 'rgba(255,255,255,0.015)',
              border: `1px solid ${r.ok ? 'rgba(0,212,170,0.25)' : 'rgba(255,255,255,0.05)'}`,
              borderRadius: '2px',
            }}>
              <span className="font-mono text-[10px] flex-shrink-0" style={{
                color: r.ok ? '#00D4AA' : 'var(--text-muted)', width: 10, textAlign: 'center',
              }}>
                {r.ok ? '●' : '○'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[11px]" style={{ color: r.ok ? 'var(--cream)' : 'var(--text-muted)' }}>
                  {r.label}
                </div>
                <div className="font-mono text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>
                  {r.hint}
                </div>
              </div>
            </div>
          ))}
        </div>
        {dist && dist.pts === 0 && (
          <div className="mt-3 font-mono text-[11px]" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
            No distribution links detected. Add an App Store / Play Store /
            TestFlight link to your README so we can verify the app is
            actually shipping somewhere users can install it.
          </div>
        )}
      </div>
    </div>
  )
}

type FgStatus = 'pass' | 'warn' | 'fail' | 'na'

function FootgunRow({ title, status, finding, why, evidence }: {
  title:    string
  status:   FgStatus
  finding:  string
  why:      string
  evidence?: string[]
}) {
  const tone =
    status === 'fail' ? '#F88771' :
    status === 'warn' ? 'var(--gold-500)' :
    status === 'pass' ? '#00D4AA' : 'var(--text-muted)'
  const dot = status === 'fail' ? '✕' : status === 'warn' ? '⚠' : status === 'pass' ? '✓' : '·'

  return (
    <div className="pl-3 py-2.5 pr-3" style={{
      borderLeft: `2px solid ${tone}`,
      background: status === 'fail' ? 'rgba(248,120,113,0.04)'
                : status === 'warn' ? 'rgba(240,192,64,0.04)'
                : 'rgba(255,255,255,0.015)',
      borderRadius: '0 2px 2px 0',
    }}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-xs" style={{ color: 'var(--cream)' }}>
          <span style={{ color: tone, marginRight: 8 }}>{dot}</span>
          {title}
        </div>
        <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: tone }}>
          {status}
        </span>
      </div>
      <div className="font-mono text-[11px] mt-1.5" style={{ color: status === 'pass' ? 'var(--text-secondary)' : 'var(--cream)' }}>
        {finding}
      </div>
      <div className="font-light text-[11px] mt-1.5" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
        {why}
      </div>
      {evidence && evidence.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {evidence.map((e, i) => (
            <div key={i} className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <span style={{ color: tone, marginRight: 6 }}>→</span>{e}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
