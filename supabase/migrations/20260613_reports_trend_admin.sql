-- time-series trend section on reports + admin manage policy (draft review + publish)
alter table reports add column if not exists trend jsonb;

drop policy if exists "admin manage reports" on reports;
create policy "admin manage reports" on reports for all
  using (exists (select 1 from members m where m.id = auth.uid() and m.is_admin))
  with check (exists (select 1 from members m where m.id = auth.uid() and m.is_admin));
alter table reports add column if not exists compare jsonb;
