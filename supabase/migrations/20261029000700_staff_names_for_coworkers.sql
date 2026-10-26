-- 알바생이 근무표에서 "함께 근무하는 직원" 이름을 볼 수 있게 한다.
-- 지금까지는 알바생에게 staff 항목을 통째로 비워 줬다(가능시간·시급 노출 방지). 이름·역할·상태만 남기고 가능시간·시급·최대 근무시간은 내려 주지 않는다.
create or replace function public.get_schedule(
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
    r := jsonb_set(r, '{staff}', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', e->'user_id', 'name', e->'name', 'role', e->'role', 'status', e->'status'))
        from jsonb_array_elements(r->'staff') e), '[]'::jsonb));
  end if;
  return r;
end $$;
revoke all on function public.get_schedule(bigint, date, jsonb) from public, anon;
grant execute on function public.get_schedule(bigint, date, jsonb) to authenticated;
