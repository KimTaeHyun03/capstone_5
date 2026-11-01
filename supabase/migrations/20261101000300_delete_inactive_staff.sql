-- 직원 삭제 규칙 정리: '초대됨'·'비활성' 직원은 삭제할 수 있다 ('활성' 직원은 먼저 비활성으로 변경).
-- 근무 배정·출퇴근·급여 등 이력이 있으면 외래 키가 막아 삭제되지 않는다.
-- 삭제하면 연결돼 있던 로그인 계정도 함께 지워 같은 이메일로 다시 초대할 수 있다.

create or replace function public.ops_save(p_kind text, p_data jsonb, p_delete boolean default false) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.user_account := public.ops_actor(); id bigint := (p_data->>'id')::bigint; item record; mid bigint; n integer; val text;
begin
  if a.role <> '점주' then raise exception '점주만 기초 정보를 변경할 수 있습니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(a.store_id);
  if p_kind='menu' then
    if id is not null and not exists(select 1 from public.menu where menu_id=id and store_id=a.store_id) then raise exception '메뉴를 찾을 수 없습니다.'; end if;
    if p_delete then
      delete from public.recipe where menu_id=id;
      delete from public.menu where menu_id=id; -- 판매 이력이 있으면 FK가 전체 트랜잭션을 취소
      return id;
    end if;
    if coalesce(length(btrim(p_data->>'name')),0) not between 1 and 100 or (p_data->>'price')::integer<0 or p_data->>'price' is null or p_data->>'onSale' is null then raise exception '메뉴명/판매가를 확인하세요.'; end if;
    if id is null then
      insert into public.menu(store_id,menu_name,category,price,is_on_sale,recipe_status,cost,cost_rate) values(a.store_id,btrim(p_data->>'name'),p_data->>'category',(p_data->>'price')::integer,(p_data->>'onSale')::boolean,'미등록',0,0) returning menu_id into id;
    else update public.menu set menu_name=btrim(p_data->>'name'),category=p_data->>'category',price=(p_data->>'price')::integer,is_on_sale=(p_data->>'onSale')::boolean where menu_id=id; end if;
  elsif p_kind='ingredient' then
    if id is not null and not exists(select 1 from public.ingredient where ingredient_id=id and store_id=a.store_id) then raise exception '재료를 찾을 수 없습니다.'; end if;
    if p_delete then
      if exists(select 1 from public.inventory where ingredient_id=id and current_qty<>0) then raise exception '재고가 남아 있는 재료는 삭제할 수 없습니다.'; end if;
      delete from public.inventory where ingredient_id=id;
      delete from public.ingredient where ingredient_id=id; return id;
    end if;
    if coalesce(length(btrim(p_data->>'name')),0) not between 1 and 100 or coalesce(length(btrim(p_data->>'unit')),0) not between 1 and 20 or coalesce((p_data->>'price')::integer,-1)<0 or coalesce((p_data->>'min')::numeric,-1)<0 or coalesce((p_data->>'orderUnit')::numeric,0)<=0 then raise exception '재료 입력값을 확인하세요.'; end if;
    if id is not null and exists(select 1 from public.ingredient where ingredient_id=id and use_unit<>p_data->>'unit') and (exists(select 1 from public.recipe where ingredient_id=id) or exists(select 1 from public.inventory where ingredient_id=id and current_qty<>0)) then raise exception '사용 중인 재료의 단위를 변경할 수 없습니다.'; end if;
    if id is null then
      insert into public.ingredient(store_id,ingredient_name,use_unit,order_unit,conversion_rate,unit_price,min_stock,supplier) values(a.store_id,btrim(p_data->>'name'),p_data->>'unit',coalesce(nullif(p_data->>'orderLabel',''),p_data->>'unit'),(p_data->>'orderUnit')::numeric,(p_data->>'price')::integer,(p_data->>'min')::numeric,p_data->>'supplier') returning ingredient_id into id;
      insert into public.inventory(ingredient_id,current_qty,updated_at,is_short) values(id,0,now(),(p_data->>'min')::numeric>0);
    else update public.ingredient set ingredient_name=btrim(p_data->>'name'),use_unit=p_data->>'unit',order_unit=coalesce(nullif(p_data->>'orderLabel',''),p_data->>'unit'),conversion_rate=(p_data->>'orderUnit')::numeric,unit_price=(p_data->>'price')::integer,min_stock=(p_data->>'min')::numeric,supplier=p_data->>'supplier' where ingredient_id=id;
      update public.inventory set is_short=current_qty<(p_data->>'min')::numeric where ingredient_id=id;
    end if;
  elsif p_kind='recipe' then
    if not exists(select 1 from public.menu where menu_id=id and store_id=a.store_id) then raise exception '메뉴를 찾을 수 없습니다.'; end if;
    if jsonb_typeof(p_data->'lines')<>'array' then raise exception '레시피 형식을 확인하세요.'; end if;
    delete from public.recipe where menu_id=id;
    for item in select * from jsonb_to_recordset(p_data->'lines') as x(ingredient_id bigint,qty numeric)
    loop
      if item.qty is null or item.qty<=0 or not exists(select 1 from public.ingredient where ingredient_id=item.ingredient_id and store_id=a.store_id) then raise exception '재료/소요량을 확인하세요.'; end if;
      insert into public.recipe(menu_id,ingredient_id,qty_per_menu) values(id,item.ingredient_id,item.qty);
    end loop;
  elsif p_kind='staff' then
    if id is not null and not exists(select 1 from public.user_account where user_id=id and store_id=a.store_id and role<>'점주') then raise exception '직원을 찾을 수 없습니다. 점주 계정은 이 화면에서 수정할 수 없습니다.'; end if;
    if p_delete then
      if exists(select 1 from public.user_account where user_id=id and status='활성') then raise exception '활성 직원은 삭제할 수 없습니다. 먼저 비활성으로 변경하세요.'; end if;
      delete from public.availability where user_id=id;
      delete from public.notification where recipient_id=id;
      delete from public.user_account where user_id=id; return id;
    end if;
    if coalesce(length(btrim(p_data->>'name')),0) not between 1 and 50 or coalesce(p_data->>'role','') not in ('매니저','알바생') or coalesce((p_data->>'wage')::integer,-1)<0 or coalesce((p_data->>'maxHours')::numeric,-1) not between 0 and 168 or coalesce(p_data->>'status','') not in ('초대됨','활성','비활성') or coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception '직원 입력값을 확인하세요.'; end if;
    if id is null then
      insert into public.user_account(store_id,login_id,name,role,hourly_wage,max_weekly_hours,phone,status,email) values(a.store_id,'pending-'||gen_random_uuid()::text,btrim(p_data->>'name'),p_data->>'role',(p_data->>'wage')::integer,(p_data->>'maxHours')::numeric,p_data->>'phone','초대됨',lower(btrim(p_data->>'email'))) returning user_id into id;
    else
      if exists(select 1 from public.user_account where user_id=id and auth_user_id is not null and email<>lower(btrim(p_data->>'email'))) then raise exception '로그인과 연결된 이메일은 변경할 수 없습니다.'; end if;
      update public.user_account set name=btrim(p_data->>'name'),role=p_data->>'role',hourly_wage=(p_data->>'wage')::integer,max_weekly_hours=(p_data->>'maxHours')::numeric,phone=p_data->>'phone',status=p_data->>'status',email=lower(btrim(p_data->>'email')) where user_id=id;
    end if;
  elsif p_kind='store' then
    if p_delete then raise exception '매장 삭제는 지원하지 않습니다.'; end if;
    if coalesce(length(btrim(p_data->>'name')),0) not between 1 and 100 or (p_data->>'open')::time >= (p_data->>'close')::time or p_data->>'open' is null or p_data->>'close' is null then raise exception '매장명/영업시간을 확인하세요.'; end if;
    update public.store set store_name=btrim(p_data->>'name'),address=p_data->>'address',phone=p_data->>'phone',open_time=(p_data->>'open')::time,close_time=(p_data->>'close')::time where store_id=a.store_id; id:=a.store_id;
  else raise exception '지원하지 않는 작업입니다.'; end if;
  -- 7-E3: 재료 단가/레시피/판매가 변경 시 같은 트랜잭션에서 원가 재계산.
  if p_kind in ('menu','ingredient','recipe') then
    update public.menu m set cost=c.cost,cost_rate=case when m.price=0 then 0 else least(999.99,round(c.cost::numeric/m.price*100,2)) end,recipe_status=case when c.cnt=0 then '미등록' else '등록' end
    from (select mm.menu_id,coalesce(round(sum(r.qty_per_menu*i.unit_price)),0)::integer cost,count(r.recipe_id) cnt from public.menu mm left join public.recipe r using(menu_id) left join public.ingredient i using(ingredient_id) where mm.store_id=a.store_id group by mm.menu_id) c where m.menu_id=c.menu_id;
  end if;
  return id;
end $$;

create or replace function app.drop_unaccepted_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.auth_user_id is not null and old.role <> '점주' then
    delete from auth.users where id = old.auth_user_id;
  end if;
  return old;
end $$;
