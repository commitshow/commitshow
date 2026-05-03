-- CMO's Room · user-share template variant.
-- The existing cmo_templates table held only marketing-side copy
-- (M's voice, third person: "@minji_dev just scored 82..."). Now we
-- also need user-share templates: first-person copy that the user
-- themselves clicks "Share on X" to post when an event happens on
-- their project (audit complete · graduation · milestone · early
-- spotter). One-button flow: platform opens twitter.com/intent/tweet
-- pre-filled with this template + the project URL (which carries the
-- per-project og:image card).
--
-- Schema change: cmo_templates.audience column ('marketing' default ·
-- 'user_share' new). Same trigger types, different copy + voice.

ALTER TABLE public.cmo_templates
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'marketing'
    CHECK (audience IN ('marketing', 'user_share'));

-- Drop the existing PK and re-create as composite (id + audience) so
-- the same trigger type can have one marketing row and one user_share
-- row. Drop existing FKs first if any (none currently), then redefine.
ALTER TABLE public.cmo_templates DROP CONSTRAINT IF EXISTS cmo_templates_pkey;
ALTER TABLE public.cmo_templates ADD CONSTRAINT cmo_templates_pkey PRIMARY KEY (id, audience);

-- Seed user_share variants for the 4 events that apply to a single
-- creator (weekly_picks excluded · it's a multi-project digest, not
-- a per-user event). Copy is FIRST PERSON, English (X audience is US),
-- mirrors the lowercase indie voice from CMO.md §3.
INSERT INTO public.cmo_templates (id, audience, label, copy_template, fires_when, data_source) VALUES
  ('audit_complete', 'user_share',
   '1. 사용자 audit 완료 공유',
   $$just got my repo audited on commit.show ↓

{score}/100 · band {band}

↓ {top_concern_1}
↑ {top_strength_1}

audit your own: npx commitshow audit github.com/{owner}/{project_name}

commit.show/projects/{project_id}$$,
   '사용자가 본인 프로젝트 audit 결과 공유 시 · /me · /projects/:id 의 "Share on X" 버튼',
   'project.project_name · score · concerns[0] · strengths[0]'),
  ('graduation', 'user_share',
   '2. 사용자 졸업 공유',
   $$just graduated {grade} on commit.show · {project_name} · {score}/100.

ranked #{rank} of {total_in_season} this season.

every commit, on stage.

commit.show/projects/{project_id}$$,
   '사용자가 본인 졸업 결과 공유 시',
   'project.project_name · graduation_grade · final score · rank'),
  ('milestone', 'user_share',
   '3. 사용자 milestone 공유',
   $${project_name} just hit {milestone_label} on commit.show.

ranked #{rank} in {category} · auditioning live.

commit.show/projects/{project_id}$$,
   '사용자가 본인 milestone (top10·100일 streak·등) 공유 시',
   'milestone_type · project · category · rank'),
  ('early_spotter', 'user_share',
   '4. Scout Early Spotter 공유',
   $$called it · spotted {project_name} {days_before} days before it graduated {grade} on commit.show.

{scout_tier} Scout · early spotter hit #{hit_count}.

commit.show/scouts/{scout_id}$$,
   'Scout 가 본인 Early Spotter 적중 공유 시 · /me · /scouts/:id',
   'scout.tier · project · days_before_graduation · hit_count')
ON CONFLICT (id, audience) DO NOTHING;
