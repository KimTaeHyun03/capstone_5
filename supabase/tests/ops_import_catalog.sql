-- 재료·메뉴·레시피 CSV 일괄 등록(ops_import_catalog) 검증 — 끝에 rollback 하므로 데이터가 남지 않는다.
-- 기대 1) 재료 → 메뉴 → 레시피 순으로 등록되고, 재료마다 재고 0 항목이 생기며, 레시피를 넣으면 메뉴 원가가 계산된다
-- 기대 2) 같은 이름(대소문자·공백 무시)을 다시 올리면 새로 만들지 않고 수정한다. 레시피는 CSV 에 나온 메뉴만 통째로 바꾼다
-- 기대 3) 한 행이라도 틀리면 전부 취소된다(행 번호 안내). 알 수 없는 이름·중복 재료·잘못된 소요량은 거부
-- 기대 4) 점주가 아니면 거부, 다른 매장 데이터는 건드리지 않는다
begin;

do $$
declare
  v_auth uuid := gen_random_uuid(); v_auth_mgr uuid := gen_random_uuid(); v_auth_b uuid := gen_random_uuid();
  v_store bigint; v_store_b bigint; r jsonb; v_msg text;
begin
  insert into auth.users (id, email, email_confirmed_at) values (v_auth, 'cat-owner@example.invalid', now()), (v_auth_mgr, 'cat-mgr@example.invalid', now()), (v_auth_b, 'cat-owner-b@example.invalid', now());
  insert into store (store_name) values ('카탈로그 테스트') returning store_id into v_store;
  insert into store (store_name) values ('카탈로그 다른 매장') returning store_id into v_store_b;
  insert into user_account (store_id, login_id, password_hash, name, role, status, auth_user_id) values
    (v_store, 'cat-owner', 'x', '점주', '점주', '활성', v_auth),
    (v_store, 'cat-mgr', 'x', '매니저', '매니저', '활성', v_auth_mgr),
    (v_store_b, 'cat-owner-b', 'x', '점주B', '점주', '활성', v_auth_b);

  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);

  r := ops_import_catalog('ingredient', '[
    {"name":"원두","unit":"kg","price":28000,"min":5,"orderUnit":1,"orderLabel":"kg","supplier":"빈하우스"},
    {"name":"우유","unit":"L","price":2400,"min":20,"orderUnit":12,"orderLabel":"박스"}]'::jsonb);
  assert (r->>'created')::int = 2 and (r->>'updated')::int = 0, '재료 2건 생성: ' || r::text;
  assert (select count(*) from inventory i join ingredient g using (ingredient_id) where g.store_id = v_store and i.current_qty = 0) = 2, '재고 0 항목 2건';

  r := ops_import_catalog('menu', '[
    {"name":"아메리카노","category":"커피","price":4500,"onSale":true},
    {"name":"카페라떼","category":"커피","price":5000,"onSale":true}]'::jsonb);
  assert (r->>'created')::int = 2, '메뉴 2건 생성';

  r := ops_import_catalog('recipe', '[
    {"menu":"아메리카노","ingredient":"원두","qty":0.018},
    {"menu":"카페라떼","ingredient":"원두","qty":0.018},
    {"menu":"카페라떼","ingredient":"우유","qty":0.2}]'::jsonb);
  assert (r->>'updated')::int = 2, '레시피 메뉴 2개: ' || r::text;
  assert (select count(*) from recipe rc join menu m using (menu_id) where m.store_id = v_store) = 3, '레시피 행 3건';
  assert (select cost from menu where store_id = v_store and menu_name = '카페라떼') > 0, '메뉴 원가 계산됨';

  -- 같은 이름은 수정
  r := ops_import_catalog('ingredient', '[{"name":" 원두 ","unit":"kg","price":30000,"min":6,"orderUnit":1}]'::jsonb);
  assert (r->>'created')::int = 0 and (r->>'updated')::int = 1, '같은 이름은 수정: ' || r::text;
  assert (select count(*) from ingredient where store_id = v_store) = 2 and (select unit_price from ingredient where store_id = v_store and ingredient_name = '원두') = 30000, '재료 수정 반영';

  -- 레시피는 CSV 에 나온 메뉴만 바꾼다
  r := ops_import_catalog('recipe', '[{"menu":"카페라떼","ingredient":"우유","qty":0.25}]'::jsonb);
  assert (select count(*) from recipe rc join menu m using (menu_id) where m.store_id = v_store and m.menu_name = '카페라떼') = 1, '카페라떼 레시피 통째로 교체';
  assert (select count(*) from recipe rc join menu m using (menu_id) where m.store_id = v_store and m.menu_name = '아메리카노') = 1, '아메리카노 레시피 유지';

  -- 전부 취소
  begin
    perform ops_import_catalog('menu', '[{"name":"새메뉴","category":"x","price":1000,"onSale":true},{"name":"","price":1,"onSale":true}]'::jsonb);
    raise exception '잘못된 행이 허용됨';
  exception when others then
    if sqlerrm like '%허용됨' then raise; end if;
    v_msg := sqlerrm;
  end;
  assert v_msg like '2행:%', '행 번호 안내: ' || coalesce(v_msg, 'null');
  assert not exists (select 1 from menu where store_id = v_store and menu_name = '새메뉴'), '앞 행도 취소되어야 함';

  begin
    perform ops_import_catalog('recipe', '[{"menu":"없는메뉴","ingredient":"원두","qty":1}]'::jsonb);
    raise exception '없는 메뉴 허용됨';
  exception when others then
    if sqlerrm like '%허용됨' then raise; end if;
    v_msg := sqlerrm;
  end;
  assert v_msg like '1행: 메뉴%', '없는 메뉴 안내: ' || v_msg;

  begin
    perform ops_import_catalog('recipe', '[{"menu":"아메리카노","ingredient":"없는재료","qty":1}]'::jsonb);
    raise exception '없는 재료 허용됨';
  exception when others then
    if sqlerrm like '%허용됨' then raise; end if;
    v_msg := sqlerrm;
  end;
  assert v_msg like '1행: 재료%', '없는 재료 안내: ' || v_msg;

  begin
    perform ops_import_catalog('recipe', '[{"menu":"아메리카노","ingredient":"원두","qty":0}]'::jsonb);
    raise exception '소요량 0 허용됨';
  exception when others then
    if sqlerrm like '%허용됨' then raise; end if;
    v_msg := sqlerrm;
  end;
  assert v_msg like '1행: 소요량%', '소요량 안내: ' || v_msg;

  begin
    perform ops_import_catalog('recipe', '[{"menu":"아메리카노","ingredient":"원두","qty":1},{"menu":"아메리카노","ingredient":"원두","qty":2}]'::jsonb);
    raise exception '중복 재료 허용됨';
  exception when others then
    if sqlerrm like '%허용됨' then raise; end if;
    v_msg := sqlerrm;
  end;
  assert v_msg like '2행: 같은 메뉴에 같은 재료%', '중복 재료 안내: ' || v_msg;
  assert (select count(*) from recipe rc join menu m using (menu_id) where m.store_id = v_store and m.menu_name = '아메리카노') = 1, '실패한 요청이 기존 레시피를 지우면 안 됨';

  -- 매니저는 거부
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth_mgr, 'role', 'authenticated')::text, true);
  begin
    perform ops_import_catalog('menu', '[{"name":"몰래","price":1,"onSale":true}]'::jsonb);
    raise exception '매니저 허용됨';
  exception when others then
    if sqlerrm like '%허용됨' then raise; end if;
  end;

  -- 다른 매장 점주가 올려도 첫 매장은 그대로
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth_b, 'role', 'authenticated')::text, true);
  r := ops_import_catalog('menu', '[{"name":"아메리카노","category":"커피","price":9999,"onSale":true}]'::jsonb);
  assert (r->>'created')::int = 1, '다른 매장은 같은 이름이라도 새로 생성';
  assert (select price from menu where store_id = v_store and menu_name = '아메리카노') = 4500, '첫 매장 메뉴는 그대로';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'ops_import_catalog: PASS';
end $$;

rollback;
