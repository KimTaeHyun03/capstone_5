-- 2-5 근무표 확정·공개는 점주만 한다 (프로세스 목록: 확정·공개 = 점주).
-- 0단계 RLS 의 "manager update work_schedule" 정책은 매니저의 UPDATE 를 값 제한 없이 허용해서(검토 요청·완료를 위한 정책),
-- 매니저가 status 를 '확정' 으로 직접 바꾸거나 확정된 근무표를 되돌릴 수 있었다. RLS 는 값을 검사하지 못하므로 트리거로 막는다.
-- 스케줄러·서버 호출(JWT 없음)은 통과한다. 테이블은 추가하지 않는다(22개 유지).
create or replace function app.guard_publish_owner_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.status = '확정' or coalesce(new.is_published, false))
     and not (old.status = '확정' and coalesce(old.is_published, false) = coalesce(new.is_published, false) and new.status = '확정')
  then
    -- 확정·공개로 바뀌는 순간
    if not app.is_system_call() and not app.is_owner() then
      raise exception '근무표 확정·공개는 점주만 할 수 있습니다.' using errcode = '42501';
    end if;
  elsif old.status = '확정' and new.status <> '확정' then
    -- 확정된 근무표를 다시 편집 상태로 되돌리는 것도 점주만
    if not app.is_system_call() and not app.is_owner() then
      raise exception '확정된 근무표는 점주만 되돌릴 수 있습니다.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_publish_owner_only() from public, anon, authenticated;

drop trigger if exists trg_guard_publish_owner_only on public.work_schedule;
create trigger trg_guard_publish_owner_only
  before update on public.work_schedule
  for each row execute function app.guard_publish_owner_only();
