-- 7-2·7-3·7-4 CSV 일괄 등록: 재료 / 메뉴 / 레시피를 한 번에 등록한다(한 트랜잭션: 한 행이라도 틀리면 전부 취소).
-- 행마다 기존 ops_save 를 그대로 부르므로 검증, 재고 항목 생성(7-E2), 메뉴 원가 계산(7-E3)이 같은 규칙으로 동작한다.
--  - 재료·메뉴: 같은 이름(대소문자 무시)이 이미 있으면 그 항목을 수정하고, 없으면 새로 만든다. 재료는 재고 0 으로 시작한다.
--  - 레시피: CSV 에 나온 메뉴의 레시피를 통째로 바꾼다(CSV 에 없는 메뉴는 그대로). 재료·메뉴 이름은 이미 등록돼 있어야 한다.
-- 테이블은 추가하지 않는다(22개 유지). 점주만 실행할 수 있다.
--
-- p_kind = 'ingredient'  p_rows = [{ name, unit, price, min, orderUnit, orderLabel?, supplier? }]
-- p_kind = 'menu'        p_rows = [{ name, category?, price, onSale }]
-- p_kind = 'recipe'      p_rows = [{ menu, ingredient, qty }]
-- 반환: { created, updated }  (레시피는 { updated: 메뉴 수 })
create function public.ops_import_catalog(p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.user_account := public.ops_actor();
  r record;
  existing bigint;
  created integer := 0;
  updated integer := 0;
  mid bigint;
  iid bigint;
  acc jsonb := '{}'::jsonb;
  k text;
  qty numeric;
begin
  if a.role <> '점주' then raise exception '점주만 기초 정보를 변경할 수 있습니다.' using errcode = '42501'; end if;
  if p_kind not in ('ingredient', 'menu', 'recipe') then raise exception '지원하지 않는 종류입니다: %', p_kind; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception '한 번에 1~500행을 등록하세요.';
  end if;

  if p_kind in ('ingredient', 'menu') then
    for r in select value as v, ordinality as n from jsonb_array_elements(p_rows) with ordinality loop
      begin
        if p_kind = 'menu' then
          select menu_id into existing from public.menu where store_id = a.store_id and lower(menu_name) = lower(btrim(r.v->>'name'));
        else
          select ingredient_id into existing from public.ingredient where store_id = a.store_id and lower(ingredient_name) = lower(btrim(r.v->>'name'));
        end if;
        perform public.ops_save(p_kind, case when existing is null then r.v else r.v || jsonb_build_object('id', existing) end);
        if existing is null then created := created + 1; else updated := updated + 1; end if;
      exception when others then
        raise exception '%행: %', r.n, sqlerrm using errcode = sqlstate;
      end;
    end loop;
    return jsonb_build_object('created', created, 'updated', updated);
  end if;

  -- 레시피: 1) 행마다 메뉴·재료 이름을 찾아 메뉴별로 모은다  2) 메뉴마다 레시피를 통째로 바꾼다
  for r in select value as v, ordinality as n from jsonb_array_elements(p_rows) with ordinality loop
    select menu_id into mid from public.menu where store_id = a.store_id and lower(menu_name) = lower(btrim(r.v->>'menu'));
    if mid is null then raise exception '%행: 메뉴 "%"을(를) 찾을 수 없습니다. 메뉴를 먼저 등록하세요.', r.n, r.v->>'menu'; end if;
    select ingredient_id into iid from public.ingredient where store_id = a.store_id and lower(ingredient_name) = lower(btrim(r.v->>'ingredient'));
    if iid is null then raise exception '%행: 재료 "%"을(를) 찾을 수 없습니다. 재료를 먼저 등록하세요.', r.n, r.v->>'ingredient'; end if;
    begin qty := (r.v->>'qty')::numeric; exception when others then qty := null; end;
    if qty is null or qty <= 0 then raise exception '%행: 소요량은 0보다 큰 숫자여야 합니다.', r.n; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(acc->(mid::text), '[]'::jsonb)) l where (l->>'ingredient_id')::bigint = iid) then
      raise exception '%행: 같은 메뉴에 같은 재료("%")가 두 번 있습니다.', r.n, r.v->>'ingredient';
    end if;
    acc := jsonb_set(acc, array[mid::text], coalesce(acc->(mid::text), '[]'::jsonb) || jsonb_build_array(jsonb_build_object('ingredient_id', iid, 'qty', qty)), true);
  end loop;

  for k in select jsonb_object_keys(acc) loop
    perform public.ops_save('recipe', jsonb_build_object('id', k::bigint, 'lines', acc->k));
    updated := updated + 1;
  end loop;
  return jsonb_build_object('updated', updated);
end $$;

comment on function public.ops_import_catalog(text, jsonb) is '7-2·7-3·7-4 CSV 일괄 등록(재료·메뉴·레시피). 한 트랜잭션, 점주만';
revoke all on function public.ops_import_catalog(text, jsonb) from public, anon;
grant execute on function public.ops_import_catalog(text, jsonb) to authenticated;
