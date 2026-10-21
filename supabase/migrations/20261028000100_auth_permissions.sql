-- 인증 기준 권한 정리 — 11~15단계 함수와 3~4단계 스케줄 함수를 "로그인한 사용자 + 역할 + 같은 매장" 기준으로 바꾸고,
-- 개발용 임시 정책과 비로그인(anon) 개방을 모두 닫는다. 테이블은 추가하지 않는다(22개 유지).
--
-- ■ 방식: 기존 함수는 `<이름>_impl` 로 이름을 바꿔 내부 전용(아무에게도 실행 권한 없음)으로 두고,
--   같은 이름·같은 인자(이름·타입·기본값)의 래퍼 함수가 권한을 검사한 뒤 _impl 을 호출한다.
--   (원본 로직은 그대로라 이전 마이그레이션·테스트와 어긋나지 않는다. 래퍼는 anon·PUBLIC 에서 회수하고 authenticated 에만 연다.)
-- ■ 스케줄러(pg_cron)·서버 호출은 JWT 가 없다. 그런 호출(JWT role 클레임이 없거나 service_role)만 "시스템 호출"로 보고
--   마감·권장량 계산 같은 점주 전용 함수를 허용한다. 비로그인(anon) 요청은 role='anon' 이고 실행 권한도 없어 통과하지 못한다.
-- ■ 사용자 id 인자(p_user_id 등)는 호환을 위해 남기되 "로그인한 본인 id 와 같아야" 한다(다르면 거부).

-- ---------------------------------------------------------------------
-- 1. 권한 검사 헬퍼 (app 스키마, authenticated 만 실행)
-- ---------------------------------------------------------------------
create or replace function app.is_system_call() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('', 'service_role')
$$;

create or replace function app.assert_self(p_user_id bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null or p_user_id is distinct from app.my_user_id() then
    raise exception '본인 계정으로만 실행할 수 있습니다.' using errcode = '42501';
  end if;
end $$;

create or replace function app.assert_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception '점주 또는 매니저만 실행할 수 있습니다.' using errcode = '42501'; end if;
end $$;

create or replace function app.assert_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner() then raise exception '점주만 실행할 수 있습니다.' using errcode = '42501'; end if;
end $$;

-- 점주이거나, 스케줄러 같은 시스템 호출
create or replace function app.assert_owner_or_system() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_system_call() and not app.is_owner() then
    raise exception '점주만 실행할 수 있습니다.' using errcode = '42501';
  end if;
end $$;

create or replace function app.assert_ingredient(p_ingredient_id bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_ingredient_id is null or not app.ingredient_in_store(p_ingredient_id) then
    raise exception '같은 매장의 재료가 아닙니다.' using errcode = '42501';
  end if;
end $$;

revoke all on function app.is_system_call(), app.assert_self(bigint), app.assert_admin(), app.assert_owner(),
  app.assert_owner_or_system(), app.assert_ingredient(bigint) from public, anon;
grant execute on function app.is_system_call(), app.assert_self(bigint), app.assert_admin(), app.assert_owner(),
  app.assert_owner_or_system(), app.assert_ingredient(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 11~15단계 함수 래퍼
-- ---------------------------------------------------------------------
-- 4-3 실사·폐기: 점주·매니저, 본인 id, 같은 매장 재료
alter function public.record_stock_adjustment(bigint, text, numeric, bigint, text) rename to record_stock_adjustment_impl;
revoke all on function public.record_stock_adjustment_impl(bigint, text, numeric, bigint, text) from public, anon, authenticated;
create function public.record_stock_adjustment(p_ingredient_id bigint, p_type text, p_qty numeric, p_user_id bigint, p_reason text default null)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_admin();
  perform app.assert_self(p_user_id);
  perform app.assert_ingredient(p_ingredient_id);
  return public.record_stock_adjustment_impl(p_ingredient_id, p_type, p_qty, p_user_id, p_reason);
end $$;

-- 4-4 부족 신고: 같은 매장 구성원 누구나, 신고자는 본인
alter function public.submit_shortage_report(bigint, bigint, text, text) rename to submit_shortage_report_impl;
revoke all on function public.submit_shortage_report_impl(bigint, bigint, text, text) from public, anon, authenticated;
create function public.submit_shortage_report(p_ingredient_id bigint, p_reporter_id bigint, p_level text default null, p_memo text default null)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_self(p_reporter_id);
  perform app.assert_ingredient(p_ingredient_id);
  return public.submit_shortage_report_impl(p_ingredient_id, p_reporter_id, p_level, p_memo);
end $$;

-- 신고 확인 처리: 점주·매니저, 같은 매장 신고
alter function public.resolve_shortage_report(bigint) rename to resolve_shortage_report_impl;
revoke all on function public.resolve_shortage_report_impl(bigint) from public, anon, authenticated;
create function public.resolve_shortage_report(p_report_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_admin();
  if not exists (select 1 from public.shortage_report r where r.report_id = p_report_id and app.ingredient_in_store(r.ingredient_id)) then
    raise exception '같은 매장의 신고가 아닙니다.' using errcode = '42501';
  end if;
  perform public.resolve_shortage_report_impl(p_report_id);
end $$;

-- 알림 모두 읽음: 본인 것만
alter function public.mark_notifications_read(bigint) rename to mark_notifications_read_impl;
revoke all on function public.mark_notifications_read_impl(bigint) from public, anon, authenticated;
create function public.mark_notifications_read(p_user_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_self(p_user_id);
  perform public.mark_notifications_read_impl(p_user_id);
end $$;

-- 5-1 권장 발주량 산출: 점주(또는 스케줄러)
alter function public.calculate_order_recommendations(date) rename to calculate_order_recommendations_impl;
revoke all on function public.calculate_order_recommendations_impl(date) from public, anon, authenticated;
create function public.calculate_order_recommendations(p_period_start date default null)
returns integer language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_owner_or_system();
  return public.calculate_order_recommendations_impl(p_period_start);
end $$;

-- 5-2 발주 등록: 점주, 본인 id, 같은 매장 재료
alter function public.place_purchase_order(bigint, jsonb) rename to place_purchase_order_impl;
revoke all on function public.place_purchase_order_impl(bigint, jsonb) from public, anon, authenticated;
create function public.place_purchase_order(p_user_id bigint, p_lines jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  perform app.assert_owner();
  perform app.assert_self(p_user_id);
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      perform app.assert_ingredient((l->>'ingredient_id')::bigint);
    end loop;
  end if;
  return public.place_purchase_order_impl(p_user_id, p_lines);
end $$;

-- 5-3 입고 처리: 점주·매니저, 본인 id, 같은 매장 발주
alter function public.receive_purchase_order(bigint, jsonb) rename to receive_purchase_order_impl;
revoke all on function public.receive_purchase_order_impl(bigint, jsonb) from public, anon, authenticated;
create function public.receive_purchase_order(p_user_id bigint, p_lines jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  perform app.assert_admin();
  perform app.assert_self(p_user_id);
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      if not app.order_in_store((l->>'order_id')::bigint) then
        raise exception '같은 매장의 발주가 아닙니다.' using errcode = '42501';
      end if;
    end loop;
  end if;
  return public.receive_purchase_order_impl(p_user_id, p_lines);
end $$;

-- 6 기간 마감·보정(개발용 버튼과 스케줄러 공용): 점주(또는 스케줄러)
alter function public.run_period_close(date) rename to run_period_close_impl;
revoke all on function public.run_period_close_impl(date) from public, anon, authenticated;
create function public.run_period_close(p_period_start date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_owner_or_system();
  return public.run_period_close_impl(p_period_start);
end $$;

-- 3-1 출근·퇴근: 본인만
alter function public.clock_in(bigint) rename to clock_in_impl;
revoke all on function public.clock_in_impl(bigint) from public, anon, authenticated;
create function public.clock_in(p_user_id bigint)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_self(p_user_id);
  return public.clock_in_impl(p_user_id);
end $$;

alter function public.clock_out(bigint) rename to clock_out_impl;
revoke all on function public.clock_out_impl(bigint) from public, anon, authenticated;
create function public.clock_out(p_user_id bigint)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_self(p_user_id);
  return public.clock_out_impl(p_user_id);
end $$;

-- ---------------------------------------------------------------------
-- 3. 3~4단계 스케줄 함수 래퍼 (팀원 작성 함수 — 원본은 그대로 두고 권한만 덧씌운다)
-- ---------------------------------------------------------------------
-- 내부 계산용(다른 함수 안에서만 호출)
revoke all on function public.availability_of(bigint) from public, anon, authenticated;

-- 2-1 가능시간 조회: 본인, 또는 같은 매장의 점주·매니저
alter function public.get_availability(bigint) rename to get_availability_impl;
revoke all on function public.get_availability_impl(bigint) from public, anon, authenticated;
create function public.get_availability(p_user_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_user_id is distinct from app.my_user_id() and not (app.is_admin() and app.user_in_store(p_user_id)) then
    raise exception '볼 수 없는 가능시간입니다.' using errcode = '42501';
  end if;
  return public.get_availability_impl(p_user_id);
end $$;

-- 2-1 가능시간 제출: 본인만
alter function public.save_availability(bigint, jsonb, numeric) rename to save_availability_impl;
revoke all on function public.save_availability_impl(bigint, jsonb, numeric) from public, anon, authenticated;
create function public.save_availability(p_user_id bigint, p_ranges jsonb, p_max_weekly_hours numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_self(p_user_id);
  return public.save_availability_impl(p_user_id, p_ranges, p_max_weekly_hours);
end $$;

-- 2-3 ~ 2-6 스케줄 조회: 같은 매장만. 점주·매니저는 전부, 그 외(알바생)는 '확정' 스케줄만(직원 가능시간 목록은 비워서 준다)
alter function public.get_schedule(bigint, date, jsonb) rename to get_schedule_impl;
revoke all on function public.get_schedule_impl(bigint, date, jsonb) from public, anon, authenticated;
create function public.get_schedule(
  p_store_id bigint, p_target_week date,
  p_shifts jsonb default '[{"id": "am", "end": 12, "start": 8}, {"id": "mid", "end": 17, "start": 12}, {"id": "pm", "end": 22, "start": 17}]'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if p_store_id is distinct from app.my_store_id() then
    raise exception '다른 매장의 스케줄은 볼 수 없습니다.' using errcode = '42501';
  end if;
  r := public.get_schedule_impl(p_store_id, p_target_week, p_shifts);
  if r is not null and not app.is_admin() then
    if r->>'status' is distinct from '확정' then return null; end if;
    r := jsonb_set(r, '{staff}', '[]'::jsonb);
  end if;
  return r;
end $$;

-- 2-3 초안 자동 생성: 점주만, 같은 매장
alter function public.generate_schedule_draft(bigint, date, jsonb) rename to generate_schedule_draft_impl;
revoke all on function public.generate_schedule_draft_impl(bigint, date, jsonb) from public, anon, authenticated;
create function public.generate_schedule_draft(
  p_store_id bigint, p_target_week date,
  p_shifts jsonb default '[{"id": "am", "end": 12, "start": 8}, {"id": "mid", "end": 17, "start": 12}, {"id": "pm", "end": 22, "start": 17}]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform app.assert_owner();
  if p_store_id is distinct from app.my_store_id() then
    raise exception '다른 매장의 스케줄은 만들 수 없습니다.' using errcode = '42501';
  end if;
  return public.generate_schedule_draft_impl(p_store_id, p_target_week, p_shifts);
end $$;

-- ---------------------------------------------------------------------
-- 4. 래퍼 실행 권한: anon·PUBLIC 회수, authenticated 만 허용
-- ---------------------------------------------------------------------
revoke all on function
  public.record_stock_adjustment(bigint, text, numeric, bigint, text), public.submit_shortage_report(bigint, bigint, text, text),
  public.resolve_shortage_report(bigint), public.mark_notifications_read(bigint), public.calculate_order_recommendations(date),
  public.place_purchase_order(bigint, jsonb), public.receive_purchase_order(bigint, jsonb), public.run_period_close(date),
  public.clock_in(bigint), public.clock_out(bigint), public.get_availability(bigint), public.save_availability(bigint, jsonb, numeric),
  public.get_schedule(bigint, date, jsonb), public.generate_schedule_draft(bigint, date, jsonb)
  from public, anon;
grant execute on function
  public.record_stock_adjustment(bigint, text, numeric, bigint, text), public.submit_shortage_report(bigint, bigint, text, text),
  public.resolve_shortage_report(bigint), public.mark_notifications_read(bigint), public.calculate_order_recommendations(date),
  public.place_purchase_order(bigint, jsonb), public.receive_purchase_order(bigint, jsonb), public.run_period_close(date),
  public.clock_in(bigint), public.clock_out(bigint), public.get_availability(bigint), public.save_availability(bigint, jsonb, numeric),
  public.get_schedule(bigint, date, jsonb), public.generate_schedule_draft(bigint, date, jsonb)
  to authenticated;

-- 트리거 함수는 직접 호출 대상이 아니다(트리거는 실행 권한 없이도 동작한다)
revoke all on function public.block_publish_with_warning(), public.notify_schedule_status() from public, anon, authenticated;

-- 안전망: public 스키마의 어떤 함수도 비로그인(anon)은 실행하지 못한다
revoke execute on all functions in schema public from anon;

-- ---------------------------------------------------------------------
-- 5. 개발용 임시 정책 제거 (내 것 + 팀원 A 의 임시 anon 정책)
-- ---------------------------------------------------------------------
drop policy if exists "dev anon read shortage_report"     on shortage_report;
drop policy if exists "dev anon read notification"        on notification;
drop policy if exists "dev anon read user_account basic"  on user_account;
drop policy if exists "dev anon read forecast_error"      on forecast_error;
drop policy if exists "dev anon read attendance"          on attendance;
drop policy if exists "dev anon read payroll"             on payroll;
drop policy if exists "dev anon read shift_assignment"    on shift_assignment;
drop policy if exists "dev anon read work_schedule"       on work_schedule;
revoke select (hourly_wage) on user_account from anon;

drop policy if exists "anon read work_schedule (임시)"     on work_schedule;
drop policy if exists "anon insert work_schedule (임시)"   on work_schedule;
drop policy if exists "anon update work_schedule (임시)"   on work_schedule;
drop policy if exists "anon read shift_assignment (임시)"  on shift_assignment;
drop policy if exists "anon insert shift_assignment (임시)" on shift_assignment;
drop policy if exists "anon update shift_assignment (임시)" on shift_assignment;
drop policy if exists "anon delete shift_assignment (임시)" on shift_assignment;

-- ---------------------------------------------------------------------
-- 6. 직접 쓰기 정책 축소 (0단계 RLS 의 일부) — 위 함수들이 이 쓰기를 대신하므로 우회 경로를 닫는다
--   · 출퇴근을 본인이 직접 고치면 근무시간·급여를 조작할 수 있다  → clock_in / clock_out 함수로만
--   · 재고·재고 변동을 직접 쓰면 변동 기록(오차 집계의 근거)과 어긋난다 → 재고 함수·트리거로만
--   · 알림을 아무나 만들 수 있으면 스팸이 된다                       → 알림은 서버 함수·트리거만 만든다
--   · 부족 신고·입고를 직접 쓰면 알림·재고 반영 규칙을 건너뛴다       → submit_shortage_report / receive_purchase_order 로만
-- 점주(owner)의 전체 쓰기 정책과 읽기 정책은 그대로 둔다.
-- ---------------------------------------------------------------------
drop policy if exists "self insert attendance"       on attendance;
drop policy if exists "self update attendance"       on attendance;
drop policy if exists "admin write inventory"        on inventory;
drop policy if exists "admin write inventory_change" on inventory_change;
drop policy if exists "member insert notification"   on notification;
drop policy if exists "self insert shortage_report"  on shortage_report;
drop policy if exists "admin update shortage_report" on shortage_report;
drop policy if exists "manager update purchase_order" on purchase_order;
drop policy if exists "admin insert receipt"         on receipt;
