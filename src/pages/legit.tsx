// legit — directory (Atlas) UI. Self-contained amber editorial design,
// scoped under `.lgt` / `l-` classes so it never touches the navy app.
// Reads the `listings` table (populated by the ingest engine).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  fetchNotifications, fetchUnreadCount, markRead, markAllRead,
  subscribeNotifications, destinationFor, titleFor, type NotificationRow,
} from '../lib/notifications'

export type Listing = {
  id: string; slug: string; name: string; domain: string; url: string
  platform: string | null; category: string | null
  tagline: string | null; description: string | null
  who_for: string[] | null; features: string[] | null
  pricing: string | null; how_to_use: string | null
  image_url: string | null; icon_url: string | null; source: string | null; meta: string | null
  has_pricing: boolean; js_starved: boolean
  info_as_of: string | null; created_at: string
  benchmark: Benchmark | null
  repo_audit?: RepoAudit | null
  subcategory?: string | null; submitted_by?: string | null
  verified_by?: string | null; verified_at?: string | null
}

// Repo deep-audit — code-check teardown that enriches the 7 Frames for OSS repos
// (RLS · rate limiting · webhook idempotency · error tracking · indexes · prompt
// injection · client secrets · CORS). Stored in its own column, refreshed on its
// own cadence. Each check is a measurement fact, not a verdict.
export type RepoAuditStatus = 'pass' | 'warn' | 'fail' | 'na'
export type RepoAuditCheck = { status: RepoAuditStatus; finding: string; evidence?: string | null }
export type RepoAudit = {
  scanned_at?: string; repo?: string; branch?: string; files?: number
  ai_sdk?: boolean; has_api?: boolean
  summary?: { pass: number; warn: number; fail: number; na: number }
  checks?: Record<string, RepoAuditCheck>
}

// 7-frame production-readiness benchmark (engine schema 2). Each frame is null
// when the form factor can't measure it honestly (a github URL has no rendered
// page → perf/a11y/privacy null) — null = not assessed, never a zero.
// maintenance is the conditional 8th: only set when there's a code host / linked
// repo. Legacy quality/trust/activity/transparency stay optional for old rows +
// the back-compat derivation the engine still emits.
export type FrameKey = 'performance' | 'accessibility' | 'security' | 'privacy' | 'reliability' | 'standards' | 'discoverability' | 'maintenance'
export type Benchmark = {
  performance?: number | null; accessibility?: number | null; security?: number | null
  privacy?: number | null; reliability?: number | null; standards?: number | null
  discoverability?: number | null; maintenance?: number | null
  overall: number; assessed?: number; form: string; scored_at?: string; schema?: number
  signals?: Record<string, unknown>
  // legacy 4-axis (old rows + derived) — readers migrate off these
  quality?: number; trust?: number; activity?: number; transparency?: number
}

const CSS = `
.lgt{min-height:100vh;background:#FFFFFF;color:#2C261D;font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;padding-top:60px}
.lgt a{color:inherit;text-decoration:none}
.lgt h1,.lgt h2,.lgt h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.01em;color:#211C15;margin:0}
.lgt img{max-width:100%}
.l-wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.l-h{position:fixed;top:0;left:0;right:0;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid #E9E2D4;z-index:20}
.l-hd{display:flex;align-items:center;gap:18px;height:60px}
.l-logo{font-family:Fraunces;font-weight:700;font-size:23px;color:#8A5A12;display:flex;align-items:center}
.lgt a.l-logo,.lgt a.l-logo:hover{color:#8A5A12}
.l-logoowl{height:24px;width:24px;margin-right:7px;flex-shrink:0;object-fit:contain}
.l-logoshow{color:#B5791C}
.l-dot{width:9px;height:9px;border-radius:50%;background:#B5791C;display:inline-block}
.l-catpick{display:inline-flex;align-items:center;gap:5px;font-size:14.5px;color:#6E6557;cursor:pointer;white-space:nowrap;padding-right:13px;margin-right:3px;border-right:1px solid #E0D8C8;font-weight:500}.l-catpick:hover{color:#211C15}
.l-crumbcat{display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:#6E6557}.l-crumbcat:hover{color:#211C15;text-decoration:underline}
.l-search{flex:1;max-width:380px;background:#fff;border:1px solid #E9E2D4;border-radius:8px;padding:8px 12px;color:#6F6757;font-size:14px;cursor:text;display:flex;align-items:center;gap:8px}
.l-auth{margin-left:auto;display:flex;align-items:center;gap:14px}.l-login{font-size:14px;font-weight:500;color:#6E6557;cursor:pointer}
.l-btn{background:#97600F;color:#fff;font-weight:600;font-size:14px;border:none;border-radius:8px;padding:9px 16px;cursor:pointer;display:inline-block}.l-btn:hover{background:#7E4F0C}
.l-btn.ghost{background:transparent;color:#97600F;border:1px solid #E7D4AC}
.lgt a.l-btn{color:#fff}.lgt a.l-btn.ghost{color:#97600F}
.l-rate{display:flex;align-items:center;gap:9px;margin:9px 0 13px}
.l-stars{display:inline-flex;gap:2px;align-items:center}
.l-raten{font-size:13px;color:#6F6757;font-family:'JetBrains Mono',monospace}
.l-lockic{display:block;margin:14px auto 0}
.l-avatar{width:34px;height:34px;border-radius:50%;background:#B5791C;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;cursor:pointer;font-size:15px}
/* landing hero */
.l-herobig{padding:60px 0 22px;text-align:center;background:#FCFAF5}
.l-herobig h1{font-size:clamp(34px,5vw,52px);line-height:1.05;max-width:800px;margin:0 auto}
.l-herobig .sub{font-size:18px;color:#6E6557;max-width:640px;margin:18px auto 28px;line-height:1.5}
.l-owl{display:block;width:108px;height:79px;margin:6px auto 0;position:relative;z-index:1}
.l-bigsearch{max-width:560px;margin:0 auto;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #E0D8C8;border-radius:12px;padding:14px 18px;box-shadow:0 2px 16px rgba(150,110,30,.07)}
.l-bigsearch input{border:none;outline:none;flex:1;font-size:16px;background:transparent;color:#2C261D;font-family:Inter,sans-serif}
.lgt input:focus,.lgt input:focus-visible{outline:none!important;box-shadow:none!important}
/* iOS: stop double-tap zoom on tappable controls (rating stars, vouch, chips, buttons) */
.lgt button,.lgt a,.l-starbtn,.l-vouchbtn,.l-tkchip,.l-tkthrow,.l-rxuse,.l-row{touch-action:manipulation}
.l-statrow{display:flex;gap:22px;justify-content:center;margin-top:22px;font-size:12.5px;color:#6F6757;font-family:'JetBrains Mono',monospace;flex-wrap:wrap}.l-statrow b{color:#211C15}
.l-cattiles{display:flex;flex-wrap:nowrap;gap:8px;padding:24px 0 6px;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none}.l-cattiles::-webkit-scrollbar{display:none}
.l-cattile{font-size:13.5px;color:#6E6557;background:#fff;border:1px solid #E9E2D4;border-radius:999px;padding:8px 16px;cursor:pointer;font-weight:500;white-space:nowrap;flex:0 0 auto}.l-cattile:hover{border-color:#E7D4AC;color:#211C15}.l-cattile.on{background:#97600F;color:#fff;border-color:#97600F}
.l-catwrap{position:relative}
.l-catfade{position:absolute;top:24px;right:0;bottom:6px;width:64px;pointer-events:none;background:linear-gradient(90deg,rgba(250,248,243,0) 0%,rgba(250,248,243,0) 52%,rgba(250,248,243,.92) 100%)}
.l-feedhead{display:flex;align-items:baseline;justify-content:space-between;padding:26px 0 2px;border-bottom:1px solid #E9E2D4;margin-bottom:2px}.l-feedhead h2{font-size:19px}.l-feedhead .c{font-size:12.5px;color:#6F6757;font-family:'JetBrains Mono',monospace}
.l-prehead{font-size:11.5px;font-family:'JetBrains Mono',monospace;color:#6F6757;letter-spacing:.07em;text-transform:uppercase;padding:26px 0 0}
.l-premium{display:flex;gap:16px;padding:28px 2px 8px;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:none;-ms-overflow-style:none}.l-premium::-webkit-scrollbar{display:none}.l-premium>a{flex:0 0 300px;scroll-snap-align:start}
/* PC: let the featured carousel run full viewport width, first card aligned to content */
@media(min-width:900px){.l-premium{margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);padding-left:max(24px,calc(50vw - 540px));padding-right:max(24px,calc(50vw - 540px))}.l-premium>a{flex:0 0 340px}}
.l-card{background:#fff;border:1px solid #E9E2D4;border-radius:14px;cursor:pointer;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 8px rgba(150,110,30,.04);transition:box-shadow .15s,border-color .15s,transform .15s}.l-card:hover{border-color:#E7D4AC;box-shadow:0 10px 28px rgba(150,110,30,.13);transform:translateY(-2px)}
.l-cimg{position:relative;overflow:hidden;width:100%;aspect-ratio:1200/630;background:linear-gradient(135deg,#C99A2E,#A66A18);display:flex;align-items:center;justify-content:center;color:#fff;font-family:Fraunces;font-weight:700;font-size:46px}
.l-cimg-icon{background:#fff}.l-cardicon{width:88px;height:88px;object-fit:contain;border-radius:19px;background:#fff;border:1px solid #EDE6D8}
.l-cimgcover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.l-cbody{padding:13px 16px 15px;display:flex;flex-direction:column;gap:4px}
.l-cn{font-family:Fraunces;font-weight:600;font-size:18px;color:#211C15;line-height:1.15}.l-cdm{font-size:11.5px;color:#6F6757;font-family:'JetBrains Mono',monospace}
.l-ct{font-size:13px;color:#6E6557;line-height:1.45;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* tag reactions (detail) */
.l-rx{border-top:1px solid #E9E2D4;padding:24px 0 0;margin-top:8px}
.l-rxh{font-size:20px;font-family:Fraunces,Georgia,serif;font-weight:600;color:#211C15;margin-bottom:4px}
.l-rxsub{font-size:13px;color:#6F6757;margin-bottom:16px}
.l-rxuse{display:inline-flex;align-items:center;gap:9px;background:#fff;border:1px solid #E0D8C8;border-radius:10px;padding:10px 16px;cursor:pointer;font-weight:600;font-size:14px;color:#211C15;margin-bottom:16px;transition:.12s}.l-rxuse:hover{border-color:#E7D4AC}.l-rxuse.on{background:#B5791C;color:#fff;border-color:#B5791C}.l-rxuse.on:hover{background:#97600F}
.l-rxuse .c{font-family:'JetBrains Mono',monospace;font-size:13px;opacity:.85}
.l-rxtags{display:flex;flex-wrap:wrap;gap:8px}
.l-rxt{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #E9E2D4;border-radius:999px;padding:7px 14px;cursor:pointer;font-size:13.5px;font-weight:500;color:#2C261D;transition:.12s;user-select:none}.l-rxt:hover{border-color:#E7D4AC}
.l-rxt.on{background:#F6EBD4;border-color:#E7D4AC;color:#97600F}.l-rxt.warn.on{background:#FBEFD9}
.l-rxt .c{font-family:'JetBrains Mono',monospace;font-size:12px;color:#B5A88C}.l-rxt.on .c{color:#B5791C}
/* legit tickets */
.l-ticket{display:inline-flex;align-items:center;gap:5px;font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:600;white-space:nowrap}
.l-tk{border-top:1px solid #E9E2D4;padding:24px 0 0;margin-top:8px}
.l-tkhead{display:flex;align-items:center;gap:9px;margin-bottom:5px;flex-wrap:wrap}
.l-tkh{font-size:20px;font-family:Fraunces,Georgia,serif;font-weight:600;color:#211C15}
.l-tktier{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;padding:2px 9px;border-radius:6px;border:1px solid currentColor;letter-spacing:.02em}
.l-tksub{font-size:13px;color:#6F6757;margin-bottom:14px}
.l-tkvouch{font-size:14px;color:#5A5347;margin-bottom:14px}.l-tkvouch b{color:#211C15}
.l-tkthrow{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #E0D8C8;border-radius:10px;padding:10px 16px;cursor:pointer;font-weight:600;font-size:14px;color:#211C15;margin-bottom:12px}.l-tkthrow:hover{border-color:#E7D4AC}
.l-tkchips{display:flex;flex-wrap:wrap;gap:8px}
.l-tkchip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #E9E2D4;border-radius:999px;padding:7px 14px;cursor:pointer;font-size:13.5px;font-weight:500;color:#2C261D}.l-tkchip:hover{border-color:#E7D4AC}.l-tkchip.on{background:#F6EBD4;border-color:#E7D4AC;color:#97600F}
.l-tkquota{font-size:12px;color:#6F6757;margin-top:12px;font-family:'JetBrains Mono',monospace}
/* detail */
.l-crumb{font-size:13px;color:#6E6557;padding:20px 0 0}
.l-head{padding:26px 0 8px}.l-head h1{font-size:30px}
.l-hero{display:flex;gap:22px;align-items:flex-start;padding:18px 0 26px;border-bottom:1px solid #E9E2D4}
.l-ico{width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#C99A2E,#A66A18);color:#fff;font-family:Fraunces;font-weight:700;font-size:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background-size:cover;background-position:center}
.l-one{font-size:17px;color:#6E6557;margin:7px 0 12px;max-width:600px}
.l-pills{display:flex;flex-wrap:wrap;gap:7px}.l-pill{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#6E6557;background:#F4F0E8;border:1px solid #E9E2D4;border-radius:999px;padding:3px 10px}.l-pill.plat{color:#97600F;background:#F6EBD4;border-color:#E7D4AC}
a.l-pill{cursor:pointer;text-decoration:none;transition:border-color .12s,background .12s}
a.l-pill:hover{border-color:#C9A22E;background:#F1E6CC}
.l-altcta{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:600;font-size:13.5px;color:#8A5A12;background:linear-gradient(180deg,#FCF3DC,#F6EBD4);border:1.5px solid #E0A92E;border-radius:9px;padding:10px 14px;text-decoration:none;box-shadow:0 1px 0 rgba(224,169,46,.25)}
.l-altcta:hover{background:linear-gradient(180deg,#F8EAC8,#F1E0BE);border-color:#C9A22E}
.lgt a.l-altcta,.lgt a.l-altcta:hover{color:#8A5A12}
.l-heroact{margin-left:auto;display:flex;flex-direction:column;gap:9px;align-items:stretch;flex-shrink:0;min-width:172px}.l-heroact .l-btn{text-align:center}
.l-claim{font-size:12.5px;color:#97600F;cursor:pointer;text-align:center}.l-claim:hover{text-decoration:underline}
.l-prov{font-size:11.5px;color:#6F6757;text-align:center;line-height:1.5;margin-top:2px}
@media(max-width:680px){.l-hero{flex-wrap:wrap}.l-heroact{margin-left:0;width:100%;min-width:0}}
.l-cols{display:grid;grid-template-columns:1fr 320px;gap:40px;padding:30px 0 10px}
.l-blk{margin-bottom:28px}.l-blk h2{font-size:20px;margin-bottom:10px}.l-lead{color:#2C261D}
.l-iconblk{display:flex;align-items:center;justify-content:center;background:#F4F0E8;border:1px solid #E9E2D4;border-radius:12px;padding:38px}
.l-iconimg{width:104px;height:104px;object-fit:contain;border-radius:22px;background:#fff;border:1px solid #EDE6D8}
.l-who{display:flex;flex-wrap:wrap;gap:8px}.l-chip{background:#fff;border:1px solid #E9E2D4;border-radius:7px;padding:6px 12px;font-size:13.5px;font-weight:500;color:#2C261D}
.l-feat{list-style:none;padding:0;margin:0;display:grid;gap:9px}.l-feat li{padding-left:20px;position:relative;color:#2C261D}.l-feat li::before{content:'\\2713';position:absolute;left:0;color:#B5791C;font-weight:700}
.l-note{font-size:12px;color:#6F6757;font-style:italic}
.l-facts{background:#fff;border:1px solid #E9E2D4;border-radius:12px;padding:6px 16px}.l-f{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #E9E2D4;font-size:13.5px}.l-f:last-child{border-bottom:none}.l-k{color:#6E6557}.l-v{font-weight:500;text-align:right}
.l-lab{background:#F4F0E8;border:1px solid #E9E2D4;border-radius:14px;padding:18px;font-family:'JetBrains Mono',monospace;text-align:center}.l-lh{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:#97600F;font-weight:600;text-align:left}
.l-bm{text-align:left;margin-top:10px}
.l-bmtop{display:flex;align-items:baseline;gap:2px;justify-content:center}.l-bmscore{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:42px;color:#211C15;line-height:1}.l-bmscoremax{font-size:14px;color:#6F6757}
.l-bmsrc{text-align:center;font-size:10.5px;color:#6F6757;letter-spacing:.04em;margin:4px 0 15px}
.l-bmbars{display:flex;flex-direction:column;gap:10px}
.l-bmrow{display:grid;grid-template-columns:78px 1fr 26px;align-items:center;gap:9px}
.l-bmlabel{font-family:Inter,sans-serif;font-size:12px;color:#6E6557}
.l-bmtrack{height:7px;background:#E4DCCB;border-radius:4px;overflow:hidden}.l-bmfill{display:block;height:100%;border-radius:4px;transition:width .4s}
.l-bmval{font-size:12px;color:#211C15;text-align:right;font-weight:600}
.l-bmmore{margin-top:13px;background:none;border:none;padding:0;font-size:12.5px;color:#97600F;font-weight:600;cursor:pointer}.l-bmmore:hover{text-decoration:underline}
.l-lockt{font-family:Inter,sans-serif;font-size:14px;font-weight:600;color:#211C15;margin-top:14px}.l-locksub{font-family:Inter,sans-serif;font-size:11.5px;color:#6E6557;max-width:230px;margin:6px auto 10px}
.l-engage{display:flex;align-items:center;justify-content:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.l-vouchbtn{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #E9E2D4;border-radius:999px;padding:8px 15px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:700;transition:.12s;flex-shrink:0}.l-vouchbtn:hover{border-color:#E7D4AC}.l-vouchbtn.on{background:#FCF6E9}
.l-modal{position:fixed;inset:0;background:rgba(33,28,21,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px}
.l-modalcard{position:relative;background:#FAF8F3;border:1px solid #E7D4AC;border-radius:16px;padding:24px;max-width:440px;width:100%;box-shadow:0 24px 60px rgba(60,45,20,.3)}
.l-modalclose{position:absolute;top:10px;right:14px;background:none;border:none;font-size:25px;line-height:1;color:#6F6757;cursor:pointer}.l-modalclose:hover{color:#211C15}
.l-modaltext{font-size:13.5px;color:#5A5347;line-height:1.55;margin:8px 0 14px}
.l-modalhint{font-size:12px;color:#6F6757;margin-top:10px}
.l-addbtn{font-size:13.5px;font-weight:500;color:#97600F;cursor:pointer;margin-right:16px;white-space:nowrap}
.l-addbtn:hover{color:#7A4D0C}
@media(max-width:560px){.l-addbtn{display:none}}
.l-suberr{font-size:12.5px;color:#C8102E;margin:2px 0 10px}
.l-subh{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:20px;color:#211C15;margin-bottom:4px}
.l-edlabel{display:block;font-size:11px;font-weight:600;color:#6E6557;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.04em;margin:13px 0 5px}
.l-pchips{display:flex;flex-wrap:wrap;gap:8px}
.l-pchip{font-size:13px;padding:7px 14px;border-radius:20px;border:1px solid #E0D8C8;background:#fff;color:#5A5347;cursor:pointer;user-select:none}
.l-pchip:hover{border-color:#C9A22E}
.l-pchip.on{background:#B5791C;color:#fff;border-color:#B5791C}
.l-vfy{background:#FBF6EC;border:1px solid #E7D4AC;border-radius:14px;padding:18px 20px;margin-top:36px}
.l-vfy-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:17px;color:#211C15}
.l-vfy-s{font-size:13px;color:#5A5347;margin:4px 0 14px;line-height:1.55}
.l-vfy-step{font-size:12.5px;color:#6E6557;margin:12px 0 6px;line-height:1.55}
.l-vfy-step code{background:#F1EADE;border-radius:4px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#5A5347}
.l-vfy-code{position:relative;background:#2C261D;color:#E8DFCD;font-family:'JetBrains Mono',monospace;font-size:12px;padding:11px 42px 11px 13px;border-radius:8px;cursor:pointer;word-break:break-all;line-height:1.5}
.l-vfy-copy{position:absolute;top:9px;right:11px;font-size:10px;color:#9A8C6E;text-transform:uppercase;letter-spacing:.04em}
.l-vfy.l-vfy-ok{display:flex;align-items:center;gap:9px;background:#EAF6EE;border-color:#BFE3CC;color:#1E7A3D;font-weight:600;font-size:14.5px}
.l-claimline{margin-top:30px;padding-top:18px;border-top:1px solid #F1EADE;font-size:13px}
.l-claimlink{color:#97600F;cursor:pointer}.l-claimlink:hover{color:#7A4D0C}
.l-claimverified{display:inline-flex;align-items:center;gap:7px;color:#1E7A3D;font-weight:600}
/* legit auth modal */
.l-authcard{position:relative;background:#FAF8F3;border:1px solid #E7D4AC;border-radius:18px;padding:30px 28px 24px;max-width:380px;width:100%;box-shadow:0 24px 60px rgba(60,45,20,.3)}
.l-authlogo{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:22px;color:#B5791C;text-align:center}
.l-authh{font-family:Fraunces,Georgia,serif;font-size:18px;color:#211C15;text-align:center;margin:5px 0 20px;font-weight:600}
.l-oauth{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;border:1px solid #E0D8C8;border-radius:10px;padding:11px;font-size:14px;font-weight:500;color:#211C15;cursor:pointer;margin-bottom:9px;font-family:Inter,sans-serif}.l-oauth:hover{border-color:#E7D4AC;background:#FCFAF5}
.l-author{display:flex;align-items:center;gap:12px;margin:14px 0;color:#6F6757;font-size:12px;font-family:'JetBrains Mono',monospace}.l-author::before,.l-author::after{content:'';flex:1;height:1px;background:#E9E2D4}
.l-authin{width:100%;border:1px solid #E0D8C8;border-radius:10px;padding:11px 13px;font-size:14px;font-family:Inter,sans-serif;margin-bottom:9px;box-sizing:border-box;background:#fff;color:#2C261D}
.lgt select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239A9080' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:38px}.l-authin:focus{outline:none;border-color:#C9A22E}
.l-autherr{font-size:12.5px;color:#C8102E;margin:1px 0 9px}
.l-authsubmit{width:100%;text-align:center;padding:11px;margin-top:3px}
.l-authtoggle{text-align:center;font-size:13px;color:#6E6557;margin-top:16px}.l-authtoggle span{color:#97600F;cursor:pointer;font-weight:500}.l-authtoggle span:hover{text-decoration:underline}
.l-authsent{font-size:14px;color:#2C261D;text-align:center;line-height:1.55;padding:12px 0}
.l-authemail{text-align:center;font-size:13px;color:#97600F;cursor:pointer;margin-top:12px;font-weight:500}.l-authemail:hover{text-decoration:underline}
.l-authowl{display:block;width:76px;height:auto;margin:2px auto 0}
.l-react{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:130;pointer-events:none}
.l-reactcard{pointer-events:auto;background:#FFFDF8;border:1px solid #E7D4AC;border-radius:18px;padding:24px 34px;text-align:center;box-shadow:0 24px 60px rgba(60,45,20,.28);animation:l-pop .26s cubic-bezier(.2,1.3,.5,1);cursor:pointer}
@keyframes l-pop{0%{transform:scale(.7);opacity:0}100%{transform:scale(1);opacity:1}}
.l-reacttitle{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:18px;color:#211C15;margin-top:9px}
.l-reactsub{font-size:13px;color:#6E6557;margin-top:3px}
.l-rateset{display:flex;align-items:center;gap:13px;flex-wrap:wrap}
.l-rateset-l{font-size:14px;color:#6E6557;font-weight:500}
.l-rateset-stars{display:inline-flex;gap:3px}
.l-starbtn{background:none;border:none;padding:0;cursor:pointer;line-height:0;display:inline-flex}.l-starbtn:hover{transform:scale(1.08)}
.l-rateset-c{font-size:12.5px;color:#6F6757;font-family:'JetBrains Mono',monospace}
.l-rvwrap{margin-top:4px}
.l-rvprompt{font-size:13.5px;color:#6E6557;background:#F4F0E8;border:1px dashed #E9E2D4;border-radius:10px;padding:14px 16px;margin-bottom:16px}
.l-rvwrite{margin-bottom:18px}
.l-rvta{width:100%;min-height:92px;border:1px solid #E0D8C8;border-radius:10px;padding:11px 13px;font-family:Inter,sans-serif;font-size:14px;line-height:1.5;resize:vertical;background:#fff;color:#2C261D;box-sizing:border-box}
.l-rvactions{display:flex;justify-content:flex-end;gap:14px;align-items:center;margin-top:9px}
.l-rvmine{background:#FBF6EC;border:1px solid #E7D4AC;border-radius:11px;padding:13px 15px;margin-bottom:18px}
.l-rvmineh{display:flex;align-items:center;gap:8px;margin-bottom:6px}.l-rvyou{font-size:12px;font-weight:600;color:#97600F;font-family:'JetBrains Mono',monospace}
.l-rvlist{display:flex;flex-direction:column;gap:20px;margin-top:6px}
.l-rvitem{display:flex;gap:12px}
.l-rvav{width:38px;height:38px;border-radius:50%;background:#B5791C;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:15px;flex-shrink:0;overflow:hidden;background-size:cover;background-position:center}
.l-rvhead{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.l-rvname{font-weight:600;font-size:14px;color:#211C15}.l-rvmeta{font-size:11.5px;color:#6F6757;font-family:'JetBrains Mono',monospace}
.l-rvbody{font-size:14px;color:#2C261D;line-height:1.55;margin-top:5px;white-space:pre-wrap;word-break:break-word}
.l-reviews{border-top:1px solid #E9E2D4;padding:26px 0 0;margin-top:8px}.l-empty{font-size:13px;color:#6E6557;background:#F4F0E8;border:1px dashed #E9E2D4;border-radius:10px;padding:16px}
.l-claimcta{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;background:#FBF6EC;border:1px solid #E7D4AC;border-radius:14px;padding:18px 22px;margin-top:36px}
.l-claimcta-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:17px;color:#211C15}.l-claimcta-s{font-size:13px;color:#6E6557;margin-top:3px}
.l-claimcta .l-btn{flex-shrink:0}
.l-foot{border-top:1px solid #E9E2D4;margin-top:28px;padding:22px 0 50px;font-size:12.5px;color:#6F6757}
.l-ft{border-top:1px solid #E9E2D4;margin-top:44px;background:#FCFAF5}
.l-ftin{display:flex;gap:40px;justify-content:space-between;flex-wrap:wrap;padding:34px 24px 22px}
.l-ftbrand{max-width:380px}
.l-ftlogo{display:inline-flex;align-items:center;font-family:Fraunces,Georgia,serif;font-weight:600;font-size:20px;color:#8A5A12;text-decoration:none}
.lgt a.l-ftlogo,.lgt a.l-ftlogo:hover{color:#8A5A12}
.l-ftowl{height:22px;width:22px;margin-right:6px;object-fit:contain}
.l-fttag{font-size:13px;color:#6E6557;line-height:1.55;margin:9px 0 0}
.l-ftnav{display:flex;flex-direction:column;gap:9px;font-size:13.5px}
.l-ftnav a,.l-ftnav span{color:#6E6557;text-decoration:none;cursor:pointer}.l-ftnav a:hover,.l-ftnav span:hover{color:#97600F}
.l-ftbar{display:flex;gap:18px;justify-content:space-between;flex-wrap:wrap;align-items:baseline;padding:0 24px 40px;font-size:11.5px;color:#6F6757;line-height:1.55}
.l-ftbar>span:first-child{max-width:640px}
.l-ftcc{font-family:'JetBrains Mono',monospace;white-space:nowrap}
@media(max-width:640px){.l-ftnav{flex-direction:row;flex-wrap:wrap;gap:16px}}
@media(max-width:560px){.l-ftin{padding:28px 20px 18px;gap:22px}.l-ftbar{padding:0 20px 32px;flex-direction:column;gap:9px}}
.l-row{display:flex;gap:18px;align-items:flex-start;padding:20px 4px;cursor:pointer;border-radius:10px;transition:background .12s}.l-row:hover{background:#fff}
.l-ic{width:72px;height:72px;border-radius:14px;background:linear-gradient(135deg,#C99A2E,#A66A18);color:#fff;font-weight:700;font-size:30px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:Fraunces;background-size:cover;background-position:center;overflow:hidden}
.l-fav{background:#fff;border:1px solid #EDE6D8}.l-fav img{width:100%;height:100%;object-fit:cover}
.l-fav-mark{background:#FBF6EC}.l-fav-mark img{object-fit:contain;padding:16%;box-sizing:border-box}
.l-nm{font-weight:600;color:#211C15;font-size:19px;font-family:Fraunces,Georgia,serif;line-height:1.2}.l-dm{font-size:12.5px;color:#6F6757;font-family:'JetBrains Mono',monospace;font-weight:400}.l-ol{font-size:15px;color:#524B3F;margin-top:5px;line-height:1.55;max-width:680px;display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.l-tag{font-size:11px;font-family:'JetBrains Mono',monospace;padding:3px 9px;border-radius:5px;background:#F4F0E8;color:#6E6557;border:1px solid #E9E2D4}.l-tag.warn{background:#FBEFD9;color:#97600F;border-color:#E7D4AC}
.l-score{font-size:11.5px;font-family:'JetBrains Mono',monospace;font-weight:700;padding:3px 9px;border-radius:5px;background:#F6EBD4;color:#97600F;border:1px solid #E7D4AC}
/* header nav + dropdowns + bell */
.l-nav{display:flex;align-items:center;gap:4px}
.l-navi{font-size:14px;font-weight:500;color:#6E6557;padding:7px 11px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}.l-navi:hover{background:#F1EADE;color:#211C15}.l-navi.on{color:#211C15;background:#F1EADE}
.l-ddwrap{position:relative}
.l-dd{position:absolute;top:calc(100% + 8px);min-width:210px;background:#fff;border:1px solid #E9E2D4;border-radius:12px;box-shadow:0 12px 34px rgba(60,45,20,.16);padding:6px;z-index:40;scrollbar-width:none;-ms-overflow-style:none}.l-dd::-webkit-scrollbar{display:none}
.l-dd.right{right:0}.l-dd.left{left:0}
.l-ddi{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;font-size:14px;color:#2C261D;cursor:pointer;white-space:nowrap}.l-ddi:hover{background:#F4F0E8}.l-ddi .s{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#6F6757}.l-ddi.on{background:#F6EBD4;color:#97600F;font-weight:600}
.l-ddsep{height:1px;background:#E9E2D4;margin:6px 8px}
.l-ddhead{padding:11px 11px 7px}.l-ddname{font-weight:600;font-size:14.5px;color:#211C15}.l-ddmail{font-size:12px;color:#6F6757;margin-top:1px;overflow:hidden;text-overflow:ellipsis}
.l-ddtk{padding:9px 11px}.l-ddtk-h{display:flex;align-items:center;gap:7px;font-size:13.5px;color:#2C261D;font-weight:500}.l-ddtk-s{display:block;font-size:12px;color:#6F6757;font-family:'JetBrains Mono',monospace;margin-top:4px;margin-left:21px}
.l-bell{position:relative;width:36px;height:36px;border-radius:9px;border:1px solid #E9E2D4;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#6E6557}.l-bell:hover{border-color:#E7D4AC;color:#211C15}
.l-belldot{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;background:#C8102E;color:#fff;border:2px solid #FAF8F3;border-radius:9px;font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center}
.l-npnl{position:absolute;top:calc(100% + 8px);right:0;width:340px;max-height:72vh;overflow-y:auto;background:#fff;border:1px solid #E9E2D4;border-radius:12px;box-shadow:0 14px 38px rgba(60,45,20,.18);z-index:40}
.l-nph{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #E9E2D4;position:sticky;top:0;background:#fff}.l-nph b{font-family:Fraunces;font-size:15px;color:#211C15}.l-nmark{font-size:12px;color:#97600F;cursor:pointer;font-weight:500}
.l-nr{display:flex;gap:11px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid #F1EADE;cursor:pointer}.l-nr:hover{background:#FBF8F1}.l-nr.unread{background:#FCF6E9}.l-nr.unread:hover{background:#F9F0DD}
.l-nav-av{width:30px;height:30px;border-radius:8px;background:#B5791C;color:#fff;font-weight:600;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;background-size:cover;background-position:center;font-family:'JetBrains Mono',monospace}
.l-nrt{font-size:13px;color:#2C261D;line-height:1.45}.l-nrtime{font-size:11px;color:#6F6757;font-family:'JetBrains Mono',monospace;margin-top:2px}
.l-nempty{padding:34px 20px;text-align:center;font-size:13px;color:#6F6757}
.l-nempty b{display:block;font-family:Fraunces;font-size:14px;color:#6E6557;margin-bottom:5px;font-weight:600}
@media(max-width:680px){.l-nav{display:none}.l-npnl{width:300px}}
@media(max-width:820px){.l-cols{grid-template-columns:1fr}.l-search{display:none}.lgt input,.lgt textarea,.lgt select{font-size:16px}}
`

let fontInjected = false
export function LegitStyles() {
  if (typeof document !== 'undefined' && !fontInjected) {
    fontInjected = true
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap'
    document.head.appendChild(l)
  }
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />
}

// ── auth (reuses the app's existing AuthModal + useAuth) ──
type AuthMode = 'signin' | 'signup'
const LegitAuthCtx = createContext<{ openAuth: (m?: AuthMode) => void; openSubmit: () => void; loggedIn: boolean }>({ openAuth: () => {}, openSubmit: () => {}, loggedIn: false })
export const useLegitAuth = () => useContext(LegitAuthCtx)

export function LegitShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AuthMode>('signin')
  const { user, member, signOut } = useAuth() as {
    user: { id?: string; email?: string } | null
    member: { display_name?: string; avatar_url?: string | null; is_admin?: boolean } | null
    signOut: (redirectTo?: string) => Promise<void>
  }
  const openAuth = (m: AuthMode = 'signin') => { setMode(m); setOpen(true) }
  const navShell = useNavigate()
  // Submitting needs an account (attribution + later claim) — sign in first,
  // then go to the proper submit page.
  const openSubmit = () => { if (!user) { openAuth('signup'); return } navShell('/add') }
  const name = member?.display_name || user?.email?.split('@')[0] || 'You'
  const initial = name.trim()[0]?.toUpperCase() || '?'

  return (
    <LegitAuthCtx.Provider value={{ openAuth, openSubmit, loggedIn: !!user }}>
      <div className="lgt">
        <LegitStyles />
        <header className="l-h">
          <div className="l-wrap l-hd">
            <Link to="/" className="l-logo"><img className="l-logoowl" src="/favicon2.png" alt="" width="24" height="24" />Legit</Link>
            <div className="l-auth" style={{ marginLeft: 'auto' }}>
              <span className="l-addbtn" onClick={openSubmit}>+ Add your service</span>
              {user
                ? <>
                    <LegitBell recipientId={user.id || ''} />
                    <ProfileMenu name={name} email={user.email || ''} initial={initial} avatar={member?.avatar_url || null} isAdmin={!!member?.is_admin} memberId={user.id || ''} onSignOut={() => signOut('/')} />
                  </>
                : <span className="l-btn" onClick={() => openAuth('signin')}>Start</span>}
            </div>
          </div>
        </header>
        {children}
        <LegitFooter />
      </div>
      <LegitAuthModal open={open} onClose={() => setOpen(false)} initialMode={mode} />
      <ReactionToast />
    </LegitAuthCtx.Provider>
  )
}

// Shared Legit footer — one consistent footer across every /v2 page.
function LegitFooter() {
  const year = new Date().getFullYear()
  const { openSubmit } = useLegitAuth()
  return (
    <footer className="l-ft">
      <div className="l-wrap l-ftin">
        <div className="l-ftbrand">
          <Link to="/" className="l-ftlogo"><img className="l-ftowl" src="/favicon2.png" alt="" width="22" height="22" />Legit</Link>
          <p className="l-fttag">Every launched service, tested — what it does, who it&apos;s for, and an objective benchmark.</p>
        </div>
        <nav className="l-ftnav">
          <Link to="/">Directory</Link>
          <Link to="/insights">Insights</Link>
          <span onClick={openSubmit}>Add your service</span>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
      </div>
      <div className="l-wrap l-ftbar">
        <span>legit structures publicly available information on launched services. Listings reflect each provider&apos;s own materials — confirm details on the official site.</span>
        <span className="l-ftcc">© {year} Madeflo Inc.</span>
      </div>
    </footer>
  )
}

// Friendly pricing input — pick a model (chips), add an optional price detail.
// Composes a readable `pricing` string + a `hasPricing` flag (Free = false).
const PRICING_MODELS = ['Free', 'Freemium', 'Paid', 'Subscription', 'Contact'] as const
type PModel = typeof PRICING_MODELS[number]
function inferPModel(p: string): PModel | '' {
  if (!p) return ''
  if (/freemium|free (tier|plan)/i.test(p)) return 'Freemium'
  if (/^\s*free\s*$/i.test(p)) return 'Free'
  if (/contact|enterprise|custom (quote|pricing)|talk to|get a quote/i.test(p)) return 'Contact'
  if (/\/mo\b|\/month|per month|per year|\/yr\b|monthly|annually|subscription/i.test(p)) return 'Subscription'
  return 'Paid'
}
function composePricing(model: PModel | '', detail: string): { pricing: string; hasPricing: boolean } {
  const d = detail.trim()
  switch (model) {
    case 'Free': return { pricing: 'Free', hasPricing: false }
    case 'Contact': return { pricing: 'Contact for pricing', hasPricing: true }
    case 'Freemium': return { pricing: d ? `Freemium · ${d}` : 'Freemium', hasPricing: true }
    case 'Paid': return { pricing: d || 'Paid', hasPricing: true }
    case 'Subscription': return { pricing: d || 'Subscription', hasPricing: true }
    default: return { pricing: '', hasPricing: false }
  }
}
export function PricingField({ initial, onChange }: { initial: string; onChange: (pricing: string, hasPricing: boolean) => void }) {
  const guess = inferPModel(initial)
  const [model, setModel] = useState<PModel | ''>(guess)
  const [detail, setDetail] = useState(guess === 'Freemium' || guess === 'Paid' || guess === 'Subscription' ? initial.replace(/^freemium\s*·\s*/i, '') : '')
  const showDetail = model === 'Freemium' || model === 'Paid' || model === 'Subscription'
  const emit = (m: PModel | '', d: string) => { const r = composePricing(m, d); onChange(r.pricing, r.hasPricing) }
  const pick = (m: PModel) => {
    const nm: PModel | '' = m === model ? '' : m
    const keepDetail = nm === 'Freemium' || nm === 'Paid' || nm === 'Subscription'
    setModel(nm); if (!keepDetail) setDetail('')
    emit(nm, keepDetail ? detail : '')
  }
  return (
    <div>
      <div className="l-pchips">
        {PRICING_MODELS.map(m => <span key={m} className={`l-pchip ${model === m ? 'on' : ''}`} onClick={() => pick(m)}>{m === 'Contact' ? 'Contact us' : m}</span>)}
      </div>
      {showDetail && (
        <input className="l-authin" style={{ marginTop: 9, marginBottom: 0 }} value={detail}
          placeholder="e.g. $29/mo · from $10 · $99 one-time" onChange={e => { setDetail(e.target.value); emit(model, e.target.value) }} />
      )}
    </div>
  )
}

// Domain ownership verification — add a meta tag (or DNS TXT), we fetch & confirm.
// Shared by the submit flow (final step) and the listing page (claim later).
export function VerifyOwnership({ listingId, domain, verified, onVerified }: { listingId: string; domain: string; verified: boolean; onVerified: () => void }) {
  const { user } = useAuth() as { user: { id?: string } | null }
  const { openAuth } = useLegitAuth()
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (verified) {
    return (
      <div className="l-vfy l-vfy-ok">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        Ownership verified
      </div>
    )
  }

  const getCode = async () => {
    setBusy(true); setMsg(null)
    try {
      const { data } = await supabase.functions.invoke('ingest-directory', { body: { action: 'verify_token', id: listingId } })
      const d = (data || {}) as { token?: string; verified?: boolean; error?: string }
      if (d.verified) { onVerified(); return }
      if (d.token) setToken(d.token); else setMsg('Could not start verification. Please try again.')
    } catch { setMsg('Network error. Please try again.') }
    setBusy(false)
  }
  const doVerify = async () => {
    setBusy(true); setMsg(null)
    try {
      const { data } = await supabase.functions.invoke('ingest-directory', { body: { action: 'verify', id: listingId } })
      const d = (data || {}) as { verified?: boolean; message?: string }
      if (d.verified) { onVerified(); return }
      setMsg(d.message || "Couldn't verify yet."); setBusy(false)
    } catch { setMsg('Network error. Please try again.'); setBusy(false) }
  }
  const tag = token ? `<meta name="legit-verify" content="${token}">` : ''

  return (
    <div className="l-vfy">
      <div className="l-vfy-h">Verify ownership</div>
      <div className="l-vfy-s">Prove you control {domain} to manage this listing and earn a verified badge.</div>
      {!user ? (
        <span className="l-btn" onClick={() => openAuth('signup')}>Sign in to verify</span>
      ) : !token ? (
        <span className="l-btn" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={getCode}>{busy ? 'Starting…' : 'Get verification tag'}</span>
      ) : (
        <>
          <div className="l-vfy-step">1. Add this to your site&apos;s <code>&lt;head&gt;</code>:</div>
          <div className="l-vfy-code" onClick={() => { try { navigator.clipboard?.writeText(tag) } catch { /* noop */ } setCopied(true) }}>{tag}<span className="l-vfy-copy">{copied ? 'copied' : 'copy'}</span></div>
          <div className="l-vfy-step">…or add a DNS TXT record <code>_legit.{domain}</code> = <code>{token}</code></div>
          <span className="l-btn" style={{ marginTop: 12, opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={doVerify}>{busy ? 'Checking…' : "I've added it — Verify"}</span>
          {msg && <div className="l-suberr" style={{ marginTop: 10 }}>{msg}</div>}
        </>
      )}
    </div>
  )
}

// click-outside helper
function useClickAway(onAway: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onAway() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onAway])
  return ref
}

function Chevron() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
}

// Reusable category dropdown — used in the hero search box and the detail
// breadcrumb. Fetches distinct categories and navigates to /?cat=…
export function CategoryPicker({ current = null, variant = 'crumb' }: { current?: string | null; variant?: 'search' | 'crumb' }) {
  const [cats, setCats] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const ref = useClickAway(() => setOpen(false))
  useEffect(() => {
    let alive = true
    supabase.from('listings').select('category').not('category', 'is', null).then(({ data }) => {
      if (!alive) return
      const m = new Map<string, number>()
      for (const r of (data as { category: string }[] | null) || []) m.set(r.category, (m.get(r.category) || 0) + 1)
      setCats([...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 30))
    })
    return () => { alive = false }
  }, [])
  const go = (c?: string) => { setOpen(false); nav(c ? `/?cat=${encodeURIComponent(c)}` : '/') }
  // search box: keep the trigger short — "All" default, long names truncated
  const label = current ? (variant === 'search' && current.length > 10 ? current.slice(0, 10) + '…' : current) : 'All'
  return (
    <div className="l-ddwrap" ref={ref} onClick={e => e.preventDefault()}>
      <span className={variant === 'search' ? 'l-catpick' : 'l-crumbcat'} onClick={() => setOpen(o => !o)} title={current || 'All'}>
        {label} <Chevron />
      </span>
      {open && (
        <div className="l-dd left" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <div className={`l-ddi ${!current ? 'on' : ''}`} onClick={() => go()}>All categories</div>
          {cats.length > 0 && <div className="l-ddsep" />}
          {cats.map(c => <div key={c} className={`l-ddi ${c === current ? 'on' : ''}`} onClick={() => go(c)}>{c}</div>)}
        </div>
      )}
    </div>
  )
}

function ProfileMenu({ name, email, initial, avatar, isAdmin, memberId, onSignOut }: { name: string; email: string; initial: string; avatar: string | null; isAdmin: boolean; memberId: string; onSignOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(0)
  const nav = useNavigate()
  const { openSubmit } = useLegitAuth()
  const ref = useClickAway(() => setOpen(false))
  const go = (to: string) => { setOpen(false); nav(to) }

  useEffect(() => {
    if (!open || !memberId) return
    const load = () => {
      const d = new Date(); const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
      supabase.from('listing_tickets').select('listing_id', { count: 'exact', head: true }).eq('member_id', memberId).gte('created_at', monthStart)
        .then(({ count }) => setUsed(count || 0))
    }
    load()
    window.addEventListener('legit:tickets', load)
    return () => window.removeEventListener('legit:tickets', load)
  }, [open, memberId])

  return (
    <div className="l-ddwrap" ref={ref}>
      <div className="l-avatar" style={avatar ? { backgroundImage: `url(${avatar})`, backgroundSize: 'cover' } : undefined} onClick={() => setOpen(o => !o)} title={name}>
        {!avatar && initial}
      </div>
      {open && (
        <div className="l-dd right">
          <div className="l-ddhead">
            <div className="l-ddname">{name}</div>
            {email && <div className="l-ddmail">{email}</div>}
          </div>
          <div className="l-ddsep" />
          <div className="l-ddtk">
            <span className="l-ddtk-h"><LegitSeal size={14} color="#B5791C" /> Legit tickets</span>
            <span className="l-ddtk-s">{Math.max(0, TICKET_QUOTA - used)} of {TICKET_QUOTA} left this month</span>
          </div>
          <div className="l-ddsep" />
          <div className="l-ddi" onClick={() => go('/me')}>Profile &amp; settings</div>
          <div className="l-ddi" onClick={() => go('/me/products')}>My products</div>
          <div className="l-ddi" onClick={() => go('/library')}>Library</div>
          <div className="l-ddsep" />
          <div className="l-ddi" onClick={() => { setOpen(false); openSubmit() }}>Add your service</div>
          {isAdmin && <>
            <div className="l-ddsep" />
            <div className="l-ddi" style={{ color: '#97600F', fontWeight: 600 }} onClick={() => go('/v2/admin')}>Directory admin</div>
          </>}
          <div className="l-ddsep" />
          <div className="l-ddi" onClick={async () => { setOpen(false); await onSignOut() }}>Sign out</div>
        </div>
      )}
    </div>
  )
}

function bellTimeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  const d = Math.floor(s / 86400)
  return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`
}

// amber-styled bell · reuses the real notifications data layer (lib/notifications)
function LegitBell({ recipientId }: { recipientId: string }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [rows, setRows] = useState<NotificationRow[] | null>(null)
  const ref = useClickAway(() => setOpen(false))
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])

  useEffect(() => {
    if (!recipientId) return
    fetchUnreadCount().then(setUnread)
    const unsub = subscribeNotifications(recipientId, () => {
      fetchUnreadCount().then(setUnread)
      if (openRef.current) fetchNotifications(25).then(setRows)
    })
    return unsub
  }, [recipientId])

  useEffect(() => { if (open && rows === null) fetchNotifications(25).then(setRows) }, [open, rows])

  const onRow = async (n: NotificationRow) => {
    setOpen(false)
    if (n.kind !== 'ticket_gift' && !n.read_at) {
      await markRead(n.id)
      setUnread(c => Math.max(0, c - 1))
      setRows(prev => prev?.map(r => r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r) ?? prev)
    }
    const dest = destinationFor(n)
    if (dest) nav(dest)
  }
  const onMarkAll = async () => {
    await markAllRead(recipientId)
    setUnread(0)
    setRows(prev => prev?.map(r => r.read_at ? r : { ...r, read_at: new Date().toISOString() }) ?? prev)
  }

  return (
    <div className="l-ddwrap" ref={ref}>
      <div className="l-bell" onClick={() => setOpen(o => !o)} aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="l-belldot">{unread > 99 ? '99+' : unread}</span>}
      </div>
      {open && (
        <div className="l-npnl">
          <div className="l-nph">
            <b>Notifications</b>
            {unread > 0 && <span className="l-nmark" onClick={onMarkAll}>Mark all read</span>}
          </div>
          {rows === null
            ? <div className="l-nempty">Loading…</div>
            : rows.length === 0
              ? <div className="l-nempty"><b>Nothing yet</b>When someone applauds your work or forecasts on your project, you&apos;ll see it here.</div>
              : rows.map(n => {
                  const av = n.actor_avatar_url
                  const ini = (n.actor_display_name ?? '?').slice(0, 1).toUpperCase()
                  return (
                    <div key={n.id} className={`l-nr ${n.read_at ? '' : 'unread'}`} onClick={() => onRow(n)}>
                      <div className="l-nav-av" style={av ? { backgroundImage: `url(${av})` } : undefined}>{!av && ini}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="l-nrt">{titleFor(n)}</div>
                        <div className="l-nrtime">{bellTimeAgo(n.created_at)}</div>
                      </div>
                    </div>
                  )
                })}
        </div>
      )}
    </div>
  )
}

export function SearchIcon({ size = 17, color = '#6F6757' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="7" /><line x1="20.5" y1="20.5" x2="16.5" y2="16.5" />
    </svg>
  )
}

// Stars carry the rating shape; their COLOR carries the legit-ticket tier
// (tone) — so a crowd-vouched product reads "hotter" even before reviews exist.
export function StarRating({ value = 0, count = 0, size = 18, tone = '#E0A92E', bare = false }: { value?: number; count?: number; size?: number; tone?: string; bare?: boolean }) {
  const stars = [0, 1, 2, 3, 4].map(i => {
    const fill = Math.max(0, Math.min(1, value - i)) // 0..1 per star
    return (
      <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id={`lg-star-${i}`}>
            <stop offset={`${fill * 100}%`} stopColor={tone} />
            <stop offset={`${fill * 100}%`} stopColor="#E4D9C2" />
          </linearGradient>
        </defs>
        <path d="M12 2.5l2.9 6.2 6.6.9-4.8 4.6 1.2 6.6L12 18.7 6 21.4l1.2-6.6L2.4 9.6l6.6-.9z"
          fill={`url(#lg-star-${i})`} stroke={tone} strokeOpacity="0.7" strokeWidth="0.8" />
      </svg>
    )
  })
  if (bare) return <span className="l-stars">{stars}</span>
  return (
    <div className="l-rate">
      <span className="l-stars">{stars}</span>
      <span className="l-raten">{count > 0 ? `${value.toFixed(1)} · ${count} review${count === 1 ? '' : 's'}` : 'No ratings yet'}</span>
    </div>
  )
}

// Interactive star rating — click 1-5 to rate (re-click your score to clear).
// Aggregates feed the hero StarRating; tone follows the legit-ticket tier.
export function RatingPanel({ listingId, tone = '#E0A92E' }: { listingId: string; tone?: string }) {
  const { openAuth, loggedIn } = useLegitAuth()
  const { user } = useAuth() as { user: { id?: string } | null }
  const myId = user?.id || null
  const [mine, setMine] = useState(0)
  const [hover, setHover] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (myId) supabase.from('listing_reviews').select('rating').eq('listing_id', listingId).eq('member_id', myId).maybeSingle()
      .then(({ data }) => { if (alive) setMine((data as { rating: number } | null)?.rating || 0) })
    return () => { alive = false }
  }, [listingId, myId])

  const set = async (r: number) => {
    if (!loggedIn || !myId) { openAuth('signup'); return }
    if (busy) return
    setBusy(true)
    const prev = mine
    const next = r === mine ? 0 : r
    setMine(next)
    const q = next === 0
      ? supabase.from('listing_reviews').delete().eq('listing_id', listingId).eq('member_id', myId)
      : supabase.from('listing_reviews').upsert({ listing_id: listingId, member_id: myId, rating: next, updated_at: new Date().toISOString() }, { onConflict: 'listing_id,member_id' })
    const { error } = await q
    if (error) setMine(prev)
    else {
      window.dispatchEvent(new Event('legit:rating'))
      if (next > 0) fireReaction({ icon: 'star', tone, title: `Rated ${next} star${next > 1 ? 's' : ''}`, sub: 'Thanks for weighing in' })
      else fireReaction({ icon: 'star', tone: '#C9BBA0', title: 'Rating removed' })
    }
    setBusy(false)
  }

  const shown = hover || mine
  return (
    <div className="l-rateset">
      <span className="l-rateset-l">{mine ? 'Your rating' : 'Rate this'}</span>
      <span className="l-rateset-stars" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} className="l-starbtn" onMouseEnter={() => setHover(n)} onClick={() => set(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.5l2.9 6.2 6.6.9-4.8 4.6 1.2 6.6L12 18.7 6 21.4l1.2-6.6L2.4 9.6l6.6-.9z"
                fill={n <= shown ? tone : '#E4D9C2'} stroke={n <= shown ? tone : '#B9A684'} strokeOpacity={n <= shown ? 0.5 : 0.95} strokeWidth={n <= shown ? 0.7 : 1.2} />
            </svg>
          </button>
        ))}
      </span>
      {!loggedIn && <span className="l-rateset-c">sign in to rate</span>}
    </div>
  )
}

type ReviewRow = { id: string; member_id: string; rating: number; body: string; created_at: string; display_name: string | null; avatar_url: string | null }
function reviewTimeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return 'just now'
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

// Written reviews. A review = the member's rating + body on the same row, so it
// stays consistent with the quick star rating above. Requires a rating first.
export function ReviewsSection({ listingId }: { listingId: string }) {
  const { openAuth, loggedIn } = useLegitAuth()
  const { user } = useAuth() as { user: { id?: string } | null }
  const myId = user?.id || null
  const [myRating, setMyRating] = useState(0)
  const [myBody, setMyBody] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [list, setList] = useState<ReviewRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  const loadList = () => supabase.from('listing_reviews_feed').select('*').eq('listing_id', listingId).order('created_at', { ascending: false })
    .then(({ data }) => setList((data as ReviewRow[] | null) || []))
  useEffect(() => {
    let alive = true
    loadList()
    const loadMine = () => { if (!myId) return; supabase.from('listing_reviews').select('rating, body').eq('listing_id', listingId).eq('member_id', myId).maybeSingle()
      .then(({ data }) => { if (!alive) return; const d = data as { rating: number; body: string | null } | null; setMyRating(d?.rating || 0); setMyBody(d?.body || null); setDraft(d?.body || '') }) }
    loadMine()
    window.addEventListener('legit:rating', loadMine)
    return () => { alive = false; window.removeEventListener('legit:rating', loadMine) }
  }, [listingId, myId])

  const post = async () => {
    if (!loggedIn || !myId) { openAuth('signup'); return }
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    const { error } = await supabase.from('listing_reviews').update({ body, updated_at: new Date().toISOString() }).eq('listing_id', listingId).eq('member_id', myId)
    if (!error) { setMyBody(body); setEditing(false); loadList(); fireReaction({ icon: 'star', tone: '#B5791C', title: myBody ? 'Review updated' : 'Review posted', sub: 'Thanks for the detail' }) }
    setBusy(false)
  }
  const removeReview = async () => {
    if (!myId || busy) return
    if (!confirm('Delete your review? Your star rating stays.')) return
    setBusy(true)
    const { error } = await supabase.from('listing_reviews').update({ body: null, updated_at: new Date().toISOString() }).eq('listing_id', listingId).eq('member_id', myId)
    if (!error) { setMyBody(null); setDraft(''); setEditing(false); loadList() }
    setBusy(false)
  }

  const others = (list || []).filter(r => r.member_id !== myId)
  return (
    <div className="l-rvwrap">
      {/* your write box */}
      {!loggedIn
        ? <div className="l-rvprompt"><span style={{ color: '#97600F', cursor: 'pointer' }} onClick={() => openAuth('signup')}>Sign in</span> to rate and review.</div>
        : myRating === 0
          ? <div className="l-rvprompt">Rate it above to add a written review.</div>
          : (myBody && !editing)
            ? <div className="l-rvmine">
                <div className="l-rvmineh"><StarRating value={myRating} count={1} size={15} tone="#B5791C" bare /> <span className="l-rvyou">Your review</span></div>
                <div className="l-rvbody">{myBody}</div>
                <div className="l-rvactions"><span className="l-login" style={{ color: '#97600F' }} onClick={() => { setDraft(myBody); setEditing(true) }}>edit</span><span className="l-login" style={{ color: '#C8102E' }} onClick={removeReview}>delete</span></div>
              </div>
            : <div className="l-rvwrite">
                <textarea className="l-rvta" value={draft} onChange={e => setDraft(e.target.value)} placeholder="What stood out — what works, what doesn't, who it's for?" maxLength={2000} />
                <div className="l-rvactions">
                  {(editing || myBody) && <span className="l-login" onClick={() => { setEditing(false); setDraft(myBody || '') }}>cancel</span>}
                  <span className="l-btn" style={{ opacity: draft.trim() && !busy ? 1 : 0.5, pointerEvents: draft.trim() && !busy ? 'auto' : 'none' }} onClick={post}>{myBody ? 'Update' : 'Post review'}</span>
                </div>
              </div>}

      {/* list */}
      {list === null
        ? null
        : others.length === 0 && !myBody
          ? <div className="l-empty" style={{ marginTop: 14 }}><b>No written reviews yet.</b> Be the first to write one.</div>
          : <div className="l-rvlist">
              {others.map(r => (
                <div key={r.id} className="l-rvitem">
                  <div className="l-rvav" style={r.avatar_url ? { backgroundImage: `url(${r.avatar_url})` } : undefined}>{!r.avatar_url && (r.display_name?.[0] || '?').toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="l-rvhead"><span className="l-rvname">{r.display_name || 'Member'}</span><StarRating value={r.rating} count={1} size={14} tone="#B5791C" bare /><span className="l-rvmeta">{reviewTimeAgo(r.created_at)}</span></div>
                    <div className="l-rvbody">{r.body}</div>
                  </div>
                </div>
              ))}
            </div>}
    </div>
  )
}

// ── Legit tickets — the heavy, scarce, specialty-tagged vouch ──
export const SPECIALTIES: { key: string; label: string }[] = [
  { key: 'reliable', label: 'Reliable' },
  { key: 'polished', label: 'Polished' },
  { key: 'value', label: 'Great value' },
  { key: 'time_saver', label: 'Time-saver' },
  { key: 'innovative', label: 'Innovative' },
  { key: 'supported', label: 'Well-supported' },
]
const SPECIALTY_LABEL: Record<string, string> = Object.fromEntries(SPECIALTIES.map(s => [s.key, s.label]))

// Ticket tier → star/badge tone + label. More vouches = hotter color.
export function ticketTier(n: number): { tone: string; label: string } {
  if (n >= 25) return { tone: '#7C3AED', label: 'Legendary' }         // violet
  if (n >= 10) return { tone: '#C8102E', label: 'Certified legit' }   // scarlet
  if (n >= 5) return { tone: '#C2752A', label: 'Crowd-vouched' }       // bronze
  if (n >= 1) return { tone: '#E0A92E', label: 'Vouched' }            // gold
  return { tone: '#C9BBA0', label: '' }                                // muted
}

// Verified-seal rosette — a certified-specialty mark, not a plain ticket.
export function LegitSeal({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ color, flexShrink: 0 }}>
      <path d="M8.4 13.1 6.2 21.6 12 18.3 17.8 21.6 15.6 13.1" />
      <circle cx="12" cy="8.8" r="6.4" />
      <path d="M12 5.1l1.36 2.76 3.04.44-2.2 2.14.52 3.03L12 12.0 9.28 13.51l.52-3.03-2.2-2.14 3.04-.44z" fill={color} stroke="none" />
    </svg>
  )
}

// Tier-colored "◈ N legit" count — shown wherever a listing surfaces.
// The bright tier tone stays on the seal icon (a graphic); the text uses a darker,
// contrast-safe variant so "N legit" passes WCAG AA on the cream surface.
const TICKET_TEXT: Array<[number, string]> = [[25, '#6D28C9'], [10, '#B00C26'], [5, '#8A531C'], [1, '#8A6410']]
export function TicketBadge({ count, size = 13 }: { count: number; size?: number }) {
  if (!count) return null
  const { tone } = ticketTier(count)
  const textTone = (TICKET_TEXT.find(([n]) => count >= n) || [0, '#6F6757'])[1] as string
  return (
    <span className="l-ticket" style={{ color: textTone }}>
      <LegitSeal size={size} color={tone} /> {count} legit
    </span>
  )
}

// Centered action-reaction toast — fired after rating or throwing a ticket.
type Reaction = { icon: 'star' | 'seal'; tone: string; title: string; sub?: string }
function fireReaction(r: Reaction) { window.dispatchEvent(new CustomEvent('legit:reaction', { detail: r })) }

function ReactionToast() {
  const [r, setR] = useState<Reaction | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const h = (e: Event) => {
      setR((e as CustomEvent<Reaction>).detail)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setR(null), 1700)
    }
    window.addEventListener('legit:reaction', h)
    return () => { window.removeEventListener('legit:reaction', h); window.clearTimeout(timer.current) }
  }, [])
  if (!r) return null
  return (
    <div className="l-react">
      <div className="l-reactcard" onClick={() => setR(null)}>
        {r.icon === 'seal'
          ? <LegitSeal size={46} color={r.tone} />
          : <svg width="46" height="46" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.6.9-4.8 4.6 1.2 6.6L12 18.7 6 21.4l1.2-6.6L2.4 9.6l6.6-.9z" fill={r.tone} stroke={r.tone} strokeOpacity="0.5" strokeWidth="0.7" /></svg>}
        <div className="l-reacttitle">{r.title}</div>
        {r.sub && <div className="l-reactsub">{r.sub}</div>}
      </div>
    </div>
  )
}

// v2-styled auth — a legit-specific amber modal (the shared app AuthModal is
// navy and used elsewhere). OAuth + email, sign-in/sign-up auto-toggle.
function LegitAuthModal({ open, onClose, initialMode = 'signin' }: { open: boolean; onClose: () => void; initialMode?: AuthMode }) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithOAuth } = useAuth() as {
    signInWithEmail: (e: string, p: string) => Promise<{ error: { message: string } | null }>
    signUpWithEmail: (e: string, p: string) => Promise<{ error: { message: string } | null; confirmationPending?: boolean }>
    signInWithGoogle: () => Promise<{ error: { message: string } | null }>
    signInWithOAuth: (p: 'google' | 'github' | 'twitter' | 'linkedin_oidc') => Promise<{ error: { message: string } | null }>
  }
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  useEffect(() => { if (open) { setMode(initialMode); setErr(''); setSent(false); setShowEmail(false) } }, [open, initialMode])
  if (!open) return null

  const submit = async () => {
    if (busy) return
    if (!email.trim() || !pw) { setErr('Enter your email and password.'); return }
    setBusy(true); setErr('')
    const r = mode === 'signin' ? await signInWithEmail(email.trim(), pw) : await signUpWithEmail(email.trim(), pw)
    if (r.error) setErr(r.error.message)
    else if (mode === 'signup' && (r as { confirmationPending?: boolean }).confirmationPending) setSent(true)
    else onClose()
    setBusy(false)
  }

  return (
    <div className="l-modal" onClick={onClose}>
      <div className="l-authcard" onClick={e => e.stopPropagation()}>
        <button className="l-modalclose" onClick={onClose} aria-label="Close">×</button>
        <div className="l-authlogo">Legit.<span className="l-logoshow">Show</span></div>
        <div className="l-authh">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</div>
        {sent
          ? <div className="l-authsent">Check your inbox — we sent a confirmation link to <b>{email}</b>.</div>
          : <>
              <img className="l-authowl" src="/owl_up.png" alt="" />
              <button className="l-oauth" onClick={() => signInWithGoogle()}>
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/></svg>
                Continue with Google
              </button>
              <button className="l-oauth" onClick={() => signInWithOAuth('github')}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="#211C15" aria-hidden="true"><path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.76c-2.92.63-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.55-1.17-1.55-.95-.65.07-.64.07-.64 1.06.07 1.61 1.09 1.61 1.09.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.67-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.11-.27-.47-1.34.1-2.8 0 0 .88-.28 2.88 1.07a10 10 0 0 1 5.24 0c2-1.35 2.88-1.07 2.88-1.07.57 1.46.21 2.53.1 2.8.67.74 1.08 1.67 1.08 2.82 0 4.02-2.46 4.9-4.8 5.16.38.33.71.97.71 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5z"/></svg>
                Continue with GitHub
              </button>
              <button className="l-oauth" onClick={() => signInWithOAuth('twitter')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#211C15" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>
                Continue with X
              </button>
              <button className="l-oauth" onClick={() => signInWithOAuth('linkedin_oidc')}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>
                Continue with LinkedIn
              </button>
              {!showEmail
                ? <div className="l-authemail" onClick={() => setShowEmail(true)}>or continue with email</div>
                : <>
                    <div className="l-author"><span>email</span></div>
                    <input className="l-authin" type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus />
                    <input className="l-authin" type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
                    {err && <div className="l-autherr">{err}</div>}
                    <button className="l-btn l-authsubmit" style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }} onClick={submit}>{mode === 'signin' ? 'Sign in' : 'Create account'}</button>
                    <div className="l-authtoggle">
                      {mode === 'signin'
                        ? <>New here? <span onClick={() => { setMode('signup'); setErr('') }}>Create an account</span></>
                        : <>Already have an account? <span onClick={() => { setMode('signin'); setErr('') }}>Sign in</span></>}
                    </div>
                  </>}
            </>}
      </div>
    </div>
  )
}

const TICKET_QUOTA = 12

// Detail-page panel: throw / re-tag / take back a legit ticket, see the count,
// the tier, the crowd-vouched specialties, and your monthly quota.
// Legit-ticket vouch: a tier-colored seal badge (sits at the right of the star
// row). Clicking it opens a popup that explains the ticket, shows the count /
// vouched-for specialties, and lets you throw / re-tag / take back.
export function LegitVouch({ listingId }: { listingId: string }) {
  const { openAuth, loggedIn } = useLegitAuth()
  const { user } = useAuth() as { user: { id?: string } | null }
  const myId = user?.id || null
  const [count, setCount] = useState(0)
  const [specs, setSpecs] = useState<Record<string, number>>({})
  const [mine, setMine] = useState<string | null>(null)
  const [used, setUsed] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let alive = true
    supabase.from('listing_ticket_stats').select('ticket_count, specialties').eq('listing_id', listingId).maybeSingle()
      .then(({ data }) => { if (!alive) return; const d = data as { ticket_count: number; specialties: Record<string, number> } | null; setCount(d?.ticket_count || 0); setSpecs(d?.specialties || {}) })
    if (myId) supabase.from('listing_tickets').select('specialty').eq('listing_id', listingId).eq('member_id', myId).maybeSingle()
      .then(({ data }) => { if (alive) setMine((data as { specialty: string } | null)?.specialty ?? null) })
    return () => { alive = false }
  }, [listingId, myId])

  // monthly used count — refreshed when the popup opens
  useEffect(() => {
    if (!open || !myId) return
    const d = new Date(); const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
    supabase.from('listing_tickets').select('listing_id', { count: 'exact', head: true }).eq('member_id', myId).gte('created_at', monthStart)
      .then(({ count: c }) => setUsed(c || 0))
  }, [open, myId])

  const tier = ticketTier(count)
  const top = Object.entries(specs).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => SPECIALTY_LABEL[k] || k)

  const throwTicket = async (specialty: string) => {
    if (!loggedIn || !myId) { openAuth('signup'); return }
    if (busy) return
    setBusy(true); setMsg('')
    const had = mine !== null
    const q = had
      ? supabase.from('listing_tickets').update({ specialty }).eq('listing_id', listingId).eq('member_id', myId)
      : supabase.from('listing_tickets').insert({ listing_id: listingId, member_id: myId, specialty })
    const { error } = await q
    if (error) setMsg(/quota/i.test(error.message) ? `You've used all ${TICKET_QUOTA} legit tickets this month.` : 'Could not throw the ticket — try again.')
    else {
      setSpecs(prev => { const n = { ...prev }; if (had && mine) n[mine] = Math.max(0, (n[mine] || 1) - 1); n[specialty] = (n[specialty] || 0) + 1; return n })
      if (!had) { setCount(c => c + 1); setUsed(u => u + 1) }
      setMine(specialty); window.dispatchEvent(new Event('legit:tickets'))
      fireReaction({ icon: 'seal', tone: ticketTier(had ? count : count + 1).tone, title: had ? 'Vouch updated' : 'Legit ticket thrown', sub: `Vouched for ${SPECIALTY_LABEL[specialty]}` })
      setOpen(false)
    }
    setBusy(false)
  }
  const takeBack = async () => {
    if (!myId || busy) return
    setBusy(true); setMsg('')
    const { error } = await supabase.from('listing_tickets').delete().eq('listing_id', listingId).eq('member_id', myId)
    if (!error) {
      setSpecs(prev => { const n = { ...prev }; if (mine) n[mine] = Math.max(0, (n[mine] || 1) - 1); return n })
      setCount(c => Math.max(0, c - 1)); setUsed(u => Math.max(0, u - 1)); setMine(null); window.dispatchEvent(new Event('legit:tickets'))
      fireReaction({ icon: 'seal', tone: '#C9BBA0', title: 'Ticket taken back' })
      setOpen(false)
    }
    setBusy(false)
  }

  return (
    <>
      <button className={`l-vouchbtn ${mine ? 'on' : ''}`} style={{ color: tier.tone, borderColor: mine ? tier.tone : undefined }} onClick={() => setOpen(true)}>
        <LegitSeal size={15} color={tier.tone} />{count > 0 ? `${count} legit` : 'Vouch legit'}
      </button>
      {open && (
        <div className="l-modal" onClick={() => setOpen(false)}>
          <div className="l-modalcard" onClick={e => e.stopPropagation()}>
            <button className="l-modalclose" onClick={() => setOpen(false)} aria-label="Close">×</button>
            <div className="l-tkhead">
              <LegitSeal size={22} color={tier.tone} />
              <span className="l-tkh">Legit tickets</span>
              {count > 0 && <span className="l-tktier" style={{ color: tier.tone }}>{count} · {tier.label}</span>}
            </div>
            <p className="l-modaltext">Your heavy vouch — one per product. Tag the one thing it nails. Light reactions are unlimited; tickets are the scarce signal that drives ranking and the tier color.</p>
            {top.length > 0 && <div className="l-tkvouch">Vouched legit for <b>{top.join(' · ')}</b></div>}
            {!loggedIn
              ? <span className="l-tkthrow" onClick={() => openAuth('signup')}><LegitSeal size={15} /> Sign in to throw a legit ticket</span>
              : <>
                  <div className="l-tksub" style={{ marginBottom: 8 }}>What does this product nail?</div>
                  <div className="l-tkchips">
                    {SPECIALTIES.map(s => (
                      <span key={s.key} className={`l-tkchip ${mine === s.key ? 'on' : ''}`} onClick={() => mine === s.key ? takeBack() : throwTicket(s.key)}>
                        {mine === s.key && <LegitSeal size={13} color={tier.tone} />}{s.label}
                      </span>
                    ))}
                  </div>
                  {mine && <div className="l-modalhint">Tap your pick again to take the ticket back.</div>}
                  <div className="l-tkquota" style={{ color: '#B5791C' }}>{Math.max(0, TICKET_QUOTA - used)} of {TICKET_QUOTA} legit tickets left this month</div>
                  {msg && <div className="l-tkquota" style={{ color: '#C8102E' }}>{msg}</div>}
                </>}
          </div>
        </div>
      )}
    </>
  )
}

// Some sources expose a square app/extension/avatar icon as their og:image
// (Chrome Web Store, App Store, VS Code marketplace, GitHub avatars). That's a
// great *icon* but a broken *banner* — detect it so we never stretch it wide.
export function isIconImage(url: string | null | undefined): boolean {
  if (!url) return false
  return (
    /lh3\.googleusercontent\.com/.test(url) ||      // Chrome Web Store / Play / Google user content
    /=s\d{2,4}(-|$)/.test(url) ||                     // Google square size param, e.g. =s128-rj
    (/mzstatic\.com/.test(url) && /AppIcon/i.test(url)) || // Apple App Store icon (screenshots are previews)
    /gallerycdn\.vsassets\.io/.test(url) ||           // VS Code marketplace
    /avatars\.githubusercontent\.com/.test(url)       // GitHub org/user avatar (square)
  )
}

// 7-frame production-readiness benchmark — "what separates a demo from production",
// measured from the outside (URL · headers · Lighthouse) so closed-source SaaS is
// fully assessable. Each frame is null when the form factor can't measure it
// honestly; null renders as "n/a", never a zero that would understate the score.
export const FRAMES: { key: FrameKey; label: string; tone: string; blurb: string }[] = [
  { key: 'performance',     label: 'Performance',     tone: '#C99A2E', blurb: 'How fast it loads (Lighthouse)' },
  { key: 'accessibility',   label: 'Accessibility',   tone: '#B5882B', blurb: 'Usable by everyone (Lighthouse)' },
  { key: 'security',        label: 'Security',        tone: '#A8743A', blurb: 'Transport · security headers · no leaked secrets' },
  { key: 'privacy',         label: 'Privacy',         tone: '#9A6B45', blurb: 'Privacy policy · terms · cookie consent' },
  { key: 'reliability',     label: 'Reliability',     tone: '#C2683E', blurb: 'Routes reachable · valid SSL · real 404' },
  { key: 'standards',       label: 'Standards',       tone: '#8C7A36', blurb: 'Best-practices · responsive · manifest' },
  { key: 'discoverability', label: 'Discoverability', tone: '#7E8A4E', blurb: 'Meta · OpenGraph · structured data · sitemap' },
  { key: 'maintenance',     label: 'Maintenance',     tone: '#6E8557', blurb: 'Actively maintained (repo signals)' },
]
// Old-schema rows (pre-7-frame) still carry the 4 axes — render those until the
// re-benchmark sweep overwrites every row with frame data.
const LEGACY_AXES: { key: keyof Benchmark; label: string; tone: string }[] = [
  { key: 'quality', label: 'Quality', tone: '#C99A2E' }, { key: 'trust', label: 'Trust', tone: '#A8743A' },
  { key: 'activity', label: 'Activity', tone: '#C2683E' }, { key: 'transparency', label: 'Transparency', tone: '#7E8A4E' },
]
const BM_FORM: Record<string, string> = { web: 'live site', app_store: 'App Store signals', github: 'GitHub signals', npm: 'npm signals' }

export function BenchmarkChart({ b, showOverall = false, interactive = false }: { b: Benchmark; showOverall?: boolean; interactive?: boolean }) {
  const [open, setOpen] = useState(false)
  const assessed = FRAMES.filter(f => b[f.key] != null)
  const hasFrames = assessed.length > 0
  const rows = hasFrames
    ? assessed.map(f => ({ label: f.label, tone: f.tone, v: b[f.key] as number }))
    : LEGACY_AXES.map(a => ({ label: a.label, tone: a.tone, v: (b[a.key] as number) || 0 }))
  return (
    <div className="l-bm">
      {showOverall && <div className="l-bmtop" title="overall · mean of assessed frames (admin only)"><span className="l-bmscore">{b.overall}</span><span className="l-bmscoremax">/100</span></div>}
      <div className="l-bmsrc" style={{ textAlign: showOverall ? 'center' : 'left', margin: '4px 0 13px' }}>
        evaluated on {BM_FORM[b.form] || b.form}{hasFrames ? ` · ${assessed.length} of 8 frames` : ''}
      </div>
      <div className="l-bmbars">
        {rows.map(r => (
          <div key={r.label} className="l-bmrow">
            <span className="l-bmlabel">{r.label}</span>
            <span className="l-bmtrack"><span className="l-bmfill" style={{ width: `${r.v}%`, background: r.tone }} /></span>
            <span className="l-bmval">{r.v}</span>
          </div>
        ))}
      </div>
      {interactive && hasFrames && <button className="l-bmmore" onClick={() => setOpen(true)}>See the evidence →</button>}
      {open && <BenchmarkDetailModal b={b} onClose={() => setOpen(false)} />}
    </div>
  )
}

// ── benchmark detail modal — the evidence behind every frame ──
// Reads benchmark.signals.frames.<frame> and renders each underlying check as
// pass / fail / value. n/a frames show why they weren't assessed (e.g. a code host
// has no rendered page) so the score is never silently inflated.
const SIG_LABEL: Record<string, string> = {
  lighthouse: 'Lighthouse ran', perf: 'Performance score', a11y: 'Accessibility score', bestPractices: 'Best-practices score', responseMs: 'Response time',
  https: 'HTTPS', hsts: 'HSTS', csp: 'Content-Security-Policy', xFrame: 'X-Frame-Options', xContent: 'X-Content-Type-Options', referrer: 'Referrer-Policy',
  mixedContent: 'No mixed content', secretsFound: 'No leaked secrets',
  privacyPage: 'Privacy policy page', termsPage: 'Terms page', consentBanner: 'Cookie consent',
  homeStatus: 'Homepage responds', routesChecked: 'Internal routes checked', routesOk: 'Routes reachable', proper404: 'Real 404 page',
  responsive: 'Responsive (viewport)', favicon: 'Favicon', manifest: 'Web manifest',
  title: 'Title tag', metaDescription: 'Meta description', ogTitle: 'OpenGraph title', ogImage: 'OpenGraph image', canonical: 'Canonical URL', structuredData: 'Structured data (JSON-LD)', sitemap: 'Sitemap',
  license: 'License', topics: 'Topics', archived: 'Archived', homepage: 'Homepage link', hasDescription: 'Description', description: 'Description', readme: 'README', repository: 'Repository link', hasRepository: 'Repository link', types: 'TypeScript types', versions: 'Published versions',
  pushed_at: 'Last push', daysSincePush: 'Days since push', modified: 'Last publish', daysSinceModified: 'Days since publish', releaseDate: 'Last release', daysSinceRelease: 'Days since release',
  screenshots: 'Screenshots', appPrivacyLabel: 'App privacy label', ageRating: 'Age rating',
}
const INVERTED = new Set(['mixedContent']) // boolean where true = bad
type EvRow = { label: string; state: 'pass' | 'fail' | 'info'; value?: string }
function frameEvidence(sig: Record<string, unknown> | undefined): EvRow[] {
  if (!sig) return []
  const out: EvRow[] = []
  for (const [k, val] of Object.entries(sig)) {
    if (k === 'assessed' || k === 'reason' || val == null) continue
    const label = SIG_LABEL[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
    if (k === 'secretsFound') {
      const arr = val as string[]
      out.push(arr.length ? { label: `Leaked secrets: ${arr.join(', ')}`, state: 'fail' } : { label: 'No leaked secrets', state: 'pass' })
    } else if (k === 'archived') {
      out.push({ label: 'Not archived', state: (val as boolean) ? 'fail' : 'pass' })
    } else if (typeof val === 'boolean') {
      const good = INVERTED.has(k) ? !val : val
      out.push({ label, state: good ? 'pass' : 'fail' })
    } else if (typeof val === 'number') {
      const v = k === 'responseMs' ? `${val} ms` : /^daysSince/.test(k) ? `${val}d ago` : String(val)
      out.push({ label, state: 'info', value: v })
    } else if (typeof val === 'string') {
      out.push({ label, state: 'info', value: val.length > 40 ? val.slice(0, 40) + '…' : val })
    }
  }
  return out
}
const BD_CSS = `
.l-bdov{position:fixed;inset:0;background:rgba(33,28,21,.55);backdrop-filter:blur(3px);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px 16px;overflow:auto}
.l-bdpanel{background:#FCFAF5;border:1px solid #E7D4AC;border-radius:16px;max-width:560px;width:100%;padding:24px 24px 28px;box-shadow:0 24px 60px rgba(33,28,21,.22)}
.l-bdhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:4px}
.l-bdtitle{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:21px;color:#211C15}
.l-bdsub{font-size:12.5px;color:#6E6557;line-height:1.55;margin-bottom:18px}
.l-bdx{font-size:22px;line-height:1;color:#6F6757;cursor:pointer;background:none;border:none;padding:0}
.l-bdframe{border-top:1px solid #EFE4CC;padding:13px 0}
.l-bdframe:first-of-type{border-top:none}
.l-bdfh{display:flex;align-items:baseline;gap:8px;margin-bottom:3px}
.l-bdfname{font-weight:600;font-size:14.5px;color:#2E2820}
.l-bdfscore{font-family:'JetBrains Mono',monospace;font-size:13px;color:#97600F;margin-left:auto}
.l-bdfna{font-family:'JetBrains Mono',monospace;font-size:11px;color:#A99F8C;margin-left:auto;text-transform:uppercase;letter-spacing:.04em}
.l-bdblurb{font-size:11.5px;color:#8A8170;margin-bottom:8px}
.l-bdtrack{height:5px;background:#EFE6D2;border-radius:3px;overflow:hidden;margin-bottom:9px}
.l-bdfill{display:block;height:100%;border-radius:3px}
.l-bdev{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#5A5347;padding:1.5px 0}
.l-bddot{width:14px;text-align:center;flex:0 0 auto;font-weight:700}
.l-bddot.pass{color:#5C8A3E}.l-bddot.fail{color:#C24A33}.l-bddot.info{color:#A8893E}
.l-bdev .v{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#7A7160}
.l-bdnote{font-size:11px;color:#6F6757;margin-top:16px;font-family:'JetBrains Mono',monospace}
`
export function BenchmarkDetailModal({ b, onClose }: { b: Benchmark; onClose: () => void }) {
  const framesSig = (b.signals?.frames || {}) as Record<string, Record<string, unknown>>
  return (
    <div className="l-bdov" onClick={onClose}>
      <style dangerouslySetInnerHTML={{ __html: BD_CSS }} />
      <div className="l-bdpanel" onClick={e => e.stopPropagation()}>
        <div className="l-bdhead">
          <div className="l-bdtitle">Benchmark evidence</div>
          <button className="l-bdx" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="l-bdsub">Seven frames of production-readiness, measured from the outside — {BM_FORM[b.form] || b.form}. Each frame shows the exact checks behind its score. Frames a {b.form === 'web' ? 'live site' : 'this form'} can&apos;t prove are marked not assessed, never scored as zero.</p>
        {FRAMES.map(f => {
          const v = b[f.key]
          const sig = framesSig[f.key]
          const ev = frameEvidence(sig)
          return (
            <div key={f.key} className="l-bdframe">
              <div className="l-bdfh">
                <span className="l-bdfname">{f.label}</span>
                {v != null ? <span className="l-bdfscore">{v as number}/100</span> : <span className="l-bdfna">not assessed</span>}
              </div>
              <div className="l-bdblurb">{f.blurb}</div>
              {v != null && <div className="l-bdtrack"><span className="l-bdfill" style={{ width: `${v as number}%`, background: f.tone }} /></div>}
              {v != null
                ? ev.map((r, i) => (
                    <div key={i} className="l-bdev">
                      <span className={`l-bddot ${r.state}`}>{r.state === 'pass' ? '✓' : r.state === 'fail' ? '✕' : '•'}</span>
                      <span>{r.label}</span>
                      {r.value && <span className="v">{r.value}</span>}
                    </div>
                  ))
                : <div className="l-bdev"><span className="l-bddot info">•</span><span>{(sig?.reason as string) || 'not measurable for this form'}</span></div>}
            </div>
          )
        })}
        <div className="l-bdnote">Measured by Legit.Show · deterministic · re-checked weekly</div>
      </div>
    </div>
  )
}

// ── repo teardown cards — the deep code checks (OSS repos) ──
// Measurement facts, not a verdict (per methodology): each check is a fact +
// why-it-matters + file evidence. This is the "extractable depth" reports cite.
const RA_CHECKS: { key: string; label: string; why: string }[] = [
  { key: 'client_secret',       label: 'Client-side secrets',  why: 'Secret keys in the browser bundle can be stolen and abused' },
  { key: 'env_committed',       label: 'Committed .env',       why: 'Credentials checked into the repo leak to anyone who clones it' },
  { key: 'rls_coverage',        label: 'Row-level security',   why: 'Tables without access rules can expose other users’ data' },
  { key: 'rate_limiting',       label: 'API rate limiting',    why: 'No limit lets one user overload the server or run up the bill' },
  { key: 'webhook_idempotency', label: 'Webhook idempotency',  why: 'Duplicate webhooks without dedupe cause double charges/processing' },
  { key: 'prompt_injection',    label: 'Prompt injection',     why: 'Raw user input reaching the model can hijack it or leak data' },
  { key: 'error_tracking',      label: 'Error tracking',       why: 'No monitoring means failures happen silently, unnoticed' },
  { key: 'missing_indexes',     label: 'Database indexes',     why: 'Unindexed foreign keys get slow as the data grows' },
  { key: 'cors',                label: 'CORS policy',          why: 'A wide-open CORS origin lets any site call the API' },
]
const RA_DOT: Record<RepoAuditStatus, { c: string; m: string }> = {
  pass: { c: '#5C8A3E', m: '✓' }, warn: { c: '#A8742E', m: '!' }, fail: { c: '#C24A33', m: '✕' }, na: { c: '#B3A992', m: '–' },
}
const RA_CSS = `
.l-ra{margin-top:18px}
.l-rah{display:flex;align-items:baseline;gap:8px;margin-bottom:3px}
.l-rasum{margin-left:auto;display:flex;gap:7px;font-family:'JetBrains Mono',monospace;font-size:11px}
.l-rasum b{font-weight:600}
.l-ranote{font-size:11px;color:#6F6757;margin-bottom:12px;line-height:1.5}
.l-racard{display:flex;gap:9px;padding:9px 0;border-top:1px solid #EFE4CC}
.l-racard:first-of-type{border-top:none}
.l-radot{width:16px;height:16px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;margin-top:1px}
.l-ralabel{font-weight:600;font-size:13.5px;color:#2E2820}
.l-rafind{font-size:12.5px;color:#5A5347;margin-top:1px;line-height:1.45}
.l-rawhy{font-size:11.5px;color:#8A8170;margin-top:2px;line-height:1.45}
.l-raev{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#97600F;margin-top:3px;word-break:break-all}
.l-rana{opacity:.55}
`
export function RepoAuditCards({ audit }: { audit: RepoAudit }) {
  const checks = audit.checks || {}
  const present = RA_CHECKS.filter(c => checks[c.key])
  if (!present.length) return null
  const s = audit.summary || { pass: 0, warn: 0, fail: 0, na: 0 }
  return (
    <div className="l-ra">
      <style dangerouslySetInnerHTML={{ __html: RA_CSS }} />
      <div className="l-rah">
        <div className="l-lh">◆ repo teardown</div>
        <div className="l-rasum">
          <span style={{ color: RA_DOT.pass.c }}><b>{s.pass}</b> pass</span>
          <span style={{ color: RA_DOT.warn.c }}><b>{s.warn}</b> warn</span>
          <span style={{ color: RA_DOT.fail.c }}><b>{s.fail}</b> fail</span>
        </div>
      </div>
      <div className="l-ranote">Deep code checks on the source{audit.repo ? ` · ${audit.repo}` : ''}. Measurement facts, not a verdict.</div>
      {present.map(c => {
        const ck = checks[c.key]; const dot = RA_DOT[ck.status]
        return (
          <div key={c.key} className={`l-racard ${ck.status === 'na' ? 'l-rana' : ''}`}>
            <span className="l-radot" style={{ background: dot.c }}>{dot.m}</span>
            <div>
              <div className="l-ralabel">{c.label}</div>
              <div className="l-rafind">{ck.finding}</div>
              {ck.status !== 'na' && <div className="l-rawhy">{c.why}</div>}
              {ck.evidence && <div className="l-raev">{ck.evidence}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Resolve a listing's two visuals: a square `icon` (for the small thumbnail)
// and a wide `preview` (for cards/detail banners). icon_url is the explicit
// app icon column; legacy rows may carry an icon-type image_url instead.
export function visuals(p: Listing): { icon: string | null; preview: string | null } {
  const icon = p.icon_url || (isIconImage(p.image_url) ? p.image_url : null)
  const preview = p.image_url && !isIconImage(p.image_url) ? p.image_url : null
  return { icon, preview }
}

// Small square tile: prefers the service's real app icon when we have one,
// then the domain favicon, then the initial letter. A wide OG image would
// crop and look broken at thumbnail size, so we never use it here.
const OUR_MARK = '/favicon-192.png'   // the gold lens-ring — placeholder for icon-less services
export function FaviconTile({ name, domain, icon = null, cls = 'l-ic' }: { name: string; domain: string; icon?: string | null; cls?: string }) {
  const host = (domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const fav = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=128` : null
  // chain: real app icon → site favicon → our mark. Always ends on our mark.
  const chain = [icon, fav, OUR_MARK].filter(Boolean) as string[]
  const [stage, setStage] = useState(0)
  const src = chain[stage]
  if (!src) return <div className={cls}>{(name[0] || '?').toUpperCase()}</div>
  const isMark = src === OUR_MARK
  return (
    <div className={`${cls} l-fav ${isMark ? 'l-fav-mark' : ''}`}>
      <img src={src} alt="" loading="lazy" decoding="async"
        onError={() => setStage(s => s + 1)}
        onLoad={src === fav ? (e => { if ((e.currentTarget.naturalWidth || 0) <= 24) setStage(s => s + 1) }) : undefined} />
    </div>
  )
}

export function ListingRow({ p, tickets = 0 }: { p: Listing; tickets?: number }) {
  const oneliner = (p.tagline || p.description || '').slice(0, 180)
  return (
    <Link to={`/s/${p.slug}`} className="l-row">
      <FaviconTile name={p.name} domain={p.domain} icon={visuals(p).icon} />
      <div style={{ flex: 1 }}>
        <div className="l-nm">{p.name} <span className="l-dm">{p.domain}</span></div>
        <div className="l-ol">{oneliner}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {tickets > 0 && <TicketBadge count={tickets} />}
          {p.category && <span className="l-tag">{p.category}</span>}
          <span className="l-tag">{p.platform || 'web'}</span>
          {p.has_pricing && <span className="l-tag">pricing</span>}
          {p.js_starved && <span className="l-tag warn">deep-probe</span>}
        </div>
      </div>
    </Link>
  )
}

// Card visual with a runtime fallback chain: wide OG preview (cover) → app
// icon / domain favicon (contained) → initial. Using <img> (not a CSS
// background) means a broken or unrenderable source (dead OG endpoint, an SVG
// that won't paint) falls through instead of leaving a blank tile.
function CardVisual({ p }: { p: Listing }) {
  const { icon, preview } = visuals(p)
  const host = (p.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const fav = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=128` : null
  const stages: { src: string; cover: boolean }[] = []
  if (preview) stages.push({ src: preview, cover: true })
  if (icon) stages.push({ src: icon, cover: false })
  if (fav) stages.push({ src: fav, cover: false })
  const [i, setI] = useState(0)
  const cur = stages[i]
  if (!cur) return <div className="l-cimg">{(p.name[0] || '?').toUpperCase()}</div>
  return (
    <div className={`l-cimg ${cur.cover ? '' : 'l-cimg-icon'}`}>
      <img className={cur.cover ? 'l-cimgcover' : 'l-cardicon'} src={cur.src} alt="" loading="lazy"
        onError={() => setI(n => n + 1)} />
    </div>
  )
}

export function PremiumCard({ p, tickets = 0 }: { p: Listing; tickets?: number }) {
  return (
    <Link to={`/s/${p.slug}`} className="l-card">
      <CardVisual p={p} />
      <div className="l-cbody">
        <div className="l-cn">{p.name}</div>
        <div className="l-cdm">{p.category || p.platform || p.domain}</div>
        <div className="l-ct">{p.tagline || p.description}</div>
        {tickets > 0 && <div style={{ marginTop: 3 }}><TicketBadge count={tickets} size={12} /></div>}
      </div>
    </Link>
  )
}

// ── tag reactions — low-friction feedback beside star/text reviews ──
// signed-in members tap preset tags; each (member,listing,tag) is a toggle.
// "I use this" is the prominent usage signal; the rest are quality tags.
const RX_TAGS: { key: string; label: string; warn?: boolean }[] = [
  { key: 'works_great', label: 'Works great' },
  { key: 'easy', label: 'Easy to use' },
  { key: 'fast', label: 'Fast & polished' },
  { key: 'great_support', label: 'Great support' },
  { key: 'buggy', label: 'Buggy', warn: true },
  { key: 'overpriced', label: 'Overpriced', warn: true },
  { key: 'missing_features', label: 'Missing features', warn: true },
]

export function ReactionBar({ listingId }: { listingId: string }) {
  const { openAuth, loggedIn } = useLegitAuth()
  const { user } = useAuth() as { user: { id?: string } | null }
  const myId = user?.id || null
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    supabase
      .from('listing_reactions')
      .select('reaction, member_id')
      .eq('listing_id', listingId)
      .then(({ data }) => {
        if (!alive) return
        const c: Record<string, number> = {}
        const m = new Set<string>()
        for (const r of (data as { reaction: string; member_id: string }[] | null) || []) {
          c[r.reaction] = (c[r.reaction] || 0) + 1
          if (myId && r.member_id === myId) m.add(r.reaction)
        }
        setCounts(c); setMine(m)
      })
    return () => { alive = false }
  }, [listingId, myId])

  const toggle = async (key: string) => {
    if (!loggedIn || !myId) { openAuth('signup'); return }
    if (busy) return
    setBusy(key)
    const had = mine.has(key)
    // optimistic
    setMine(prev => { const n = new Set(prev); had ? n.delete(key) : n.add(key); return n })
    setCounts(prev => ({ ...prev, [key]: Math.max(0, (prev[key] || 0) + (had ? -1 : 1)) }))
    const q = had
      ? supabase.from('listing_reactions').delete().eq('listing_id', listingId).eq('member_id', myId).eq('reaction', key)
      : supabase.from('listing_reactions').insert({ listing_id: listingId, member_id: myId, reaction: key })
    const { error } = await q
    if (error) { // rollback
      setMine(prev => { const n = new Set(prev); had ? n.add(key) : n.delete(key); return n })
      setCounts(prev => ({ ...prev, [key]: Math.max(0, (prev[key] || 0) + (had ? 1 : -1)) }))
    }
    setBusy(null)
  }

  const uses = counts['uses_it'] || 0
  return (
    <div className="l-rx">
      <div className="l-rxh">Community reactions</div>
      <div className="l-rxsub">
        {loggedIn ? 'Tap to share how this holds up for you.' : 'Sign in to react — no review required.'}
      </div>
      <div className={`l-rxuse ${mine.has('uses_it') ? 'on' : ''}`} onClick={() => toggle('uses_it')}>
        {mine.has('uses_it') ? 'You use this' : 'I use this'}
        {uses > 0 && <span className="c">· {uses}</span>}
      </div>
      <div className="l-rxtags">
        {RX_TAGS.map(t => {
          const c = counts[t.key] || 0
          return (
            <span
              key={t.key}
              className={`l-rxt ${t.warn ? 'warn' : ''} ${mine.has(t.key) ? 'on' : ''}`}
              onClick={() => toggle(t.key)}
            >
              {t.label}{c > 0 && <span className="c">{c}</span>}
            </span>
          )
        })}
      </div>
    </div>
  )
}
