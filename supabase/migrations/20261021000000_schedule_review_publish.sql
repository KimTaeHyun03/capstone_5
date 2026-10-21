-- 5~7단계: 2-4 초안 검토·수정, 2-5 확정·공개, 2-6 확정 스케줄 조회
-- 새 테이블 없음(22개 유지). 트리거 2개 + 임시 RLS 정책.

-- =====================================================================
-- 2 E4 · 수정 배정 재검증 — 경고(has_warning) 배정이 남아 있으면 확정 차단
-- =====================================================================
create or replace function block_publish_with_warning() returns trigger
language plpgsql as $$
begin
  if new.status = '확정' and exists (
    select 1 from shift_assignment where schedule_id = new.schedule_id and has_warning
  ) then
    raise exception '규칙 위반 배정이 남아 있어 확정할 수 없습니다 (schedule_id=%)', new.schedule_id;
  end if;
  return new;
end $$;

create trigger trg_block_publish_with_warning
  before update of status on work_schedule
  for each row execute function block_publish_with_warning();

-- =====================================================================
-- 2 E5 · 확정 공개 알림 (+ 검토 요청·검토 완료 알림)
-- 상태 전환을 보고 notification 에 기록한다. 화면은 notification 에 직접 쓰지 않는다.
--   초안 → 검토중 : 매니저에게 검토 요청
--   검토중 → 초안 : 점주에게 검토 완료
--   → 확정(공개)  : 매니저·알바생 전원에게 공개 알림
-- =====================================================================
create or replace function notify_schedule_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  week_label text := to_char(new.target_week, 'MM.DD') || ' 주';
  roles text[];
  msg text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = '초안' and new.status = '검토중' then
    roles := array['매니저'];
    msg := week_label || ' 근무표 초안 검토 요청이 도착했습니다.';
  elsif old.status = '검토중' and new.status = '초안' then
    roles := array['점주'];
    msg := week_label || ' 근무표 초안 검토가 끝났습니다.';
  elsif new.status = '확정' and new.is_published then
    roles := array['매니저', '알바생'];
    msg := week_label || ' 근무표가 확정·공개되었습니다. 근무표 탭에서 확인하세요.';
  else
    return new;
  end if;

  insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
  select u.user_id, null, '근무 스케줄', '자동 감지', msg, now(), false
  from user_account u
  where u.store_id = new.store_id and u.role = any (roles) and u.status = '활성';

  return new;
end $$;

create trigger trg_notify_schedule_status
  after update of status on work_schedule
  for each row execute function notify_schedule_status();

-- =====================================================================
-- 임시 RLS — 0단계(인증·RLS 정비) 전까지 anon 으로 스케줄 읽기·쓰기를 허용한다.
-- 0단계에서 이 정책들을 지우고 authenticated + 같은 store_id + 역할별 정책으로 바꾼다.
-- (2-6 알바생은 is_published = true 인 스케줄의 본인 배정만 읽도록 좁힐 것)
-- =====================================================================
create policy "anon read work_schedule (임시)"     on work_schedule    for select to anon using (true);
create policy "anon insert work_schedule (임시)"   on work_schedule    for insert to anon with check (true);
create policy "anon update work_schedule (임시)"   on work_schedule    for update to anon using (true) with check (true);
create policy "anon read shift_assignment (임시)"   on shift_assignment for select to anon using (true);
create policy "anon insert shift_assignment (임시)" on shift_assignment for insert to anon with check (true);
create policy "anon update shift_assignment (임시)" on shift_assignment for update to anon using (true) with check (true);
create policy "anon delete shift_assignment (임시)" on shift_assignment for delete to anon using (true);
