/// <reference types="vite/client" />

// Vite `define` injects this at build time · resolved from the
// current git HEAD short SHA in vite.config.ts. The runtime poll in
// lib/buildVersion.ts compares it against the build_id field of
// /version.json to detect new deploys for long-lived SPA tabs.
//
// `globalThis` typing is what lib/buildVersion.ts uses; declaring it
// here keeps tsc clean without forcing every consumer to assert the
// type at the read site.
declare global {
  // eslint-disable-next-line no-var
  var __COMMITSHOW_BUILD_ID__: string
}

export {}
