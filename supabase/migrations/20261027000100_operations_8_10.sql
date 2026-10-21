-- 8 판매 / 9 가능시간 현황 / 10 기초 정보. 기존 22개 테이블만 사용.
-- ⚠️ 원격 DB 미적용. 적용 절차(점주 계정 연결, Edge Function 배포 포함)는 저장소 루트의 8-10단계_DB반영_안내.md 참고.
-- 모든 앱 접근은 auth.uid()를 검증하는 RPC를 통한다. 직접 쓰기는 허용하지 않는다.
begin;
-- 0단계 인증 마이그레이션(20261026000300_auth_rls.sql)이 먼저 같은 컬럼을 만들 수 있어 중복 적용에 안전하게 둔다.
alter table public.user_account add column if not exists auth_user_id uuid unique references auth.users(id);
alter table public.user_account add column email text;
alter table public.user_account alter column password_hash drop not null;
create unique index user_account_email_unique on public.user_account(lower(email)) where email is not null;
alter table public.ingredient add column supplier varchar(100);
alter table public.availability add column target_week date;
alter table public.availability add column is_unavailable boolean not null default false;
-- 기존 가능시간은 주차 정보가 없으므로 미지정으로 보존. 새 주차에 자동 복사하지 않는다.
alter table public.user_account add column availability_week date;
alter table public.availability add constraint availability_valid check(day_of_week between 0 and 6 and ((not is_unavailable and start_time < end_time) or (is_unavailable and day_of_week=0 and start_time='00:00' and end_time='00:00')));
alter table public.menu add constraint menu_price_valid check(price >= 0);
alter table public.recipe add constraint recipe_qty_valid check(qty_per_menu > 0);
alter table public.sale add constraint sale_values_valid check(quantity > 0 and amount >= 0);
create index sale_payment_menu_idx on public.sale(payment_no, menu_id);
create index availability_week_idx on public.availability(target_week, user_id);

-- 시드가 명시적으로 PK를 삽입한 후에도 신규 CRUD의 identity 충돌 방지.
do $$ declare t text; c text; v bigint; begin
  for t,c in select * from (values ('user_account','user_id'),('menu','menu_id'),('ingredient','ingredient_id'),('recipe','recipe_id'),('sale','sale_id'),('sales_summary','summary_id'),('inventory','inventory_id'),('availability','availability_id'),('notification','notification_id')) as ids(t,c)
  loop execute format('select max(%I) from public.%I',c,t) into v;
    perform setval(pg_get_serial_sequence('public.'||t,c),greatest(coalesce(v,1),1),v is not null);
  end loop;
end $$;

-- 0단계의 임시 공개 읽기 정책 제거. 서비스 키는 서버/관리자만 사용한다.
do $$ declare p record; begin
  for p in select tablename,policyname from pg_policies where schemaname='public' and policyname like 'anon read %'
  loop execute format('drop policy %I on public.%I',p.policyname,p.tablename); end loop;
end $$;

create function public.ops_actor() returns public.user_account
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor public.user_account;
begin
  select * into actor from public.user_account where auth_user_id=auth.uid() and status='활성';
  if actor.user_id is null then raise exception '활성 매장 계정과 연결된 로그인이 필요합니다.' using errcode='42501'; end if;
  return actor;
end $$;
revoke all on function public.ops_actor() from public, anon, authenticated;

create function public.ops_snapshot(p_week date, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.user_account := public.ops_actor(); result jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to-p_from>93 then raise exception '조회 기간은 1~94일이어야 합니다.'; end if;
  select jsonb_build_object(
    'profile', jsonb_build_object('id',a.user_id,'name',a.name,'role',a.role,'store_id',a.store_id),
    'store',(select to_jsonb(s) from public.store s where s.store_id=a.store_id),
    'staff',coalesce((select jsonb_agg(jsonb_build_object('id',u.user_id,'name',u.name,'role',u.role,'wage',u.hourly_wage,'maxHours',u.max_weekly_hours,'phone',u.phone,'email',u.email,'status',u.status,'availability_week',u.availability_week,'linked',u.auth_user_id is not null,'avail','{}'::jsonb) order by u.user_id) from public.user_account u where u.store_id=a.store_id and (a.role in ('점주','매니저') or u.user_id=a.user_id)),'[]'),
    'menus',coalesce((select jsonb_agg(jsonb_build_object('id',m.menu_id,'name',m.menu_name,'category',m.category,'price',m.price,'onSale',m.is_on_sale,'sold',0)) from public.menu m where m.store_id=a.store_id),'[]'),
    'ingredients',coalesce((select jsonb_agg(jsonb_build_object('id',i.ingredient_id,'name',i.ingredient_name,'unit',i.use_unit,'orderLabel',i.order_unit,'orderUnit',i.conversion_rate,'price',i.unit_price,'min',i.min_stock,'supplier',i.supplier,'stock',coalesce(v.current_qty,0),'use',0,'factor',1)) from public.ingredient i left join public.inventory v using(ingredient_id) where i.store_id=a.store_id),'[]'),
    'recipes',coalesce((select jsonb_agg(jsonb_build_object('menu_id',r.menu_id,'ingredient_id',r.ingredient_id,'qty',r.qty_per_menu)) from public.recipe r join public.menu m using(menu_id) where m.store_id=a.store_id),'[]'),
    'availability',coalesce((select jsonb_agg(to_jsonb(v)) from public.availability v join public.user_account u using(user_id) where u.store_id=a.store_id and v.target_week=p_week and (a.role in ('점주','매니저') or u.user_id=a.user_id)),'[]'),
    'forecast',coalesce((select jsonb_agg(to_jsonb(f)) from public.sales_forecast f where f.store_id=a.store_id and f.target_week=p_week and a.role in ('점주','매니저')),'[]'),
    'sales',coalesce((select jsonb_agg(to_jsonb(s) order by s.sold_at desc,s.sale_id desc) from public.sale s join public.menu m using(menu_id) where m.store_id=a.store_id and a.role='점주' and (s.sold_at at time zone 'Asia/Seoul')::date between p_from and p_to),'[]'),
    'summary',coalesce((select jsonb_agg(to_jsonb(s) order by s.base_date,s.time_slot) from public.sales_summary s where s.store_id=a.store_id and a.role='점주' and s.base_date between p_from and p_to),'[]')
  ) into result;
  return result;
end $$;

-- 동일 매장의 판매 수집은 직렬화한다. CSV 전체 검증/저장/집계가 한 트랜잭션이다.
create function public.ops_import_sales(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.user_account := public.ops_actor(); r record; total integer:=0; local_time timestamp; seen boolean;
begin
  if a.role <> '점주' then raise exception '점주만 판매를 기록할 수 있습니다.' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception '1~1000행을 입력하세요.'; end if;
  perform pg_advisory_xact_lock(a.store_id);
  for r in select * from jsonb_to_recordset(p_rows) as x(payment_no text, menu_id bigint, sold_at timestamptz, quantity integer, amount integer)
  loop
    if r.payment_no is null or length(btrim(r.payment_no)) not between 1 and 30 or r.quantity is null or r.quantity<=0 or r.amount is null or r.amount<0 or r.sold_at is null or r.sold_at>now() then raise exception '판매 입력값이 올바르지 않습니다.'; end if;
    if not exists(select 1 from public.menu where menu_id=r.menu_id and store_id=a.store_id and is_on_sale) then raise exception '판매 가능한 같은 매장 메뉴가 아닙니다.'; end if;
    if exists(select 1 from public.sale s join public.menu m using(menu_id) where m.store_id=a.store_id and s.payment_no=r.payment_no and (s.menu_id=r.menu_id or s.sold_at<>r.sold_at)) then raise exception '이미 등록된 결제·메뉴 또는 일시가 다른 결제번호입니다: %',r.payment_no; end if;
    select exists(select 1 from public.sale s join public.menu m using(menu_id) where m.store_id=a.store_id and s.payment_no=r.payment_no) into seen;
    insert into public.sale(payment_no,menu_id,sold_at,quantity,amount) values(r.payment_no,r.menu_id,r.sold_at,r.quantity,r.amount);
    local_time := r.sold_at at time zone 'Asia/Seoul';
    insert into public.sales_summary(store_id,base_date,day_of_week,time_slot,sales_amount,order_count,is_confirmed)
      values(a.store_id,local_time::date,extract(isodow from local_time)::integer-1,extract(hour from local_time)::integer,r.amount,case when seen then 0 else 1 end,false)
      on conflict(store_id,base_date,time_slot) do update set sales_amount=sales_summary.sales_amount+excluded.sales_amount,order_count=sales_summary.order_count+excluded.order_count;
    total:=total+1;
  end loop;
  return total;
end $$;

-- 레시피 전체 교체는 한 트랜잭션으로 처리하고 다른 매장 ID를 거부한다.
create function public.ops_save(p_kind text, p_data jsonb, p_delete boolean default false) returns bigint
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
      if exists(select 1 from public.user_account where user_id=id and auth_user_id is not null) then raise exception '연결된 로그인 계정은 비활성으로 변경하세요.'; end if;
      delete from public.availability where user_id=id;
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

create function public.ops_availability(p_week date,p_rows jsonb,p_max numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.user_account := public.ops_actor(); r record;
begin
  if a.role not in ('알바생','매니저') then raise exception '직원만 본인 가능시간을 제출할 수 있습니다.'; end if;
  if p_week is null or extract(isodow from p_week)<>1 or p_max is null or p_max not between 0 and 168 or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>21 then raise exception '주차/근무시간을 확인하세요.'; end if;
  perform 1 from public.user_account where user_id=a.user_id for update;
  delete from public.availability where user_id=a.user_id and target_week=p_week;
  if jsonb_array_length(p_rows)=0 then
    insert into public.availability(user_id,day_of_week,start_time,end_time,registered_at,target_week,is_unavailable) values(a.user_id,0,'00:00','00:00',now(),p_week,true);
  end if;
  for r in select * from jsonb_to_recordset(p_rows) as x(day_of_week smallint,start_time time,end_time time)
  loop insert into public.availability(user_id,day_of_week,start_time,end_time,registered_at,target_week) values(a.user_id,r.day_of_week,r.start_time,r.end_time,now(),p_week); end loop;
  update public.user_account set max_weekly_hours=p_max,availability_week=p_week where user_id=a.user_id;
end $$;

revoke all on function public.ops_snapshot(date,date,date), public.ops_import_sales(jsonb), public.ops_save(text,jsonb,boolean), public.ops_availability(date,jsonb,numeric) from public,anon;
grant execute on function public.ops_snapshot(date,date,date), public.ops_import_sales(jsonb), public.ops_save(text,jsonb,boolean), public.ops_availability(date,jsonb,numeric) to authenticated;
commit;
