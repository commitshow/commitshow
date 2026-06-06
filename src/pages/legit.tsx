// legit — directory (Atlas) UI. Self-contained amber editorial design,
// scoped under `.lgt` / `l-` classes so it never touches the navy app.
// Reads the `listings` table (populated by the ingest engine).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { AuthModal } from '../components/AuthModal'
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
}

const CSS = `
.lgt{min-height:100vh;background:#FAF8F3;color:#2C261D;font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
.lgt a{color:inherit;text-decoration:none}
.lgt h1,.lgt h2,.lgt h3{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.01em;color:#211C15;margin:0}
.lgt img{max-width:100%}
.l-wrap{max-width:1080px;margin:0 auto;padding:0 24px}
.l-h{position:sticky;top:0;background:rgba(250,248,243,.92);backdrop-filter:blur(8px);border-bottom:1px solid #E9E2D4;z-index:20}
.l-hd{display:flex;align-items:center;gap:18px;height:60px}
.l-logo{font-family:Fraunces;font-weight:700;font-size:23px;color:#211C15;display:flex;align-items:center;gap:8px}
.l-dot{width:9px;height:9px;border-radius:50%;background:#B5791C;display:inline-block}
.l-search{flex:1;max-width:380px;background:#fff;border:1px solid #E9E2D4;border-radius:8px;padding:8px 12px;color:#9A9080;font-size:14px;cursor:text;display:flex;align-items:center;gap:8px}
.l-auth{margin-left:auto;display:flex;align-items:center;gap:14px}.l-login{font-size:14px;font-weight:500;color:#6E6557;cursor:pointer}
.l-btn{background:#B5791C;color:#fff;font-weight:600;font-size:14px;border:none;border-radius:8px;padding:9px 16px;cursor:pointer;display:inline-block}.l-btn:hover{background:#97600F}
.l-btn.ghost{background:transparent;color:#97600F;border:1px solid #E7D4AC}
.lgt a.l-btn{color:#fff}.lgt a.l-btn.ghost{color:#97600F}
.l-rate{display:flex;align-items:center;gap:9px;margin:9px 0 13px}
.l-stars{display:inline-flex;gap:2px;align-items:center}
.l-raten{font-size:13px;color:#9A9080;font-family:'JetBrains Mono',monospace}
.l-lockic{display:block;margin:14px auto 0}
.l-avatar{width:34px;height:34px;border-radius:50%;background:#B5791C;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;cursor:pointer;font-size:15px}
/* landing hero */
.l-herobig{padding:60px 0 38px;text-align:center;border-bottom:1px solid #E9E2D4;background:linear-gradient(180deg,#FBF8F1 0%,#FAF8F3 100%)}
.l-herobig h1{font-size:clamp(34px,5vw,52px);line-height:1.05;max-width:800px;margin:0 auto}
.l-herobig .sub{font-size:18px;color:#6E6557;max-width:640px;margin:18px auto 28px;line-height:1.5}
.l-bigsearch{max-width:560px;margin:0 auto;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #E0D8C8;border-radius:12px;padding:14px 18px;box-shadow:0 2px 16px rgba(150,110,30,.07)}
.l-bigsearch input{border:none;outline:none;flex:1;font-size:16px;background:transparent;color:#2C261D;font-family:Inter,sans-serif}
.lgt input:focus,.lgt input:focus-visible{outline:none!important;box-shadow:none!important}
.l-statrow{display:flex;gap:22px;justify-content:center;margin-top:22px;font-size:12.5px;color:#9A9080;font-family:'JetBrains Mono',monospace;flex-wrap:wrap}.l-statrow b{color:#211C15}
.l-cattiles{display:flex;flex-wrap:nowrap;gap:8px;padding:24px 0 6px;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none}.l-cattiles::-webkit-scrollbar{display:none}
.l-cattile{font-size:13.5px;color:#6E6557;background:#fff;border:1px solid #E9E2D4;border-radius:999px;padding:8px 16px;cursor:pointer;font-weight:500;white-space:nowrap;flex:0 0 auto}.l-cattile:hover{border-color:#E7D4AC;color:#211C15}.l-cattile.on{background:#B5791C;color:#fff;border-color:#B5791C}
.l-catwrap{position:relative}
.l-catfade{position:absolute;top:24px;right:0;bottom:6px;width:64px;pointer-events:none;background:linear-gradient(90deg,rgba(250,248,243,0) 0%,rgba(250,248,243,0) 52%,rgba(250,248,243,.92) 100%)}
.l-feedhead{display:flex;align-items:baseline;justify-content:space-between;padding:26px 0 2px;border-bottom:1px solid #E9E2D4;margin-bottom:2px}.l-feedhead h2{font-size:19px}.l-feedhead .c{font-size:12.5px;color:#9A9080;font-family:'JetBrains Mono',monospace}
.l-prehead{font-size:11.5px;font-family:'JetBrains Mono',monospace;color:#9A9080;letter-spacing:.07em;text-transform:uppercase;padding:26px 0 0}
.l-premium{display:flex;gap:16px;padding:12px 2px 8px;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:none;-ms-overflow-style:none}.l-premium::-webkit-scrollbar{display:none}.l-premium>a{flex:0 0 300px;scroll-snap-align:start}
/* PC: let the featured carousel run full viewport width, first card aligned to content */
@media(min-width:900px){.l-premium{margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);padding-left:max(24px,calc(50vw - 540px));padding-right:max(24px,calc(50vw - 540px))}.l-premium>a{flex:0 0 340px}}
.l-card{background:#fff;border:1px solid #E9E2D4;border-radius:14px;cursor:pointer;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 1px 8px rgba(150,110,30,.04);transition:box-shadow .15s,border-color .15s,transform .15s}.l-card:hover{border-color:#E7D4AC;box-shadow:0 10px 28px rgba(150,110,30,.13);transform:translateY(-2px)}
.l-cimg{position:relative;overflow:hidden;width:100%;aspect-ratio:1200/630;background:linear-gradient(135deg,#C99A2E,#A66A18);display:flex;align-items:center;justify-content:center;color:#fff;font-family:Fraunces;font-weight:700;font-size:46px}
.l-cimg-icon{background:#fff}.l-cardicon{width:88px;height:88px;object-fit:contain;border-radius:19px;background:#fff;border:1px solid #EDE6D8}
.l-cimgcover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.l-cbody{padding:13px 16px 15px;display:flex;flex-direction:column;gap:4px}
.l-cn{font-family:Fraunces;font-weight:600;font-size:18px;color:#211C15;line-height:1.15}.l-cdm{font-size:11.5px;color:#9A9080;font-family:'JetBrains Mono',monospace}
.l-ct{font-size:13px;color:#6E6557;line-height:1.45;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* tag reactions (detail) */
.l-rx{border-top:1px solid #E9E2D4;padding:24px 0 0;margin-top:8px}
.l-rxh{font-size:20px;font-family:Fraunces,Georgia,serif;font-weight:600;color:#211C15;margin-bottom:4px}
.l-rxsub{font-size:13px;color:#9A9080;margin-bottom:16px}
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
.l-tksub{font-size:13px;color:#9A9080;margin-bottom:14px}
.l-tkvouch{font-size:14px;color:#5A5347;margin-bottom:14px}.l-tkvouch b{color:#211C15}
.l-tkthrow{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #E0D8C8;border-radius:10px;padding:10px 16px;cursor:pointer;font-weight:600;font-size:14px;color:#211C15;margin-bottom:12px}.l-tkthrow:hover{border-color:#E7D4AC}
.l-tkchips{display:flex;flex-wrap:wrap;gap:8px}
.l-tkchip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #E9E2D4;border-radius:999px;padding:7px 14px;cursor:pointer;font-size:13.5px;font-weight:500;color:#2C261D}.l-tkchip:hover{border-color:#E7D4AC}.l-tkchip.on{background:#F6EBD4;border-color:#E7D4AC;color:#97600F}
.l-tkquota{font-size:12px;color:#9A9080;margin-top:12px;font-family:'JetBrains Mono',monospace}
/* detail */
.l-crumb{font-size:13px;color:#6E6557;padding:20px 0 0}
.l-head{padding:26px 0 8px}.l-head h1{font-size:30px}
.l-hero{display:flex;gap:22px;align-items:flex-start;padding:18px 0 26px;border-bottom:1px solid #E9E2D4}
.l-ico{width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#C99A2E,#A66A18);color:#fff;font-family:Fraunces;font-weight:700;font-size:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background-size:cover;background-position:center}
.l-one{font-size:17px;color:#6E6557;margin:7px 0 12px;max-width:600px}
.l-pills{display:flex;flex-wrap:wrap;gap:7px}.l-pill{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#6E6557;background:#F4F0E8;border:1px solid #E9E2D4;border-radius:999px;padding:3px 10px}.l-pill.plat{color:#97600F;background:#F6EBD4;border-color:#E7D4AC}
.l-heroact{margin-left:auto;display:flex;flex-direction:column;gap:9px;align-items:stretch;flex-shrink:0;min-width:172px}.l-heroact .l-btn{text-align:center}
.l-claim{font-size:12.5px;color:#97600F;cursor:pointer;text-align:center}.l-claim:hover{text-decoration:underline}
.l-prov{font-size:11.5px;color:#9A9080;text-align:center;line-height:1.5;margin-top:2px}
@media(max-width:680px){.l-hero{flex-wrap:wrap}.l-heroact{margin-left:0;width:100%;min-width:0}}
.l-cols{display:grid;grid-template-columns:1fr 320px;gap:40px;padding:30px 0 10px}
.l-blk{margin-bottom:28px}.l-blk h2{font-size:20px;margin-bottom:10px}.l-lead{color:#2C261D}
.l-iconblk{display:flex;align-items:center;justify-content:center;background:#F4F0E8;border:1px solid #E9E2D4;border-radius:12px;padding:38px}
.l-iconimg{width:104px;height:104px;object-fit:contain;border-radius:22px;background:#fff;border:1px solid #EDE6D8}
.l-who{display:flex;flex-wrap:wrap;gap:8px}.l-chip{background:#fff;border:1px solid #E9E2D4;border-radius:7px;padding:6px 12px;font-size:13.5px;font-weight:500;color:#2C261D}
.l-feat{list-style:none;padding:0;margin:0;display:grid;gap:9px}.l-feat li{padding-left:20px;position:relative;color:#2C261D}.l-feat li::before{content:'\\2713';position:absolute;left:0;color:#B5791C;font-weight:700}
.l-note{font-size:12px;color:#9A9080;font-style:italic}
.l-facts{background:#fff;border:1px solid #E9E2D4;border-radius:12px;padding:6px 16px}.l-f{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #E9E2D4;font-size:13.5px}.l-f:last-child{border-bottom:none}.l-k{color:#6E6557}.l-v{font-weight:500;text-align:right}
.l-lab{background:#F4F0E8;border:1px solid #E9E2D4;border-radius:14px;padding:18px;font-family:'JetBrains Mono',monospace;text-align:center}.l-lh{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:#97600F;font-weight:600;text-align:left}
.l-lockt{font-family:Inter,sans-serif;font-size:14px;font-weight:600;color:#211C15;margin-top:14px}.l-locksub{font-family:Inter,sans-serif;font-size:11.5px;color:#6E6557;max-width:230px;margin:6px auto 10px}
.l-engage{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.l-vouchbtn{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #E9E2D4;border-radius:999px;padding:8px 15px;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:700;transition:.12s;flex-shrink:0}.l-vouchbtn:hover{border-color:#E7D4AC}.l-vouchbtn.on{background:#FCF6E9}
.l-modal{position:fixed;inset:0;background:rgba(33,28,21,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px}
.l-modalcard{position:relative;background:#FAF8F3;border:1px solid #E7D4AC;border-radius:16px;padding:24px;max-width:440px;width:100%;box-shadow:0 24px 60px rgba(60,45,20,.3)}
.l-modalclose{position:absolute;top:10px;right:14px;background:none;border:none;font-size:25px;line-height:1;color:#9A9080;cursor:pointer}.l-modalclose:hover{color:#211C15}
.l-modaltext{font-size:13.5px;color:#5A5347;line-height:1.55;margin:8px 0 14px}
.l-modalhint{font-size:12px;color:#9A9080;margin-top:10px}
.l-rateset{display:flex;align-items:center;gap:13px;flex-wrap:wrap}
.l-rateset-l{font-size:14px;color:#6E6557;font-weight:500}
.l-rateset-stars{display:inline-flex;gap:3px}
.l-starbtn{background:none;border:none;padding:0;cursor:pointer;line-height:0;display:inline-flex}.l-starbtn:hover{transform:scale(1.08)}
.l-rateset-c{font-size:12.5px;color:#9A9080;font-family:'JetBrains Mono',monospace}
.l-reviews{border-top:1px solid #E9E2D4;padding:26px 0 0;margin-top:8px}.l-empty{font-size:13px;color:#6E6557;background:#F4F0E8;border:1px dashed #E9E2D4;border-radius:10px;padding:16px}
.l-claimcta{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;background:#FBF6EC;border:1px solid #E7D4AC;border-radius:14px;padding:18px 22px;margin-top:36px}
.l-claimcta-h{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:17px;color:#211C15}.l-claimcta-s{font-size:13px;color:#6E6557;margin-top:3px}
.l-claimcta .l-btn{flex-shrink:0}
.l-foot{border-top:1px solid #E9E2D4;margin-top:28px;padding:22px 0 50px;font-size:12.5px;color:#9A9080}
.l-row{display:flex;gap:18px;align-items:flex-start;padding:20px 4px;border-bottom:1px solid #E9E2D4;cursor:pointer;border-radius:10px;transition:background .12s}.l-row:hover{background:#fff}
.l-ic{width:72px;height:72px;border-radius:14px;background:linear-gradient(135deg,#C99A2E,#A66A18);color:#fff;font-weight:700;font-size:30px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:Fraunces;background-size:cover;background-position:center;overflow:hidden}
.l-fav{background:#fff;border:1px solid #EDE6D8}.l-fav img{width:100%;height:100%;object-fit:cover}
.l-nm{font-weight:600;color:#211C15;font-size:19px;font-family:Fraunces,Georgia,serif;line-height:1.2}.l-dm{font-size:12.5px;color:#9A9080;font-family:'JetBrains Mono',monospace;font-weight:400}.l-ol{font-size:15px;color:#5A5347;margin-top:5px;line-height:1.55;max-width:680px}
.l-tag{font-size:11px;font-family:'JetBrains Mono',monospace;padding:3px 9px;border-radius:5px;background:#F4F0E8;color:#6E6557;border:1px solid #E9E2D4}.l-tag.warn{background:#FBEFD9;color:#97600F;border-color:#E7D4AC}
/* header nav + dropdowns + bell */
.l-nav{display:flex;align-items:center;gap:4px}
.l-navi{font-size:14px;font-weight:500;color:#6E6557;padding:7px 11px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}.l-navi:hover{background:#F1EADE;color:#211C15}.l-navi.on{color:#211C15;background:#F1EADE}
.l-ddwrap{position:relative}
.l-dd{position:absolute;top:calc(100% + 8px);min-width:210px;background:#fff;border:1px solid #E9E2D4;border-radius:12px;box-shadow:0 12px 34px rgba(60,45,20,.16);padding:6px;z-index:40}
.l-dd.right{right:0}.l-dd.left{left:0}
.l-ddi{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;font-size:14px;color:#2C261D;cursor:pointer;white-space:nowrap}.l-ddi:hover{background:#F4F0E8}.l-ddi .s{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#9A9080}
.l-ddsep{height:1px;background:#E9E2D4;margin:6px 8px}
.l-ddhead{padding:11px 11px 7px}.l-ddname{font-weight:600;font-size:14.5px;color:#211C15}.l-ddmail{font-size:12px;color:#9A9080;margin-top:1px;overflow:hidden;text-overflow:ellipsis}
.l-ddtk{padding:9px 11px}.l-ddtk-h{display:flex;align-items:center;gap:7px;font-size:13.5px;color:#2C261D;font-weight:500}.l-ddtk-s{display:block;font-size:12px;color:#9A9080;font-family:'JetBrains Mono',monospace;margin-top:4px;margin-left:21px}
.l-bell{position:relative;width:36px;height:36px;border-radius:9px;border:1px solid #E9E2D4;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#6E6557}.l-bell:hover{border-color:#E7D4AC;color:#211C15}
.l-belldot{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;background:#C8102E;color:#fff;border:2px solid #FAF8F3;border-radius:9px;font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center}
.l-npnl{position:absolute;top:calc(100% + 8px);right:0;width:340px;max-height:72vh;overflow-y:auto;background:#fff;border:1px solid #E9E2D4;border-radius:12px;box-shadow:0 14px 38px rgba(60,45,20,.18);z-index:40}
.l-nph{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #E9E2D4;position:sticky;top:0;background:#fff}.l-nph b{font-family:Fraunces;font-size:15px;color:#211C15}.l-nmark{font-size:12px;color:#97600F;cursor:pointer;font-weight:500}
.l-nr{display:flex;gap:11px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid #F1EADE;cursor:pointer}.l-nr:hover{background:#FBF8F1}.l-nr.unread{background:#FCF6E9}.l-nr.unread:hover{background:#F9F0DD}
.l-nav-av{width:30px;height:30px;border-radius:8px;background:#B5791C;color:#fff;font-weight:600;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;background-size:cover;background-position:center;font-family:'JetBrains Mono',monospace}
.l-nrt{font-size:13px;color:#2C261D;line-height:1.45}.l-nrtime{font-size:11px;color:#9A9080;font-family:'JetBrains Mono',monospace;margin-top:2px}
.l-nempty{padding:34px 20px;text-align:center;font-size:13px;color:#9A9080}
.l-nempty b{display:block;font-family:Fraunces;font-size:14px;color:#6E6557;margin-bottom:5px;font-weight:600}
@media(max-width:680px){.l-nav{display:none}.l-npnl{width:300px}}
@media(max-width:820px){.l-cols{grid-template-columns:1fr}.l-search{display:none}}
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
const LegitAuthCtx = createContext<{ openAuth: (m?: AuthMode) => void; loggedIn: boolean }>({ openAuth: () => {}, loggedIn: false })
export const useLegitAuth = () => useContext(LegitAuthCtx)

export function LegitShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AuthMode>('signin')
  const { user, member, signOut } = useAuth() as {
    user: { id?: string; email?: string } | null
    member: { display_name?: string; avatar_url?: string | null; is_admin?: boolean } | null
    signOut: (redirectTo?: string) => Promise<void>
  }
  const [cats, setCats] = useState<string[]>([])
  const openAuth = (m: AuthMode = 'signin') => { setMode(m); setOpen(true) }
  const name = member?.display_name || user?.email?.split('@')[0] || 'You'
  const initial = name.trim()[0]?.toUpperCase() || '?'

  useEffect(() => {
    let alive = true
    supabase.from('listings').select('category').not('category', 'is', null).then(({ data }) => {
      if (!alive) return
      const m = new Map<string, number>()
      for (const r of (data as { category: string }[] | null) || []) m.set(r.category, (m.get(r.category) || 0) + 1)
      setCats([...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 12))
    })
    return () => { alive = false }
  }, [])

  return (
    <LegitAuthCtx.Provider value={{ openAuth, loggedIn: !!user }}>
      <div className="lgt">
        <LegitStyles />
        <header className="l-h">
          <div className="l-wrap l-hd">
            <Link to="/v2" className="l-logo"><span className="l-dot" />legit</Link>
            <nav className="l-nav">
              <Link to="/v2" className="l-navi">Browse</Link>
              <CategoriesMenu cats={cats} />
            </nav>
            <div className="l-auth" style={{ marginLeft: 'auto' }}>
              {user
                ? <>
                    <LegitBell recipientId={user.id || ''} />
                    <ProfileMenu name={name} email={user.email || ''} initial={initial} avatar={member?.avatar_url || null} isAdmin={!!member?.is_admin} memberId={user.id || ''} onSignOut={() => signOut('/v2')} />
                  </>
                : <>
                    <span className="l-login" onClick={() => openAuth('signin')}>Log in</span>
                    <span className="l-btn" onClick={() => openAuth('signup')}>Sign up — free</span>
                  </>}
            </div>
          </div>
        </header>
        {children}
      </div>
      <AuthModal open={open} onClose={() => setOpen(false)} initialMode={mode} />
    </LegitAuthCtx.Provider>
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

function CategoriesMenu({ cats }: { cats: string[] }) {
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const ref = useClickAway(() => setOpen(false))
  const go = (c?: string) => { setOpen(false); nav(c ? `/v2?cat=${encodeURIComponent(c)}` : '/v2') }
  return (
    <div className="l-ddwrap" ref={ref}>
      <span className={`l-navi ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)}>Categories <Chevron /></span>
      {open && (
        <div className="l-dd left">
          <div className="l-ddi" onClick={() => go()}>All categories</div>
          {cats.length > 0 && <div className="l-ddsep" />}
          {cats.map(c => <div key={c} className="l-ddi" onClick={() => go(c)}>{c}</div>)}
        </div>
      )}
    </div>
  )
}

function ProfileMenu({ name, email, initial, avatar, isAdmin, memberId, onSignOut }: { name: string; email: string; initial: string; avatar: string | null; isAdmin: boolean; memberId: string; onSignOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(0)
  const nav = useNavigate()
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

export function SearchIcon({ size = 17, color = '#9A9080' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="7" /><line x1="20.5" y1="20.5" x2="16.5" y2="16.5" />
    </svg>
  )
}

// Stars carry the rating shape; their COLOR carries the legit-ticket tier
// (tone) — so a crowd-vouched product reads "hotter" even before reviews exist.
export function StarRating({ value = 0, count = 0, size = 18, tone = '#E0A92E' }: { value?: number; count?: number; size?: number; tone?: string }) {
  const stars = [0, 1, 2, 3, 4].map(i => {
    const fill = Math.max(0, Math.min(1, value - i)) // 0..1 per star
    return (
      <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id={`lg-star-${i}`}>
            <stop offset={`${fill * 100}%`} stopColor={tone} />
            <stop offset={`${fill * 100}%`} stopColor="#EFE7D6" />
          </linearGradient>
        </defs>
        <path d="M12 2.5l2.9 6.2 6.6.9-4.8 4.6 1.2 6.6L12 18.7 6 21.4l1.2-6.6L2.4 9.6l6.6-.9z"
          fill={`url(#lg-star-${i})`} stroke={tone} strokeOpacity="0.5" strokeWidth="0.7" />
      </svg>
    )
  })
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
    if (myId) supabase.from('listing_ratings').select('rating').eq('listing_id', listingId).eq('member_id', myId).maybeSingle()
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
      ? supabase.from('listing_ratings').delete().eq('listing_id', listingId).eq('member_id', myId)
      : supabase.from('listing_ratings').upsert({ listing_id: listingId, member_id: myId, rating: next, updated_at: new Date().toISOString() }, { onConflict: 'listing_id,member_id' })
    const { error } = await q
    if (error) setMine(prev)
    else window.dispatchEvent(new Event('legit:rating'))
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
                fill={n <= shown ? tone : '#EFE7D6'} stroke={tone} strokeOpacity="0.5" strokeWidth="0.7" />
            </svg>
          </button>
        ))}
      </span>
      {!loggedIn && <span className="l-rateset-c">sign in to rate</span>}
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
  if (n >= 15) return { tone: '#C8102E', label: 'Certified legit' }   // scarlet
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
export function TicketBadge({ count, size = 13 }: { count: number; size?: number }) {
  if (!count) return null
  const { tone } = ticketTier(count)
  return (
    <span className="l-ticket" style={{ color: tone }}>
      <LegitSeal size={size} color={tone} /> {count} legit
    </span>
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
    else { setSpecs(prev => { const n = { ...prev }; if (had && mine) n[mine] = Math.max(0, (n[mine] || 1) - 1); n[specialty] = (n[specialty] || 0) + 1; return n }); if (!had) setCount(c => c + 1); setMine(specialty); window.dispatchEvent(new Event('legit:tickets')) }
    setBusy(false)
  }
  const takeBack = async () => {
    if (!myId || busy) return
    setBusy(true); setMsg('')
    const { error } = await supabase.from('listing_tickets').delete().eq('listing_id', listingId).eq('member_id', myId)
    if (!error) { setSpecs(prev => { const n = { ...prev }; if (mine) n[mine] = Math.max(0, (n[mine] || 1) - 1); return n }); setCount(c => Math.max(0, c - 1)); setMine(null); window.dispatchEvent(new Event('legit:tickets')) }
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
export function FaviconTile({ name, domain, icon = null, cls = 'l-ic' }: { name: string; domain: string; icon?: string | null; cls?: string }) {
  const host = (domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const fav = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=128` : null
  const chain = [icon, fav].filter(Boolean) as string[]
  const [stage, setStage] = useState(0)
  const src = chain[stage]
  if (!src) return <div className={cls}>{(name[0] || '?').toUpperCase()}</div>
  return (
    <div className={`${cls} l-fav`}>
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setStage(s => s + 1)} />
    </div>
  )
}

export function ListingRow({ p, tickets = 0 }: { p: Listing; tickets?: number }) {
  const oneliner = (p.tagline || p.description || '').slice(0, 180)
  return (
    <Link to={`/v2/s/${p.slug}`} className="l-row">
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
    <Link to={`/v2/s/${p.slug}`} className="l-card">
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
