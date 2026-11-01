import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, monday, number, required, validateSales } from '../domain/operations.js';
import { supabase } from '../lib/supabase.js';

const initialWeek = () => addDays(monday(), 7);

const EMPTY = { store: {}, menus: [], ingredients: [], recipes: {}, staff: [], availability: [], forecast: [], sales: [], summary: [] };

function normalize(data) {
  return { ...data, store: { id: data.store.store_id, name: data.store.store_name, address: data.store.address || '', phone: data.store.phone || '', open: data.store.open_time?.slice(0,5) || '08:00', close: data.store.close_time?.slice(0,5) || '22:00' }, recipes: data.recipes.reduce((all,r) => { (all[r.menu_id] ||= []).push([r.ingredient_id,r.qty]); return all; }, {}) };
}

// 매장 기초 정보(메뉴·재료·레시피·직원)·판매·가능시간을 로그인한 사용자의 권한으로 읽고 저장한다.
export function useOperations() {
  const [remote, setRemote] = useState(null);
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [week, setWeek] = useState(initialWeek);
  const [range, setRange] = useState(() => ({ from: monday(), to: addDays(monday(),6) }));
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!session) return;
    const ticket = ++generation.current;
    setLoading(true); setError('');
    try {
      const { data, error: err } = await supabase.rpc('ops_snapshot', { p_week: week, p_from: range.from, p_to: range.to });
      if (err) throw err;
      if (ticket === generation.current) setRemote(normalize(data));
    } catch (e) { if (ticket === generation.current) { setRemote(null); setError(`매장 데이터를 불러오지 못했습니다: ${e.message}`); } }
    finally { if (ticket === generation.current) setLoading(false); }
  }, [session, week, range]);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({data,error:err}) => { if (active) { setSession(data.session); setReady(true); if(err) setError(err.message); } });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => { if(active) { setSession(s); setReady(true); if(!s) { generation.current++; setRemote(null); } } });
    return () => { active=false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { refresh(); return () => { generation.current++; }; }, [refresh]);
  const current = remote || EMPTY;
  const importSales = async rows => {
    const valid = validateSales(rows,current.menus,current.sales);
    const {error:err}=await supabase.rpc('ops_import_sales',{p_rows:valid}); if(err) throw err;
    await refresh();
    return valid.length;
  };
  // 7-2·7-3·7-4 CSV 일괄 등록. DB 함수 한 번(한 트랜잭션: 한 행이라도 틀리면 전부 취소)으로 처리한다.
  // 재료·메뉴는 같은 이름이 있으면 수정, 없으면 새로 만든다. 레시피는 CSV 에 나온 메뉴만 통째로 바꾼다.
  const importCatalog = async (kind, rows) => {
    const { data, error: err } = await supabase.rpc('ops_import_catalog', { p_kind: kind, p_rows: rows });
    if (err) throw new Error(err.message);
    await refresh();
    return data;
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
    const payload=kind==='recipe'?{...item,lines:item.lines.map(([ingredient_id,qty])=>({ingredient_id,qty}))}:item;
    const {data:id,error:err}=await supabase.rpc('ops_save',{p_kind:kind,p_data:payload,p_delete:remove});
    if(err) throw new Error(err.code==='23503'?'연결된 판매·레시피·근무 이력이 있어 삭제할 수 없습니다. 판매 중지 또는 비활성 상태를 이용하세요.':err.message);
    await refresh(); return id;
  };
  const saveAvailability = async (rows,max) => {
    max=number(max,'주 최대 근무시간'); if(max>168) throw new Error('168시간 이하여야 합니다.');
    const {error:err}=await supabase.rpc('ops_availability',{p_week:week,p_rows:rows,p_max:max}); if(err) throw err;
    await refresh();
  };
  const invite = async id => {
    const {data,error:err}=await supabase.functions.invoke('invite-employee',{body:{user_id:id}});
    if(err || data?.error) {
      let message=data?.error || err.message;
      if(err?.context instanceof Response) { try { message=(await err.context.json()).error || message; } catch { /* non-JSON response */ } }
      throw new Error(message);
    }
    await refresh();
  };
  return { ...current, ready, session, profile:remote?.profile ?? null, loading,error,week,setWeek,range,setRange,refresh,
    summary:current.summary,
    importSales,importCatalog,save,saveAvailability,invite,
    me:current.staff.find(s=>s.id===remote?.profile?.id),
  };
}
