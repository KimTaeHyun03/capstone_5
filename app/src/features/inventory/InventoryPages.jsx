import { useState } from 'react';
import { Alert, Badge, Button, EmptyState, Field, Meter, PageHead, Panel, SampleTag, Segment, StatCard, useToast } from '../../components/ui/index.jsx';
import { stockLevel, won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';
import { useBase, useRolePath } from '../../layouts/Layouts.jsx';
import { recordAdjustments } from '../../lib/inventory.js';
import { markNotificationsRead, resolveShortageReport } from '../../lib/alerts.js';
import { devUserIdFor } from '../../lib/devUser.js';

const LEVEL = { low: ['red', '부족'], warn: ['orange', '주의'], ok: ['green', '충분'] };

/* 4-2 · 재고 현황 (점주·매니저) */
export function InventoryPage() {
  const { inventory, inventorySource } = useApp();
  const [filter, setFilter] = useState('all');
  const base = useBase();
  const p = useRolePath();
  const list = inventory.filter((i) => filter === 'all' || stockLevel(i) === filter);
  const value = inventory.reduce((a, i) => a + i.stock * i.price, 0);
  return (
    <>
      <PageHead eyebrow="재고 관리 · 4-2" title="재고 현황" desc="판매 시 레시피 소요량만큼 자동 차감된 현재 재고입니다."
        actions={base === '/manager' ? <Button icon="clipboard" to={p('stocktake')}>실사·폐기 기록</Button> : <Button icon="truck" to={p('order/recommend')}>권장 발주 보기</Button>} />
      <div className="stack-lg">
        <div className="grid-3">
          <StatCard label="관리 품목" value={inventory.length} unit="개" />
          <StatCard label="최소 보유량 미달" value={inventory.filter((i) => stockLevel(i) === 'low').length} unit="개" sub="부족 알림 발송됨" />
          <StatCard label="재고 금액" value={won(value)} sub="단가 기준" />
        </div>
        <Panel id="inv" title="재료별 재고" actions={inventorySource === 'sample' ? <SampleTag /> : null}>
          <div style={{ marginBottom: 16 }}>
            <Segment label="상태 필터" value={filter} onChange={setFilter} options={[{ value: 'all', label: '전체' }, { value: 'low', label: '부족' }, { value: 'warn', label: '주의' }, { value: 'ok', label: '충분' }]} />
          </div>
          {list.length === 0 ? <EmptyState icon="box" title="해당 상태의 재료가 없습니다">다른 필터를 선택해 보세요.</EmptyState> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">재료</th><th scope="col" className="num">현재</th><th scope="col" className="num">최소 보유</th><th scope="col" style={{ width: '22%' }}>보유 수준</th><th scope="col">상태</th></tr></thead>
                <tbody>
                  {list.map((i) => {
                    const lv = stockLevel(i);
                    return (
                      <tr key={i.id} className={lv === 'low' ? 'is-low' : ''}>
                        <th scope="row">{i.name}</th>
                        <td className="num">{i.stock}{i.unit}</td>
                        <td className="num">{i.min}{i.unit}</td>
                        <td><Meter value={i.stock} max={i.min * 2} level={lv} /></td>
                        <td><Badge tone={LEVEL[lv][0]}>{LEVEL[lv][1]}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

/* 4-5 · 부족 알림 수신 (점주·매니저) */
export function AlertsPage() {
  const { lowStock, reports, reloadReports, inventory, notifications, loadAlerts } = useApp();
  const toast = useToast();
  const base = useBase();
  const p = useRolePath();
  const ingName = (id) => inventory.find((i) => i.id === id)?.name;
  const resolve = async (r) => {
    try { await resolveShortageReport(r.reportId); await reloadReports(); toast('신고를 확인 처리했습니다.'); }
    catch (e) { toast(`처리하지 못했습니다. ${e.message}`); }
  };
  const readAll = async () => {
    try { await markNotificationsRead(devUserIdFor(base)); await loadAlerts(); toast('모든 알림을 읽음으로 표시했습니다.'); }
    catch (e) { toast(`처리하지 못했습니다. ${e.message}`); }
  };
  return (
    <>
      <PageHead eyebrow="재고 관리 · 4-4 · 4-5" title="부족 알림" desc="최소 보유량 미달 자동 알림과 직원이 직접 올린 부족 신고입니다."
        actions={base === '/owner' ? <Button icon="truck" to={p('order/recommend')}>발주하러 가기</Button> : <Button icon="inbox" to={p('receive')}>입고 처리</Button>} />
      <div className="stack-lg">
        <Panel id="al-low" title="최소 보유량 미달" meta={`${lowStock.length}건 · 자동 감지`}>
          {lowStock.length === 0 ? <EmptyState icon="check" title="부족한 재료가 없습니다">재고가 최소 보유량 아래로 내려가면 여기에 표시됩니다.</EmptyState> : (
            <div className="list">
              {lowStock.map((i) => (
                <div className="list-row" key={i.id}>
                  <div className="list-main">
                    <span className="list-title">{i.name}</span>
                    <span className="list-sub">현재 {i.stock}{i.unit} · 최소 {i.min}{i.unit} · {i.supplier}</span>
                  </div>
                  <Badge tone="red">{(i.min - i.stock).toLocaleString()}{i.unit} 부족</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel id="al-rep" title="직원 부족 신고" meta={`${reports.length}건`}>
          {reports.length === 0 ? <EmptyState icon="flag" title="처리할 신고가 없습니다">알바생이 앱에서 부족 신고를 올리면 점주·매니저에게 바로 알림이 갑니다.</EmptyState> : (
            <div className="list">
              {reports.map((r) => (
                <div className="list-row" key={r.id}>
                  <div className="list-main">
                    <span className="list-title">{ingName(r.ingredientId)} <Badge tone="orange">직접 신고</Badge></span>
                    <span className="list-sub">{r.by} · {r.at}{r.note ? ` · “${r.note}”` : ''}</span>
                  </div>
                  <Button variant="secondary" onClick={() => resolve(r)}>확인</Button>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel id="al-all" title="전체 알림 이력" actions={<Button variant="text" onClick={readAll}>모두 읽음</Button>}>
          <div className="list">
            {notifications.map((n) => (
              <div className="list-row" key={n.id}>
                <div className="list-main">
                  <span className="list-title" style={{ fontWeight: n.read ? 400 : 600 }}>{n.title}</span>
                  <span className="list-sub">{n.at}</span>
                </div>
                {n.read ? <Badge>읽음</Badge> : <Badge tone="blue">새 알림</Badge>}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

/* 4-3 · 실사·폐기 기록 (매니저) */
export function StocktakePage() {
  const { inventory, inventorySource, reloadInventory, loadAlerts } = useApp();
  const toast = useToast();
  const base = useBase();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('count');
  const [vals, setVals] = useState({});
  const [reason, setReason] = useState('유통기한 경과');
  const [errors, setErrors] = useState({});
  const validate = (raw, it) => {
    if (raw === undefined || raw === '') return '';
    const n = Number(raw);
    if (Number.isNaN(n)) return '숫자를 입력하세요.';
    if (n < 0) return '0 이상으로 입력하세요.';
    if (mode === 'waste' && n > it.stock) return `현재 재고 ${it.stock}${it.unit}보다 많이 폐기할 수 없습니다.`;
    return '';
  };
  const filled = inventory.filter((i) => vals[i.id] !== undefined && vals[i.id] !== '');
  const submit = async () => {
    const errs = Object.fromEntries(inventory.map((i) => [i.id, validate(vals[i.id], i)]));
    setErrors(errs);
    const bad = inventory.find((i) => errs[i.id]);
    if (bad) { document.getElementById(`st-${bad.id}`)?.focus(); return; }
    if (inventorySource !== 'db') { toast('DB에 연결되지 않아 저장할 수 없습니다.'); return; }
    setSaving(true);
    try {
      // 재고 변동 기록(실사 보정·폐기) 저장 + 재고 반영은 DB 함수가 처리한다. 부족 알림도 DB 트리거가 보낸다.
      await recordAdjustments(
        filled.map((i) => ({ ingredientId: i.ingredientId, qty: Number(vals[i.id]) })),
        mode === 'count' ? '실사 보정' : '폐기', devUserIdFor(base), mode === 'waste' ? reason : null);
      await Promise.all([reloadInventory(), loadAlerts()]);
      toast(`${filled.length}개 품목을 ${mode === 'count' ? '실사 수량으로 보정' : '폐기 처리'}했습니다.`);
      setVals({});
    } catch (e) {
      await reloadInventory(); // 일부만 반영됐을 수 있어 최신 재고로 맞춘다
      toast(`저장하지 못했습니다. ${e.message}`);
    } finally { setSaving(false); }
  };
  return (
    <>
      <PageHead eyebrow="재고 관리 · 4-3" title="실사·폐기 기록" desc="실제로 센 수량이나 버린 수량을 입력하면 재고 변동 기록으로 남고 재고에 바로 반영됩니다." />
      <div className="stack-lg">
        <Segment label="기록 유형" value={mode} onChange={(m) => { setMode(m); setVals({}); setErrors({}); }} options={[{ value: 'count', label: '재고 실사' }, { value: 'waste', label: '폐기' }]} />
        {mode === 'waste' && (
          <div style={{ maxWidth: 360 }}>
            <Field id="reason" label="폐기 사유" required>
              <select id="reason" className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option>유통기한 경과</option><option>품질 불량</option><option>제조 실수</option><option>기타</option>
              </select>
            </Field>
          </div>
        )}
        <Panel id="st" title={mode === 'count' ? '실사 수량 입력' : '폐기 수량 입력'} meta="입력한 품목만 반영됩니다">
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">재료</th><th scope="col" className="num">시스템 재고</th><th scope="col" className="num">{mode === 'count' ? '실사 수량' : '폐기 수량'}</th><th scope="col" className="num">차이</th></tr></thead>
              <tbody>
                {inventory.map((i) => {
                  const v = vals[i.id];
                  const n = Number(v);
                  const has = v !== undefined && v !== '' && !Number.isNaN(n);
                  const diff = has ? (mode === 'count' ? n - i.stock : -n) : null;
                  return (
                    <tr key={i.id}>
                      <th scope="row">{i.name}</th>
                      <td className="num">{i.stock}{i.unit}</td>
                      <td className="num">
                        <div className="qty-cell">
                          <label className="sr-only" htmlFor={`st-${i.id}`}>{i.name} {mode === 'count' ? '실사' : '폐기'} 수량({i.unit})</label>
                          <div className="od-row" style={{ '--od-gap': '4px' }}>
                            <input id={`st-${i.id}`} className="input input-num" inputMode="decimal" value={v ?? ''} placeholder="—"
                              aria-invalid={!!errors[i.id]} aria-describedby={errors[i.id] ? `st-${i.id}-err` : undefined}
                              onChange={(e) => setVals((x) => ({ ...x, [i.id]: e.target.value }))}
                              onBlur={() => setErrors((x) => ({ ...x, [i.id]: validate(vals[i.id], i) }))} />
                            <span>{i.unit}</span>
                          </div>
                          {errors[i.id] && <span className="err" id={`st-${i.id}-err`}>{errors[i.id]}</span>}
                        </div>
                      </td>
                      <td className="num">{diff == null ? '—' : <span className={diff < 0 ? 'delta-down' : diff > 0 ? 'delta-up' : ''}>{diff > 0 ? '+' : ''}{+diff.toFixed(2)}{i.unit}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="od-cluster" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="secondary" onClick={() => { setVals({}); setErrors({}); }} disabled={!filled.length}>입력 지우기</Button>
            <Button icon="check" onClick={submit} disabled={!filled.length || saving}>{saving ? '저장 중…' : filled.length ? `${filled.length}개 품목 반영` : '수량을 입력하세요'}</Button>
          </div>
        </Panel>
        {mode === 'waste' && <Alert tone="info" title="폐기량은 예측 오차 보정에 쓰입니다">기간 마감 때 폐기량을 함께 집계해 다음 권장 발주량의 보정 계수를 계산합니다.</Alert>}
      </div>
    </>
  );
}
