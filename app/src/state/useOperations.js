import { useCallback, useEffect, useRef, useState } from 'react';
import { INGREDIENTS, MENUS, RECIPES, STAFF, STORE, FORECAST, HOURS } from '../mocks/data.js';
import { addDays, monday, number, required, summarizeSales, validateSales } from '../domain/operations.js';
import { supabase } from '../lib/supabase.js';

const KEY = 'ongi-operations-v1';
const initialWeek = () => addDays(monday(), 7);
function seed() {
  const week = initialWeek();
  return {
    store: { ...STORE, open: '08:00', close: '22:00' }, menus: MENUS, ingredients: INGREDIENTS, recipes: RECIPES,
    staff: STAFF.map(s => ({ ...s, email: '', availability_week: s.status === '활성' ? week : null })), sales: [],
    availability: STAFF.filter(s => s.status === '활성').flatMap(s => Object.entries(s.avail).map(([d, range]) => ({ user_id: s.id, day_of_week: Number(d), target_week: week, start_time: `${String(range[0]).padStart(2,'0')}:00`, end_time: `${String(range[1]).padStart(2,'0')}:00` }))),
    forecast: FORECAST.flatMap((row, day) => row.map((v, i) => ({ target_week: week, day_of_week: day, time_slot: HOURS[i], required_staff: v < 50 ? 1 : v < 100 ? 2 : 3 }))),
  };
}
function loadDemo() {
  try { const saved = localStorage.getItem(KEY); return saved ? JSON.parse(saved) : seed(); }
  catch { return seed(); }
}
function normalize(data) {
  return { ...data, store: { id: data.store.store_id, name: data.store.store_name, address: data.store.address || '', phone: data.store.phone || '', open: data.store.open_time?.slice(0,5) || '08:00', close: data.store.close_time?.slice(0,5) || '22:00' }, recipes: data.recipes.reduce((all,r) => { (all[r.menu_id] ||= []).push([r.ingredient_id,r.qty]); return all; }, {}) };
}
export function useOperations() {
  const [demo, setDemo] = useState(loadDemo);
  const demoRef = useRef(demo);
  const [remote, setRemote] = useState(null);
  const [session, setSession] = useState(null);
  const [mode, setMode] = useState(supabase ? 'live' : 'demo');
  const [ready, setReady] = useState(!supabase);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [week, setWeek] = useState(initialWeek);
  const [range, setRange] = useState(() => ({ from: monday(), to: addDays(monday(),6) }));
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (mode !== 'live' || !session) return;
    const ticket = ++generation.current;
    setLoading(true); setError('');
    try {
      const { data, error: err } = await supabase.rpc('ops_snapshot', { p_week: week, p_from: range.from, p_to: range.to });
      if (err) throw err;
      if (ticket === generation.current) setRemote(normalize(data));
    } catch (e) { if (ticket === generation.current) { setRemote(null); setError(`DB 조회 실패: ${e.message}`); } }
    finally { if (ticket === generation.current) setLoading(false); }
  }, [mode, session, week, range]);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({data,error:err}) => { if (active) { setSession(data.session); setReady(true); if(err) setError(err.message); } });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => { if(active) { setSession(s); setReady(true); if(!s) { generation.current++; setRemote(null); } } });
    return () => { active=false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { refresh(); return () => { generation.current++; }; }, [refresh]);
  useEffect(() => {
    const reload = e => { if (e.key === KEY) { const next=loadDemo(); demoRef.current=next; setDemo(next); } };
    window.addEventListener('storage',reload); return () => window.removeEventListener('storage',reload);
  }, []);
  const commit = next => { localStorage.setItem(KEY,JSON.stringify(next)); demoRef.current=next; setDemo(next); };
  const data = mode === 'demo' ? demo : remote;
  const empty = { store: {}, menus: [], ingredients: [], recipes: {}, staff: [], availability: [], forecast: [], sales: [], summary: [] };
  const current = data || empty;
  const importSales = async rows => {
    const valid = validateSales(rows,current.menus,mode==='demo' ? demoRef.current.sales : current.sales);
    if (mode==='live') {
      const {error:err}=await supabase.rpc('ops_import_sales',{p_rows:valid}); if(err) throw err;
      await refresh();
    } else commit({...demoRef.current,sales:[...demoRef.current.sales,...valid.map(r=>({...r,sale_id:crypto.randomUUID()}))]});
    return valid.length;
  };
  const save = async (kind, input, remove = false) => {
    const item = {...input};
    if (!remove && kind !== 'recipe') {
      item.name=required(item.name,'이름',kind==='staff'?50:100);
      if(kind==='menu') item.price=number(item.price,'판매가',0,true);
      if(kind==='ingredient') { item.unit=required(item.unit,'사용 단위',20); item.price=number(item.price,'단가',0,true); item.min=number(item.min,'최소 보유량'); item.orderUnit=number(item.orderUnit,'발주 단위',0.001); }
      if(kind==='staff') {
        item.wage=number(item.wage,'시급',0,true); item.maxHours=number(item.maxHours,'주 최대 근무시간');
        if(item.maxHours>168) throw new Error('주 최대 근무시간은 168시간 이하여야 합니다.');
        item.email=required(item.email,'이메일',254).toLowerCase();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) throw new Error('이메일 형식을 확인하세요.');
      }
      if(kind==='store' && (!item.open || !item.close || item.open>=item.close)) throw new Error('영업 종료는 시작보다 늦어야 합니다.');
    }
    if(kind==='recipe') {
      const ids=new Set();
      item.lines=item.lines.map(([id,qty])=>{ if(ids.has(String(id))) throw new Error('레시피의 재료가 중복됩니다.'); ids.add(String(id)); if(!current.ingredients.some(i=>String(i.id)===String(id))) throw new Error('재료를 선택하세요.'); return [id,number(qty,'소요량',0.001)]; });
    }
    if(mode==='live') {
      const payload=kind==='recipe'?{...item,lines:item.lines.map(([ingredient_id,qty])=>({ingredient_id,qty}))}:item;
      const {data:id,error:err}=await supabase.rpc('ops_save',{p_kind:kind,p_data:payload,p_delete:remove});
      if(err) throw new Error(err.code==='23503'?'연결된 판매·레시피·근무 이력이 있어 삭제할 수 없습니다. 판매 중지 또는 비활성 상태를 이용하세요.':err.message);
      await refresh(); return id;
    }
    const next=structuredClone(demoRef.current), id=item.id || crypto.randomUUID();
    if(kind==='store') next.store=item;
    else if(kind==='recipe') next.recipes[id]=item.lines;
    else {
      const field={menu:'menus',ingredient:'ingredients',staff:'staff'}[kind];
      if(remove) {
        if(kind==='menu' && next.sales.some(s=>String(s.menu_id)===String(id))) throw new Error('판매 이력이 있어 삭제할 수 없습니다. 판매 중지를 이용하세요.');
        if(kind==='ingredient' && (Object.values(next.recipes).some(lines=>lines.some(([iid])=>String(iid)===String(id))) || next.ingredients.find(i=>i.id===id)?.stock)) throw new Error('레시피에서 사용 중이거나 재고가 남아 있습니다.');
        next[field]=next[field].filter(x=>x.id!==id);
        if(kind==='menu') delete next.recipes[id];
        if(kind==='staff') next.availability=next.availability.filter(a=>a.user_id!==id);
      } else {
        const old=next[field].find(x=>x.id===id);
        if(kind==='ingredient' && old && old.unit!==item.unit && (old.stock || Object.values(next.recipes).some(ls=>ls.some(([iid])=>iid===id)))) throw new Error('사용 중인 재료의 단위는 변경할 수 없습니다.');
        if(kind==='staff' && next.staff.some(s=>s.id!==id && s.email===item.email)) throw new Error('이미 등록된 이메일입니다.');
        const record={stock:0,use:0,factor:1,sold:0,avail:{},status:'초대됨',...old,...item,id};
        next[field]=old?next[field].map(x=>x.id===id?record:x):[...next[field],record];
      }
    }
    commit(next); return id;
  };
  const saveAvailability = async (rows,max) => {
    max=number(max,'주 최대 근무시간'); if(max>168) throw new Error('168시간 이하여야 합니다.');
    if(mode==='live') { const {error:err}=await supabase.rpc('ops_availability',{p_week:week,p_rows:rows,p_max:max}); if(err) throw err; await refresh(); }
    else {
      const id='s2', next=structuredClone(demoRef.current);
      const entries=rows.length?rows:[{day_of_week:0,start_time:'00:00',end_time:'00:00',is_unavailable:true}];
      next.availability=[...next.availability.filter(a=>a.user_id!==id || a.target_week!==week),...entries.map(r=>({...r,user_id:id,target_week:week}))];
      next.staff=next.staff.map(s=>s.id===id?{...s,maxHours:max,availability_week:week}:s); commit(next);
    }
  };
  const invite = async id => {
    if(mode==='demo') throw new Error('체험 모드에서는 이메일이 발송되지 않습니다. 실제 로그인 후 초대하세요.');
    const {data,error:err}=await supabase.functions.invoke('invite-employee',{body:{user_id:id}});
    if(err || data?.error) {
      let message=data?.error || err.message;
      if(err?.context instanceof Response) { try { message=(await err.context.json()).error || message; } catch { /* non-JSON response */ } }
      throw new Error(message);
    }
    await refresh();
  };
  return { ...current, mode, configured:!!supabase, ready, session, profile:mode==='live'?remote?.profile:null, loading,error,week,setWeek,range,setRange,refresh,
    summary:mode==='demo'?summarizeSales(current.sales).filter(s=>s.base_date>=range.from && s.base_date<=range.to):current.summary,
    importSales,save,saveAvailability,invite,
    startDemo:()=>{generation.current++;setMode('demo');setError('');setLoading(false);},
    startLive:()=>{setMode('live');setError('');},
    signIn:async(email,password)=>{const {error:err}=await supabase.auth.signInWithPassword({email,password});if(err)throw err;setMode('live');},
    signOut:async()=>{if(supabase){const {error:err}=await supabase.auth.signOut();if(err)throw err;}setRemote(null);},
    changePassword:async password=>{const {error:err}=await supabase.auth.updateUser({password});if(err)throw err;},
    me:mode==='demo'?current.staff.find(s=>s.id==='s2'):current.staff.find(s=>s.id===remote?.profile?.id),
  };
}
