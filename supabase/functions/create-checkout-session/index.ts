// create-checkout-session — server-side Stripe Checkout Session builder.
//
// Flow:
//   1. Authenticate the request (require a non-anon JWT).
//   2. Re-verify the member is actually past their free quota (no client-
//      side trust — the gate runs server-side).
//   3. Create a Stripe Checkout Session for the configured audit-fee SKU.
//   4. Insert a `payments` row with status='pending' so the webhook can
//      reconcile by stripe_session_id.
//   5. Return { url } so the client can redirect.
//
// Why server-side: the price ($99) and the SKU live on Stripe; the
// member id and the "did you actually exhaust free quota?" check have
// to happen on a trusted backend, not in the SubmitForm. Webhook +
// session_id link guarantees idempotency even if a determined client
// double-submits.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — Deno runtime

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import Stripe from 'https://esm.sh/stripe@14.22.0?target=deno'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Default-paid policy · the actual free quota is read from
// app_settings.free_audits_per_member at request time so admin promo
// toggles take effect without a redeploy. This constant is the
// emergency fallback if the settings RPC fails (transient DB error)
// — pick something safe enough that the gate still works.
const FREE_AUDITS_FALLBACK_DEFAULT = 3
const AUDIT_FEE_CENTS = 9900   // $99.00 · matches src/lib/pricing.ts
const FOUNDER_PRICE_FALLBACK_CENTS = 4900   // $49.00 · matches founder_price_cents seed

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST required' }, 405)

  // Stripe secret key is server-only.
  const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY')
  if (!STRIPE_SECRET) return json({ error: 'Stripe not configured (missing STRIPE_SECRET_KEY)' }, 500)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Authenticate the caller via the JWT in the Authorization header.
  // Need a real user id, not an anon key, because we're stamping payments.member_id.
  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Authorization header required' }, 401)

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'Invalid auth token' }, 401)
  const userId = userData.user.id
  const userEmail = userData.user.email ?? null

  // Parse body — minimal so we can extend later (library purchases, etc.)
  let body: { kind?: 'audit_fee'; success_url?: string; cancel_url?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const kind = body.kind ?? 'audit_fee'
  if (kind !== 'audit_fee') return json({ error: 'Only audit_fee supported in V1' }, 400)

  // Eligibility re-check on the server. Client could be lying about
  // priorCount; the only trust line is auth.users + projects.creator_id.
  // Free quota is read live from app_settings so admin can flip the promo
  // without redeploying this function.
  const [{ count: priorCount }, { data: memberRow }, { data: freeQuotaJson }, { data: founderRows }] = await Promise.all([
    admin
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', userId),
    admin
      .from('members')
      .select('paid_audits_credit')
      .eq('id', userId)
      .maybeSingle(),
    admin.rpc('get_app_setting', { p_key: 'free_audits_per_member' }),
    admin.rpc('founder_pricing_status'),
  ])

  const used   = priorCount ?? 0
  const credit = memberRow?.paid_audits_credit ?? 0
  // Defensive parse — RPC returns jsonb, supabase-js gives us either a
  // number or null; coerce-and-clamp so a bad seed value doesn't paywall
  // the fallback default.
  const parsedQuota = typeof freeQuotaJson === 'number' ? freeQuotaJson
                    : typeof freeQuotaJson === 'string' ? Number(freeQuotaJson)
                    : NaN
  const freeQuota = Number.isFinite(parsedQuota) && parsedQuota >= 0
    ? Math.floor(parsedQuota)
    : FREE_AUDITS_FALLBACK_DEFAULT

  // Don't sell a credit to someone who still has free or paid budget.
  // The UI shouldn't even surface the checkout button in that state, but
  // we double-check on the server.
  if (used < freeQuota) {
    return json({ error: 'Free audits still available · no payment needed' }, 400)
  }
  if (credit > 0) {
    return json({ error: 'Existing paid credit unused · use it before buying another' }, 400)
  }

  // Founder pricing window · re-checked server-side off the live counter
  // (race-resistant: another buyer landing the 1000th sale between this
  // check and our Stripe call would still see them get $49 — we accept
  // that ±1 fuzziness in exchange for a single round trip).
  const founder = Array.isArray(founderRows) && founderRows.length > 0
    ? founderRows[0] as { window_open: boolean; cap: number; paid_count: number; remaining: number; price_cents: number }
    : null
  const founderActive = !!(founder && founder.window_open && founder.remaining > 0)
  const unitAmount = founderActive
    ? (founder?.price_cents ?? FOUNDER_PRICE_FALLBACK_CENTS)
    : AUDIT_FEE_CENTS
  const productDescription = founderActive
    ? `Founder pricing · audition ${founder!.paid_count + 1} of ${founder!.cap} · Encore credit recoupable on Diploma`
    : 'One additional audit · Encore credit recoupable on Diploma'

  // Build Stripe session.
  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: '2024-09-30.acacia' })
  const origin = req.headers.get('origin') ?? 'https://commit.show'
  const successUrl = body.success_url ?? `${origin}/submit?payment=success&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl  = body.cancel_url  ?? `${origin}/submit?payment=canceled`

  // Idempotency-Key — Stripe collapses identical create() calls within 24h
  // to the same session. Without it, a network retry or a double-clicked
  // 'Pay $99' button can spawn two Checkout sessions. We bucket the key
  // per (member, day) so a deliberate second purchase the next day still
  // works, but a same-day retry just returns the existing session.
  //
  // CONFIG_VERSION: bump whenever the Checkout Session params change
  // (price · payment methods · metadata · etc). Stripe enforces "same key
  // + different params = error" — bumping version separates new config
  // from any cached prior-day attempts. History:
  //   v1 → original payment_method_types: ['card'] · test mode era
  //   v2 → 2026-05-09 · payment_method_types removed (dynamic) · live mode
  const CONFIG_VERSION = 'v2'
  const dayBucket      = new Date().toISOString().slice(0, 10)
  const idempotencyKey = `audit-fee:${CONFIG_VERSION}:${userId}:${dayBucket}:${unitAmount}`

  let session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Dynamic payment methods (default when payment_method_types is omitted) ·
      // Stripe evaluates 100+ signals (currency · location · amount · device)
      // and shows the most relevant method per customer · Apple Pay / Google
      // Pay / Cash App / Klarna / ACH all auto-show when enabled in Dashboard
      // settings. Hardcoding ['card'] blocks these and hurts conversion.
      // Configure which methods are enabled at:
      //   https://dashboard.stripe.com/settings/payment_methods
      customer_email: userEmail ?? undefined,
      client_reference_id: userId,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          product_data: {
            name: founderActive ? 'commit.show audit fee · Founder pricing' : 'commit.show audit fee',
            description: productDescription,
          },
        },
      }],
      metadata: {
        member_id:       userId,
        kind:            'audit_fee',
        is_founder_price: founderActive ? 'true' : 'false',
        founder_paid_count: founder ? String(founder.paid_count) : '',
      },
      success_url: successUrl,
      cancel_url:  cancelUrl,
    }, { idempotencyKey })
  } catch (e) {
    console.error('[create-checkout] stripe.create failed', (e as Error)?.message ?? e)
    return json({ error: 'Stripe checkout creation failed' }, 502)
  }

  // Pending payments row · webhook flips status when Stripe confirms.
  const { error: insertErr } = await admin
    .from('payments')
    .insert([{
      member_id:                userId,
      kind:                     'audit_fee',
      amount_cents:             unitAmount,
      currency:                 'USD',
      stripe_session_id:        session.id,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      status:                   'pending',
      metadata:                 {
        origin,
        prior_count:        used,
        is_founder_price:   founderActive,
        founder_paid_count: founder?.paid_count ?? null,
      },
    }])
  if (insertErr) {
    console.error('[create-checkout] payments insert failed', insertErr.message)
    // Continue — the session itself is valid, webhook can still upsert by stripe_session_id.
  }

  return json({ url: session.url, session_id: session.id })
})
