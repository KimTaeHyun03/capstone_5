import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const rollback = new URL('../../supabase/handoff/rollback_local_events.sql', import.meta.url);

async function setup(upTo = '99999999999999') {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb, last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    if (f.slice(0, 14) > upTo) break;
    await db.exec(await readFile(new URL(f, dir), 'utf8'));
  }
  return db;
}

// 매장 1곳, 재료 1개(하루 소진이 일정), 직전 두 주 확정 매출(월요일 9·10시 각 10만원)
async function seed(db) {
  await db.exec(`
    insert into store (store_id, store_name, latitude, longitude) values (1, '시험 매장', 37.2636, 127.0286);
    insert into user_account (store_id, login_id, password_hash, name, role, status) values (1, 'o', 'x', '점주', '점주', '활성');
    insert into ingredient (store_id, ingredient_name, use_unit, order_unit, conversion_rate, unit_price, min_stock) values (1, '원두', 'kg', 'kg', 1, 1000, 0);
    insert into inventory (ingredient_id, current_qty, updated_at, is_short) values (1, 0, now(), false);
    insert into inventory_change (ingredient_id, change_type, change_qty, changed_at)
      select 1, '판매 차감', -10, (now() at time zone 'Asia/Seoul') - (n || ' days')::interval from generate_series(1, 14) n;
  `);
  const target = (await db.query("select date_trunc('week', (now() at time zone 'Asia/Seoul')::date + 7)::date t")).rows[0].t;
  const t = new Date(target).toISOString().slice(0, 10);
  for (const w of [14, 7]) {
    for (const h of [9, 10, 11]) {
      await db.query(
        `insert into sales_summary (store_id, base_date, day_of_week, time_slot, sales_amount, order_count, is_confirmed)
         values (1, $1::date - $2::int, 0, $3, 100000, 5, true)`, [t, w, h]);
    }
  }
  return t;
}

const slot = async (db, t, h) => (await db.query(
  'select forecast_amount, base_amount, event_uplift from sales_forecast where store_id = 1 and target_week = $1 and day_of_week = 0 and time_slot = $2', [t, h])).rows[0];
const rec = async (db) => Number((await db.query('select recommended_qty q from order_recommendation order by recommendation_id desc limit 1')).rows[0].q);

test('행사 없음: 예측·발주가 기존과 같다', async () => {
  const db = await setup();
  try {
    const t = await seed(db);
    await db.query('select app.generate_sales_forecast_for(1, $1::date)', [t]);
    assert.equal((await slot(db, t, 9)).forecast_amount, 100000);
    assert.equal((await slot(db, t, 9)).base_amount, null);
    await db.query('select calculate_order_recommendations_impl($1::date)', [t]);
    assert.ok(await rec(db) > 0);
  } finally { await db.close(); }
});

test('행사 반영: 해당 요일·시간대만 오르고 발주도 늘며, 제안·제외 상태는 무시', async () => {
  const db = await setup();
  try {
    const t = await seed(db);
    await db.query('select app.generate_sales_forecast_for(1, $1::date)', [t]);
    await db.query('select calculate_order_recommendations_impl($1::date)', [t]);
    const baseRec = await rec(db);

    // 제안 상태: 반영 안 됨
    await db.query(`insert into local_event (store_id, source, title, start_date, end_date, start_time, end_time, distance_m, scale, status)
      values (1, 'manual', '축제', $1::date, $1::date, '09:00', '11:00', 200, 'medium', '제안')`, [t]);
    await db.query('select app.generate_sales_forecast_for(1, $1::date)', [t]);
    assert.equal((await slot(db, t, 9)).forecast_amount, 100000);

    // 반영: 근접(300m 이내) medium = +20%, 09~11시만(9·10시)
    await db.query("update local_event set status = '반영'");
    await db.query('select app.generate_sales_forecast_for(1, $1::date)', [t]);
    assert.equal((await slot(db, t, 9)).forecast_amount, 120000);
    assert.equal(Number((await slot(db, t, 9)).event_uplift), 0.2);
    assert.equal((await slot(db, t, 9)).base_amount, 100000);
    assert.equal((await slot(db, t, 11)).forecast_amount, 100000, '행사 시간 밖은 그대로');

    // 발주: 한 주 예측 3칸 중 2칸이 +20% → 가중 평균 약 +13.3%
    await db.query('select calculate_order_recommendations_impl($1::date)', [t]);
    const evRec = await rec(db);
    assert.ok(evRec > baseRec, `행사 발주 ${evRec} > 기본 ${baseRec}`);
    assert.ok(Math.abs(evRec / baseRec - 1.1333) < 0.02, `비율 ${evRec / baseRec}`);
    // 계산이 끝나면 예측은 가산 후 금액으로 복원돼 있다
    assert.equal((await slot(db, t, 9)).forecast_amount, 120000);

    // 같은 계산을 한 번 더 해도 행사 가산이 이중으로 곱해지지 않는다
    await db.query('select calculate_order_recommendations_impl($1::date)', [t]);
    assert.equal(await rec(db), evRec);

    // 제외하면 원래대로
    await db.query("update local_event set status = '제외'");
    await db.query('select app.generate_sales_forecast_for(1, $1::date)', [t]);
    assert.equal((await slot(db, t, 9)).forecast_amount, 100000);
  } finally { await db.close(); }
});

test('겹치는 행사는 합산하되 상한 30%, 반경 밖은 0', async () => {
  const db = await setup();
  try {
    const t = await seed(db);
    await db.query(`insert into local_event (store_id, source, title, start_date, end_date, distance_m, scale, status) values
      (1, 'manual', 'A', $1::date, $1::date, 100, 'large', '반영'), (1, 'manual', 'B', $1::date, $1::date, 100, 'medium', '반영'),
      (1, 'manual', '먼 행사', $1::date, $1::date, 4000, 'large', '반영')`, [t]);
    await db.query('select app.generate_sales_forecast_for(1, $1::date)', [t]);
    assert.equal(Number((await slot(db, t, 9)).event_uplift), 0.3);
  } finally { await db.close(); }
});

test('행사 후 실측 비율이 기록되고 2건 쌓이면 기본표 대신 쓴다', async () => {
  const db = await setup();
  try {
    const t = await seed(db);
    await db.query(`insert into local_event (store_id, source, title, start_date, end_date, distance_m, scale, status, actual_ratio) values
      (1, 'manual', '지난1', '2020-01-01', '2020-01-01', 100, 'medium', '반영', 1.10),
      (1, 'manual', '지난2', '2020-02-01', '2020-02-01', 100, 'medium', '반영', 1.14)`);
    const r = await db.query("select app.default_uplift(1, 'medium', 100, 1000) u");
    assert.equal(Number(r.rows[0].u), 0.12);
    assert.equal(Number((await db.query("select app.default_uplift(1, 'small', 100, 1000) u")).rows[0].u), 0.1, '표본 없는 규모는 기본표');
  } finally { await db.close(); }
});

test('롤백 SQL: 원래 함수가 돌아오고 테이블·컬럼이 사라진다', async () => {
  const db = await setup();
  try {
    const t = await seed(db);
    await db.query(`insert into local_event (store_id, source, title, start_date, end_date, distance_m, scale, status) values (1, 'manual', 'A', $1::date, $1::date, 100, 'large', '반영')`, [t]);
    await db.query('select app.generate_sales_forecast_for(1, $1::date)', [t]);
    assert.equal((await slot(db, t, 9)).forecast_amount, 130000);
    await db.exec(await readFile(rollback, 'utf8'));
    assert.equal((await db.query("select to_regclass('public.local_event') r")).rows[0].r, null);
    assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name = 'sales_forecast' and column_name = 'base_amount'")).rows[0].n, 0);
    // 원래 함수로 예측이 다시 돌아가고 가산이 없다
    await db.query('select app.generate_sales_forecast_for(1, $1::date)', [t]);
    assert.equal((await db.query('select forecast_amount a from sales_forecast where store_id = 1 and target_week = $1 and day_of_week = 0 and time_slot = 9', [t])).rows[0].a, 100000);
    await db.query('select calculate_order_recommendations_impl($1::date)', [t]);
    assert.equal((await db.query("select count(*)::int n from pg_proc where proname like '%pre_events'")).rows[0].n, 0);
  } finally { await db.close(); }
});
