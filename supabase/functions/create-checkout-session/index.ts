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

const FREE_REGISTRATIONS_PER_MEMBER = 3
const AUDIT_FEE_CENTS = 9900   // $99.00 · matches src/lib/pricing.ts

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
  const [{ count: priorCount }, { data: memberRow }] = await Promise.all([
    admin
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', userId),
    admin
      .from('members')
      .select('paid_audits_credit')
      .eq('id', userId)
      .maybeSingle(),
  ])

  const used = priorCount ?? 0
  const credit = memberRow?.paid_audits_credit ?? 0

  // Don't sell a credit to someone who still has free or paid budget.
  // The UI shouldn't even surface the checkout button in that state, but
  // we double-check on the server.
  if (used < FREE_REGISTRATIONS_PER_MEMBER) {
    return json({ error: 'Free audits still available · no payment needed' }, 400)
  }
  if (credit > 0) {
    return json({ error: 'Existing paid credit unused · use it before buying another' }, 400)
  }

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
  const dayBucket = new Date().toISOString().slice(0, 10)
  const idempotencyKey = `audit-fee:${userId}:${dayBucket}`

  let session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: userEmail ?? undefined,
      client_reference_id: userId,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: AUDIT_FEE_CENTS,
          product_data: {
            name: 'commit.show audit fee',
            description: 'One additional audit · conditional refund on graduation',
          },
        },
      }],
      metadata: {
        member_id: userId,
        kind:      'audit_fee',
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
      amount_cents:             AUDIT_FEE_CENTS,
      currency:                 'USD',
      stripe_session_id:        session.id,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      status:                   'pending',
      metadata:                 { origin, prior_count: used },
    }])
  if (insertErr) {
    console.error('[create-checkout] payments insert failed', insertErr.message)
    // Continue — the session itself is valid, webhook can still upsert by stripe_session_id.
  }

  return json({ url: session.url, session_id: session.id })
})
