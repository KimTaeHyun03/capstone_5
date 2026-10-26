-- 점주 온보딩(register_store) 검증 — 끝에 rollback 하므로 데이터가 남지 않는다.
-- 기대 1) 가입만 한 사용자가 매장을 만들면 store 1건 + 점주 user_account 1건(auth 연결)이 생기고, 그 계정으로 매장 범위가 잡힌다
-- 기대 2) 같은 계정으로 다시 만들 수 없다 / 로그인 안 한 호출은 거부 / 잘못된 입력은 거부
-- 기대 3) 직원으로 이미 등록된 이메일로 가입한 사용자는 매장을 만들 수 없다
begin;

do $$
declare
  v_auth uuid := gen_random_uuid();
  v_auth2 uuid := gen_random_uuid();
  v_store bigint;
  v_n int;
begin
  insert into auth.users (id, email, email_confirmed_at) values (v_auth, 'New-Owner@Example.invalid', now());
  insert into auth.users (id, email, email_confirmed_at) values (v_auth2, 'pre-staff@example.invalid', now());

  -- 로그인 안 한 호출
  perform set_config('request.jwt.claims', '', true);
  begin
    perform register_store('아무 매장', '아무개');
    raise exception '로그인 없이 성공하면 안 됨';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  begin perform register_store('', '점주'); raise exception '빈 매장 이름 허용됨'; exception when others then if sqlerrm like '%허용됨' then raise; end if; end;
  begin perform register_store('매장', '점주', null, null, '22:00', '08:00'); raise exception '영업시간 역전 허용됨'; exception when others then if sqlerrm like '%허용됨' then raise; end if; end;

  v_store := register_store('  새 카페  ', '새점주', '서울 어딘가 1', '02-111-2222', '09:00', '21:00');
  assert (select store_name from store where store_id = v_store) = '새 카페', '공백 제거된 매장 이름';
  assert (select open_time::text from store where store_id = v_store) = '09:00:00', '영업 시작 시각';
  select count(*) into v_n from user_account where store_id = v_store and role = '점주' and auth_user_id = v_auth and login_id = 'new-owner@example.invalid' and status = '활성';
  assert v_n = 1, '점주 계정 1건(이메일은 소문자)';
  assert app.my_store_id() = v_store, '새 계정의 매장 범위';
  assert app.is_owner(), '점주 권한';

  begin perform register_store('또 매장', '점주'); raise exception '중복 등록 허용됨'; exception when others then if sqlerrm like '%허용됨' then raise; end if; end;
  assert (select count(*) from store where store_name = '또 매장') = 0, '중복 호출로 매장이 생기면 안 됨';

  -- 직원으로 이미 등록된 이메일
  insert into user_account (store_id, login_id, password_hash, name, role, status) values (v_store, 'pre-staff@example.invalid', null, '선등록 직원', '알바생', '활성');
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth2, 'role', 'authenticated')::text, true);
  begin perform register_store('직원이 만든 매장', '직원'); raise exception '직원 이메일로 매장 생성 허용됨'; exception when others then if sqlerrm like '%허용됨' then raise; end if; end;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'register_store: PASS';
end $$;

rollback;
