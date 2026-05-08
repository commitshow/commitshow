-- CMO 메모리 강화 · 두 layer.
--
-- 현재 update-cmo-workspace 는 매 호출 stateless: 시스템 프롬프트 +
-- 현재 doc + 사용자 메시지만 보고 응답. M (CMO) 이 지난 결정을
-- 기억 못 함 → 매번 전략을 처음부터 설명해야 함. 두 layer 추가:
--
-- (A) cmo_chat_messages · 매 턴 user / assistant 둘 다 INSERT. 다음
--     호출 시 last 12 turns 를 시스템 컨텍스트에 prepend. M 이 직전
--     대화 흐름 기억.
-- (B) cmo_workspace.memory_md · M 이 자유롭게 채우는 노트. 새 대화
--     시작할 때 시스템 프롬프트에 항상 포함. 'tools' 가 아니라 일반
--     prompt 텍스트로 흐름 — Claude 가 응답에 'updated_memory_md'
--     포함하면 백엔드가 별도 컬럼에 persist.

-- (A) Chat history
CREATE TABLE IF NOT EXISTS public.cmo_chat_messages (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  role        text         NOT NULL CHECK (role IN ('user', 'assistant')),
  target_doc  text         NOT NULL CHECK (target_doc IN ('insights', 'roadmap')),
  content     text         NOT NULL,
  -- assistant turns: which doc field was rewritten + summary line
  summary     text,
  member_id   uuid         REFERENCES public.members(id) ON DELETE SET NULL,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmo_chat_messages_created
  ON public.cmo_chat_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cmo_chat_messages_doc
  ON public.cmo_chat_messages (target_doc, created_at DESC);

ALTER TABLE public.cmo_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read cmo_chat_messages"  ON public.cmo_chat_messages;
DROP POLICY IF EXISTS "admins write cmo_chat_messages" ON public.cmo_chat_messages;

CREATE POLICY "admins read cmo_chat_messages"
  ON public.cmo_chat_messages
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM members WHERE members.id = auth.uid() AND members.is_admin));

-- service_role bypasses RLS · only admins can read; INSERT happens
-- via service_role inside the Edge Function so no INSERT policy
-- needed for client-side flows (no client INSERTs admin chat).
GRANT SELECT ON public.cmo_chat_messages TO authenticated;
GRANT ALL    ON public.cmo_chat_messages TO service_role;

-- (B) Memory notebook column
ALTER TABLE public.cmo_workspace
  ADD COLUMN IF NOT EXISTS memory_md text NOT NULL DEFAULT '';

-- Seed prompt for first-time use · M can edit/expand from here.
UPDATE public.cmo_workspace
SET memory_md = $$# M 의 작업 메모

이 노트는 M (commit.show CMO) 이 자유롭게 채우는 영구 메모장. 매
대화에서 시스템 프롬프트에 항상 포함됨 · 결정 / 패턴 / 다음에 참고할
신호를 여기 적어둔다.

## 진행 중인 캠페인

(여기에 진행 사항 누적)

## 학습 / 패턴

(어떤 메시지가 잘 통했는지 · 어떤 톤이 안 통했는지)

## CEO 의도 / 강조

(CEO 가 명시한 우선순위 · 금기 · 강조 어휘)
$$
WHERE id = 1 AND (memory_md IS NULL OR memory_md = '');
