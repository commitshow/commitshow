// OpenAPI 3.1 spec for the public commit.show audit API.
//
// Served at https://commit.show/api/openapi.json. Anything that consumes
// OpenAPI auto-discovers the endpoint:
//   · ChatGPT custom GPT (Actions): pastes URL, gets typed tool stub
//   · n8n / Zapier / Make: HTTP node imports the spec for typing
//   · Postman / Insomnia / Bruno: import-from-URL
//   · LLM agents that follow OpenAPI conventions
//
// The spec is hand-written (not generated) so it stays the documentation
// source of truth. handleAudit in src/api/audit.ts must keep this shape.

const SPEC = {
  openapi: '3.1.0',
  info: {
    title:       'commit.show audit API',
    summary:     'Public audit scores for vibe-coded GitHub projects.',
    description: [
      'Read the live commit.show audit for any public GitHub repo.',
      '',
      'Returns a paste-ready markdown summary by default (`format=md`)',
      'or the full audit envelope as JSON (`format=json`). No API key',
      'required. CORS open for browser fetch.',
      '',
      'Companion CLI: `npx commitshow@latest audit <target>`. The audit',
      'engine, rate limits, and snapshot cache are shared across the',
      'CLI, the website, and this REST surface — calling either one',
      "warms the same 7-day commit-sha cache, so a request that finds",
      "an existing audit doesn't count against your daily quota.",
    ].join('\n'),
    version: '1.0.0',
    contact: {
      name: 'commit.show',
      url:  'https://commit.show',
    },
    license: {
      name: 'MIT',
      url:  'https://github.com/commitshow/commitshow/blob/main/LICENSE',
    },
  },
  servers: [
    {
      url:         'https://commit.show',
      description: 'Production',
    },
  ],
  tags: [
    {
      name:        'audit',
      description: 'Run or read the live audit for a GitHub repo.',
    },
  ],
  paths: {
    '/api/audit': {
      get: {
        tags:        ['audit'],
        summary:     'Audit a public GitHub repo',
        description: [
          'Returns the latest commit.show audit for the supplied repo.',
          'Renders markdown by default; pass `format=json` for the',
          'machine-readable envelope.',
          '',
          'If `repo` is unknown to commit.show, this triggers a fresh',
          'preview audit (counts against per-IP / per-URL / global daily',
          'caps). If the repo already has a snapshot ≤ 7 days old, the',
          'cached audit returns immediately and does NOT count against',
          'quota.',
          '',
          'Always use the canonical owner/repo. The endpoint HEAD-checks',
          "github.com first, so a hallucinated slug returns 404 with a",
          "`not_found` envelope before any audit budget is spent.",
        ].join('\n'),
        operationId: 'auditRepo',
        parameters: [
          {
            name:     'repo',
            in:       'query',
            required: true,
            description: 'GitHub repo. Accepts a full URL, `github.com/owner/repo`, or the bare `owner/repo` slug.',
            schema: {
              type:    'string',
              example: 'github.com/supabase/supabase',
            },
          },
          {
            name:     'format',
            in:       'query',
            required: false,
            description: 'Response format. `md` returns paste-ready markdown for chat agents; `json` returns the full audit envelope.',
            schema: {
              type:    'string',
              enum:    ['md', 'json'],
              default: 'md',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Audit returned. Format follows `format=` param.',
            content: {
              'text/markdown': {
                schema: { type: 'string' },
                example: [
                  '# commit.show audit · supabase/supabase',
                  '',
                  '**Score: 87 / 100**',
                  '',
                  '| Pillar | Score |',
                  '|---|---|',
                  '| Audit (50%) | 44 / 50 |',
                  '| Scout (30%) | 28 / 30 |',
                  '| Community (20%) | 15 / 20 |',
                  '',
                  '## Strengths',
                  '1. [Audit] 80+ edge functions · LCP 1.4s · 50 RLS policies',
                  '2. [Brief] Brief integrity 9/10 · all 6 sections answered',
                  '3. [Tech] 6 tech layers · full-stack evidence',
                  '',
                  '## Concerns',
                  '1. [A11y] Buttons missing aria-labels',
                  '2. [Security] No API rate limit on /auth endpoint',
                  '',
                  '[View full audit on commit.show](https://commit.show/projects/...)',
                ].join('\n'),
              },
              'application/json': {
                schema: { $ref: '#/components/schemas/AuditEnvelope' },
              },
            },
          },
          '400': {
            description: 'Repo missing or malformed.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
          },
          '404': {
            description: "Repo doesn't resolve on github.com — wrong owner spelling, private repo, or renamed.",
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
          },
          '429': {
            description: 'Rate limit exceeded. See `quota_reset` timestamp in response body.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
          },
        },
      },
      post: {
        tags:        ['audit'],
        summary:     'Audit a public GitHub repo (POST variant)',
        description: 'Same as the GET, but accepts a JSON body. Useful when CORS preflight makes a query-string GET awkward.',
        operationId: 'auditRepoPost',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repo'],
                properties: {
                  repo:   { type: 'string', example: 'github.com/supabase/supabase' },
                  format: { type: 'string', enum: ['md', 'json'], default: 'md' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Same as GET.', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuditEnvelope' } } } },
          '400': { description: 'Repo missing or malformed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          '404': { description: 'Repo not found on github.com.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          '429': { description: 'Rate limit exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      AuditEnvelope: {
        type: 'object',
        description: 'Full audit envelope · the same shape the CLI emits with `--json`.',
        properties: {
          status: {
            type: 'string',
            enum: ['ready', 'pending'],
            description: '`ready` when a snapshot is available · `pending` while a fresh preview is computing.',
          },
          project: {
            type: 'object',
            properties: {
              id:           { type: 'string', format: 'uuid' },
              project_name: { type: 'string' },
              github_url:   { type: 'string', format: 'uri' },
              live_url:     { type: 'string', format: 'uri', nullable: true },
              status:       { type: 'string', enum: ['preview', 'active', 'graduated', 'valedictorian', 'retry'] },
              creator_id:   { type: 'string', format: 'uuid', nullable: true },
              creator_name: { type: 'string', nullable: true },
            },
          },
          snapshot: {
            type: 'object',
            properties: {
              id:               { type: 'string', format: 'uuid' },
              created_at:       { type: 'string', format: 'date-time' },
              trigger_type:     { type: 'string', enum: ['initial', 'resubmit', 'weekly', 'season_end'] },
              score_total:      { type: 'integer', minimum: 0, maximum: 100 },
              score_auto:       { type: 'integer', minimum: 0, maximum: 50 },
              score_forecast:   { type: 'integer', minimum: 0, maximum: 30 },
              score_community:  { type: 'integer', minimum: 0, maximum: 20 },
              score_total_delta: { type: 'integer', nullable: true, description: 'Delta vs the previous snapshot for this repo.' },
              rich_analysis: {
                type: 'object',
                properties: {
                  scout_brief: {
                    type: 'object',
                    properties: {
                      strengths:  { type: 'array', items: { $ref: '#/components/schemas/Bullet' }, description: 'Up to 5 bullets · top 3 surface in markdown by default.' },
                      weaknesses: { type: 'array', items: { $ref: '#/components/schemas/Bullet' }, description: 'Up to 3 bullets per the 5+3 asymmetric doctrine.' },
                    },
                  },
                  tldr: { type: 'string' },
                },
              },
            },
          },
          quota: { $ref: '#/components/schemas/Quota' },
        },
      },
      Bullet: {
        type: 'object',
        properties: {
          axis:   { type: 'string', description: 'Pillar tag (e.g. Audit · Brief · Tech · A11y · Security).', example: 'Audit' },
          bullet: { type: 'string', description: 'One-line evidence statement.' },
        },
      },
      Quota: {
        type: 'object',
        properties: {
          reset_at: { type: 'string', format: 'date-time' },
          ip:       { $ref: '#/components/schemas/QuotaTier' },
          url:      { $ref: '#/components/schemas/QuotaTier' },
          global:   { $ref: '#/components/schemas/QuotaTier' },
        },
      },
      QuotaTier: {
        type: 'object',
        properties: {
          count:     { type: 'integer' },
          limit:     { type: 'integer' },
          remaining: { type: 'integer' },
          tier:      { type: 'string', enum: ['anon', 'authed'], nullable: true },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'string',
            description: 'Machine-readable error code.',
            enum: ['missing_repo', 'bad_repo', 'not_found', 'rate_limited', 'misconfigured', 'upstream_invalid_json'],
          },
          message: { type: 'string', description: 'Human-readable explanation.' },
          target:  { type: 'string', description: 'The github URL that was attempted, if applicable.', nullable: true },
          input:   { type: 'string', description: 'The raw `repo` value the caller sent, if it was malformed.', nullable: true },
        },
      },
    },
  },
} as const

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function handleOpenAPI(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'GET')     return new Response('GET required', { status: 405, headers: CORS })
  return new Response(JSON.stringify(SPEC, null, 2), {
    status: 200,
    headers: {
      'Content-Type':  'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      ...CORS,
    },
  })
}
