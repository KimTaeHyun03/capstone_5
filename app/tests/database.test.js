import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('PostgreSQL migration, store isolation, CRUD, sales rollback and availability',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for(const name of ['20261014000000_init_22_tables.sql','20261021000000_operations_8_10.sql'])await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
    const query=(sql,params=[])=>db.query(sql,params);
    await db.exec(`insert into store(store_id,store_name) values(1,'A'),(2,'B');
      insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
      insert into user_account(store_id,login_id,name,role,status,auth_user_id) values
      (1,'owner-a','A','점주','활성','00000000-0000-0000-0000-000000000001'),
      (2,'owner-b','B','점주','활성','00000000-0000-0000-0000-000000000002'),
      (1,'staff-a','S','알바생','활성','00000000-0000-0000-0000-000000000003');`);
    const login=async n=>{await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000${n}',false);`);};
    const save=async(kind,item,del=false)=>(await query('select ops_save($1,$2::jsonb,$3) id',[kind,JSON.stringify(item),del])).rows[0].id;
    const snapshot=async()=>(await query("select ops_snapshot('2026-01-05','2026-01-01','2026-01-31') data")).rows[0].data;
    await login(1);
    const mid=await save('menu',{name:'커피',price:4500,onSale:true});
    const iid=await save('ingredient',{name:'원두',unit:'kg',orderUnit:1,price:20000,min:2});
    await save('recipe',{id:mid,lines:[{ingredient_id:iid,qty:0.02}]});
    let snap=await snapshot();assert.equal(snap.ingredients[0].stock,0);assert.equal(snap.recipes.length,1);
    await assert.rejects(()=>save('ingredient',{id:iid},true));
    assert.equal((await snapshot()).ingredients.length,1);
    await login(2);
    assert.equal((await snapshot()).menus.length,0);
    await assert.rejects(()=>save('menu',{id:mid,name:'x',price:0,onSale:true}),/메뉴/);
    const foreign=await save('ingredient',{name:'B원두',unit:'kg',orderUnit:1,price:100,min:0});
    await login(1);
    await assert.rejects(()=>save('recipe',{id:mid,lines:[{ingredient_id:foreign,qty:1}]}),/재료/);
    assert.equal((await snapshot()).recipes.length,1,'failed recipe replacement rolls back deletion');
    const mid2=await save('menu',{name:'라떼',price:5000,onSale:true});
    const row={payment_no:'P1',menu_id:mid,sold_at:'2026-01-05T09:00:00+09:00',quantity:1,amount:4500};
    const sales=rows=>query('select ops_import_sales($1::jsonb)',[JSON.stringify(rows)]);
    await sales([row,{...row,menu_id:mid2,amount:5000}]);
    snap=await snapshot();assert.equal(snap.summary[0].sales_amount,9500);assert.equal(snap.summary[0].order_count,1);
    await assert.rejects(()=>sales([{...row,payment_no:'P2'},row]),/이미 등록/);
    assert.equal((await snapshot()).sales.length,2,'whole batch rolls back');
    await assert.rejects(()=>save('menu',{id:mid},true));assert.equal((await snapshot()).recipes.length,1);
    await login(3);
    await assert.rejects(()=>sales([{...row,payment_no:'P3'}]),/점주/);
    await assert.rejects(()=>save('menu',{name:'bad',price:1,onSale:true}),/점주/);
    await query("select ops_availability('2026-01-05',$1::jsonb,20)",[JSON.stringify([{day_of_week:0,start_time:'08:00',end_time:'12:00'}])]);
    snap=await snapshot();assert.equal(snap.staff.length,1);assert.equal(snap.availability.length,1);assert.equal(snap.sales.length,0);
    await query("select ops_availability('2026-01-05','[]',0)");
    snap=await snapshot();assert.equal(snap.availability.length,1);assert.equal(snap.availability[0].is_unavailable,true);assert.equal(snap.staff[0].availability_week,'2026-01-05');
    await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(snapshot,/permission denied/);
    await db.exec('reset role');
    assert.equal((await query("select count(*)::integer n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")).rows[0].n,22);
  } finally {await db.close();}
});
