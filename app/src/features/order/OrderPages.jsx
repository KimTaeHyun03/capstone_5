import { Fragment, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Modal, PageHead, Panel, StatCard, useToast } from '../../components/ui/index.jsx';
import { won } from '../../domain/index.js';
import { runPeriodClose } from '../../lib/correction.js';
import { useApp } from '../../state/AppState.jsx';
import { useRolePath } from '../../layouts/Layouts.jsx';
import { useNavigate } from 'react-router-dom';
import { calculateRecommendations, nextMonday, placeOrder, receiveOrder } from '../../lib/orders.js';
import { kst } from '../../lib/attendance.js';
import { useDbUserId } from '../../lib/currentUser.js';
import { AiInsight } from '../ai/AiInsight.jsx';

/* 5-1 · 5-2 · 권장 발주량 확인·발주 등록 (점주) */
export function RecommendPage() {
  const { inventory, inventorySource, recs, recsLoaded, reloadRecs, reloadOrders, correction, reloadCorrection, loadAlerts } = useApp();
  const me = useDbUserId();
  const toast = useToast();
  const nav = useNavigate();
  const [closing, setClosing] = useState(false);
  // 지난주(월~일)를 마감했는지: 마감 기록이 있으면 오차·보정 계수가 반영된 권장량, 없으면 최근 판매 기준 권장량이다.
  const lastWeek = (() => {
    const t = kst();
    const end = new Date(`${t.ymd}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - t.dow - 1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);
    const iso = (d) => d.toISOString().slice(0, 10);
    const md = (d) => `${d.getUTCMonth() + 1}.${String(d.getUTCDate()).padStart(2, '0')}`;
    return { end: iso(end), label: `${md(start)}–${md(end)}` };
  })();
  const lastWeekClosed = !!correction?.errors.some((e) => e.end === lastWeek.end);
  // DB 에 저장된 권장 발주량(5-E1). 아직 계산 전이면 0
  const recOf = (it) => recs[it.id]?.rec ?? 0;
  const init = () => Object.fromEntries(inventory.map((it) => [it.id, String(recOf(it))]));
  const [qty, setQty] = useState(init);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const recSig = JSON.stringify(Object.values(recs).map((r) => r.recommendationId));
  useEffect(() => { setQty(init()); setErrors({}); }, [recSig, inventory]); // eslint-disable-line react-hooks/exhaustive-deps

  const recalc = async () => {
    setCalculating(true);
    try { await calculateRecommendations(); await reloadRecs(); toast('현재 재고로 권장 발주량을 다시 계산했습니다.'); }
    catch (e) { toast(`계산하지 못했습니다. ${e.message}`); }
    finally { setCalculating(false); }
  };
  // 마감이 늦어졌을 때 여기서 바로 마감하고, 마감 결과(오차·보정 계수)를 넣어 권장량을 다시 계산한다.
  const closeAndRecalc = async () => {
    setClosing(true);
    try {
      await runPeriodClose();
      await Promise.all([reloadCorrection(), loadAlerts()]);
      await calculateRecommendations(); await reloadRecs();
      toast(`${lastWeek.label} 주를 마감하고 권장 발주량을 다시 계산했습니다.`);
    } catch (e) { toast(`마감하지 못했습니다. ${e.message}`); }
    finally { setClosing(false); }
  };
  // 다음 주 기준 권장량이 아직 없으면 처음 한 번 자동 계산한다.
  const autoCalc = useRef(false);
  useEffect(() => {
    if (inventorySource !== 'db' || !recsLoaded || autoCalc.current) return;
    const latest = Object.values(recs).map((r) => r.periodStart).sort().pop();
    if (!latest || latest < nextMonday()) { autoCalc.current = true; recalc(); }
  }, [inventorySource, recsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (it, raw) => {
    if (raw === '' || Number.isNaN(Number(raw))) return '숫자를 입력하세요.';
    const n = Number(raw);
    if (n < 0) return '0 이상으로 입력하세요.';
    if (n % it.orderUnit !== 0) return `발주 단위 ${it.orderUnit}${it.unit}의 배수로 입력하세요.`;
    return '';
  };
  const lines = inventory.map((it0) => {
    const r = recs[it0.id];
    const it = r ? { ...it0, use: r.use, factor: r.factor } : it0;
    return { it, rec: recOf(it0), recId: r?.recommendationId ?? null, n: Number(qty[it0.id]) || 0 };
  });
  const total = lines.reduce((a, l) => a + l.n * l.it.price, 0);
  const count = lines.filter((l) => l.n > 0).length;
  const badList = inventory.filter((it) => errors[it.id]);
  // 처음 쓰는 매장: 판매 기록이 없으면 예상 소진량이 전부 0이라 재고가 부족해도 권장량이 0으로 나온다. 이유를 알려 준다.
  const noUsage = inventorySource === 'db' && recsLoaded && inventory.length > 0 && lines.every((l) => !l.it.use);

  const submit = async () => {
    const errs = Object.fromEntries(inventory.map((it) => [it.id, validate(it, qty[it.id])]));
    setErrors(errs);
    const bad = inventory.filter((it) => errs[it.id]);
    if (bad.length) { document.getElementById(`qty-${bad[0].id}`)?.focus(); return; }
    if (inventorySource !== 'db') { toast('재고 정보를 아직 불러오지 못했습니다. 잠시 뒤에 다시 시도하세요.'); return; }
    setSubmitting(true);
    try {
      // 발주는 '대기'로 저장된다. 권장량과 다르게 고친 품목은 DB가 조정 여부를 표시한다.
      await placeOrder(me, lines.filter((l) => l.n > 0).map((l) => ({ ingredientId: l.it.ingredientId, recommendationId: l.recId, qty: l.n })));
      await reloadOrders();
      toast(`${count}개 품목, ${won(total)} 발주를 등록했습니다.`);
      nav('/owner/order/orders');
    } catch (e) {
      toast(`발주를 등록하지 못했습니다. ${e.message}`);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <PageHead eyebrow="발주 관리" title="권장 발주" desc="다음 주 예상 소진량과 보정 계수로 계산한 권장량입니다. 수량을 고친 뒤 발주를 등록하세요." />
      <div className="stack-lg">
        <Alert tone="info" title="권장 발주량 = 예상 소진량 × 보정 계수 − 현재 재고">발주 단위로 올림한 값입니다. 보정 계수는 최근 3주 예측 오차로 계산했습니다.{recsLoaded && Object.keys(recs).length > 0 && ` (계산 기준: ${new Date(Object.values(recs)[0].calculatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`}</Alert>
        {inventorySource === 'db' && recsLoaded && (lastWeekClosed
          ? <Alert tone="success" title={`지난주(${lastWeek.label}) 마감 완료`}>지난주 예측 오차와 보정 계수가 반영된 권장량입니다.</Alert>
          : (
            <Alert tone="warning" title={`지난주(${lastWeek.label})는 아직 마감 전입니다`}>
              지금은 마감 기록 대신 최근 판매량을 기준으로 계산하고, 보정 계수는 이전 값을 그대로 씁니다. 마감하면 예측 오차와 보정 계수를 반영해 권장량을 다시 계산합니다. 마감은 자동으로 하지 않으니, 지난주 판매 기록(CSV)을 모두 올린 뒤 마감하세요.
              <div className="od-cluster" style={{ marginTop: 8 }}><Button variant="secondary" size="sm" icon="plus" to="/owner/sales/records">판매 기록 입력</Button><Button variant="secondary" size="sm" onClick={closeAndRecalc} disabled={closing}>{closing ? '마감 중…' : '지난주 마감하고 다시 계산'}</Button></div>
            </Alert>
          ))}
        {noUsage && (
          <Alert tone="warning" title="아직 예상 소진량을 계산할 판매 기록이 없습니다">
            판매 기록이 쌓이면 최근 판매량을 기준으로 권장량이 계산됩니다. 판매 기록 화면에서 판매를 입력하거나 CSV로 올린 뒤 &lsquo;지금 재고로 다시 계산&rsquo;을 누르세요. 그 전에도 아래 발주 수량을 직접 입력해 발주할 수 있습니다.
          </Alert>
        )}
        <AiInsight kind="order_explain" title="AI 발주 설명" hint="재료별 권장량이 왜 그 수량인지 예상 소진량·보정 계수·현재 재고 기준으로 설명합니다." />
        {badList.length > 0 && (
          <div className="alert alert-danger" role="alert">
            <div className="alert-body">
              <strong className="alert-title">입력값을 확인해 주세요 ({badList.length}건)</strong>
              <span className="alert-text">
                {badList.map((it, i) => <Fragment key={it.id}>{i > 0 && ', '}<a href={`#qty-${it.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`qty-${it.id}`).focus(); }} style={{ color: 'var(--danger-text)' }}>{it.name}</a></Fragment>)}
              </span>
            </div>
          </div>
        )}
        <Panel id="rc" title="재료별 권장 발주량" actions={<Button variant="text" onClick={recalc} disabled={calculating}>{calculating ? '계산 중…' : '지금 재고로 다시 계산'}</Button>}>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="권장 발주량 표">
            <table>
              <caption className="sr-only">재료별 권장 발주량과 예상 금액</caption>
              <thead><tr><th scope="col">재료</th><th scope="col" className="num">현재</th><th scope="col" className="num">예상 소진</th><th scope="col" className="num">보정 계수</th><th scope="col" className="num">권장</th><th scope="col" className="num">발주 수량</th><th scope="col" className="num">금액</th></tr></thead>
              <tbody>
                {lines.map(({ it, rec, n }) => (
                  <tr key={it.id}>
                    <th scope="row">{it.name}</th>
                    <td className="num">{it.stock}{it.unit}</td>
                    <td className="num">{it.use}{it.unit}</td>
                    <td className="num">×{it.factor.toFixed(2)}</td>
                    <td className="num">{rec}{it.unit}</td>
                    <td className="num">
                      <div className="qty-cell">
                        <label className="sr-only" htmlFor={`qty-${it.id}`}>{it.name} 발주 수량({it.unit})</label>
                        <div className="od-row" style={{ '--od-gap': '4px' }}>
                          <input id={`qty-${it.id}`} className="input input-num" inputMode="numeric" value={qty[it.id]}
                            aria-invalid={!!errors[it.id]} aria-describedby={errors[it.id] ? `err-${it.id}` : `unit-${it.id}`}
                            onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))} onBlur={() => setErrors((p) => ({ ...p, [it.id]: validate(it, qty[it.id]) }))} />
                          <span>{it.unit}</span>
                        </div>
                        {errors[it.id] ? <span className="err" id={`err-${it.id}`}>{errors[it.id]}</span>
                          : <span className="help" id={`unit-${it.id}`}>{n !== rec ? '조정됨 · ' : ''}단위 {it.orderUnit}{it.unit}</span>}
                      </div>
                    </td>
                    <td className="num">{won(n * it.price)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row" colSpan={6}>합계 ({count}개 품목)</th><td className="num">{won(total)}</td></tr></tfoot>
            </table>
          </div>
          <div className="od-cluster" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="secondary" onClick={() => { setQty(init()); setErrors({}); }}>권장량으로 되돌리기</Button>
            <Button icon="truck" onClick={submit} disabled={submitting || count === 0}>{submitting ? '등록 중…' : `발주 등록 (${count}개 품목)`}</Button>
          </div>
        </Panel>
      </div>
    </>
  );
}

function OrderTable({ orders, inventory, onReceive }) {
  const ing = (id) => inventory.find((i) => i.id === id);
  if (!orders.length) return <EmptyState icon="truck" title="발주 내역이 없습니다">권장 발주 화면에서 발주를 등록하면 여기에 표시됩니다.</EmptyState>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th scope="col">발주 번호</th><th scope="col">발주일</th><th scope="col">품목</th><th scope="col" className="num">금액</th><th scope="col">상태</th>{onReceive && <th scope="col"><span className="sr-only">처리</span></th>}</tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <th scope="row">{o.id}</th>
              <td className="od-nowrap">{o.date}</td>
              <td>{o.lines.map((l) => `${ing(l.id).name} ${l.qty}${ing(l.id).unit}`).join(', ')}</td>
              <td className="num">{won(o.lines.reduce((a, l) => a + l.qty * ing(l.id).price, 0))}</td>
              <td>{o.status === '대기' ? <Badge tone="orange">입고 대기</Badge> : <Badge tone="green">입고 완료</Badge>}</td>
              {onReceive && <td className="num">{o.status === '대기' && <Button variant="secondary" onClick={() => onReceive(o)}>입고 처리</Button>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* 발주·입고 내역 (점주) */
export function OrdersPage() {
  const { orders, inventory, inventorySource } = useApp();
  const p = useRolePath();
  const waiting = orders.filter((o) => o.status === '대기').length;
  return (
    <>
      <PageHead eyebrow="발주 관리" title="발주·입고 내역" desc="등록한 발주와 매니저의 입고 처리 상태입니다." actions={<Button icon="truck" to={p('order/recommend')}>새 발주</Button>} />
      <div className="stack-lg">
        <div className="grid-3">
          <StatCard label="입고 대기" value={waiting} unit="건" sub="매니저가 입고 처리" />
          <StatCard label="이번 달 발주" value={orders.length} unit="건" />
          <StatCard label="이번 달 발주 금액" value={won(orders.reduce((a, o) => a + o.lines.reduce((s, l) => s + l.qty * inventory.find((i) => i.id === l.id).price, 0), 0))} />
        </div>
        <Panel id="od" title="발주 내역"><OrderTable orders={orders} inventory={inventory} /></Panel>
      </div>
    </>
  );
}

function ReceiveModal({ order, inventory, onClose, onConfirm }) {
  const [rec, setRec] = useState(Object.fromEntries(order.lines.map((l) => [l.id, String(l.qty)])));
  const [errors, setErrors] = useState({});
  const ing = (id) => inventory.find((i) => i.id === id);
  const validate = (raw) => (raw === '' || Number.isNaN(Number(raw)) ? '숫자를 입력하세요.' : Number(raw) < 0 ? '0 이상으로 입력하세요.' : '');
  const confirm = () => {
    const errs = Object.fromEntries(order.lines.map((l) => [l.id, validate(rec[l.id])]));
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    onConfirm(order, Object.fromEntries(order.lines.map((l) => [l.id, Number(rec[l.id])])));
  };
  return (
    <Modal title={`${order.id} 입고 처리`} desc="실제로 받은 수량을 확인하세요. 입고 완료하면 재고에 더해집니다." onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>취소</Button><Button icon="check" onClick={confirm}>입고 완료</Button></>}>
      <div className="list">
        {order.lines.map((l) => {
          const it = ing(l.id);
          const diff = Number(rec[l.id]) - l.qty;
          return (
            <div className="list-row" key={l.id}>
              <div className="list-main">
                <span className="list-title">{it.name}</span>
                <span className="list-sub">발주 {l.qty}{it.unit}{!Number.isNaN(diff) && diff !== 0 ? ` · ${diff > 0 ? '+' : ''}${diff}${it.unit} 차이` : ''}</span>
                {errors[l.id] && <span className="err" id={`rv-${l.id}-err`}>{errors[l.id]}</span>}
              </div>
              <label className="sr-only" htmlFor={`rv-${l.id}`}>{it.name} 입고 수량</label>
              <input id={`rv-${l.id}`} className="input input-num" inputMode="numeric" value={rec[l.id]} aria-invalid={!!errors[l.id]}
                aria-describedby={errors[l.id] ? `rv-${l.id}-err` : undefined}
                onChange={(e) => setRec((p) => ({ ...p, [l.id]: e.target.value }))} onBlur={() => setErrors((p) => ({ ...p, [l.id]: validate(rec[l.id]) }))} />
              <span>{it.unit}</span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* 5-3 · 입고 처리 (매니저) */
export function ReceivePage() {
  const { orders, inventory, inventorySource, reloadOrders, reloadInventory, loadAlerts } = useApp();
  const me = useDbUserId();
  const toast = useToast();
  const [target, setTarget] = useState(null);
  const waiting = orders.filter((o) => o.status === '대기');
  const done = orders.filter((o) => o.status !== '대기');
  const onConfirm = async (order, received) => {
    if (inventorySource !== 'db') { toast('재고 정보를 아직 불러오지 못했습니다. 잠시 뒤에 다시 시도하세요.'); return; }
    try {
      // 상태 전환·재고 가산·변동 기록은 DB(입고 트리거)가 처리한다. 발주량과 다르면 차이 사유를 남긴다.
      await receiveOrder(me, order.lines.map((l) => ({
        orderId: l.orderId, receivedQty: received[l.id], diffReason: received[l.id] !== l.qty ? '수량 차이' : null,
      })));
      await Promise.all([reloadOrders(), reloadInventory(), loadAlerts()]);
      toast(`${order.id} 입고를 완료했습니다.`);
      setTarget(null);
    } catch (e) {
      toast(`입고 처리하지 못했습니다. ${e.message}`);
    }
  };
  return (
    <>
      <PageHead eyebrow="입고" title="입고 처리" desc="점주가 등록한 발주의 물품이 도착하면 받은 수량을 확인하고 입고 완료하세요." />
      <div className="stack-lg">
        <Panel id="rv-wait" title="입고 대기" meta={`${waiting.length}건`}>
          {waiting.length ? <OrderTable orders={waiting} inventory={inventory} onReceive={setTarget} /> : <EmptyState icon="check" title="입고 대기 중인 발주가 없습니다">점주가 발주를 등록하면 여기에 표시됩니다.</EmptyState>}
        </Panel>
        <Panel id="rv-done" title="입고 완료"><OrderTable orders={done} inventory={inventory} /></Panel>
      </div>
      {target && <ReceiveModal order={target} inventory={inventory} onClose={() => setTarget(null)} onConfirm={onConfirm} />}
    </>
  );
}

/* 6-1 · 6-2 · 오차·폐기 리포트, 보정 계수 반영 확인 (점주) */
export function CorrectionPage() {
  const { inventory, inventorySource, correction, reloadCorrection, reloadRecs, loadAlerts } = useApp();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const errors = correction?.errors ?? [];
  const ing = (id) => inventory.find((i) => i.id === id);
  const latest = errors[errors.length - 1];
  const ids = latest ? Object.keys(latest.rows).filter((id) => ing(id)) : [];
  const newCoef = (id) => correction?.coefs[id]?.value ?? 1;
  const totalWaste = ids.reduce((a, id) => a + latest.rows[id][2] * ing(id).price, 0);
  const avgErr = ids.reduce((a, id) => a + (latest.rows[id][0] ? Math.abs(latest.rows[id][1] - latest.rows[id][0]) / latest.rows[id][0] : 0), 0) / (ids.length || 1) * 100;
  const runClose = async () => {
    setClosing(true);
    try {
      const r = await runPeriodClose();
      await Promise.all([reloadCorrection(), loadAlerts()]);
      if (r.closed || r.coefficients) { await calculateRecommendations(); await reloadRecs(); } // 새 보정 계수를 권장 발주량에 바로 반영
      toast(r.closed || r.coefficients ? `${r.period_start} 주 마감: 오차 ${r.closed}건, 보정 계수 ${r.coefficients}건을 만들었습니다.` : '이미 마감된 기간입니다.');
    } catch (e) { toast(`마감하지 못했습니다. ${e.message}`); }
    finally { setClosing(false); }
  };
  // 3기간 연속으로 실제가 예측보다 12% 이상 적은 재료
  const overForecast = errors.length >= 3 ? ids.filter((id) => errors.slice(-3).every((e) => e.rows[id] && e.rows[id][0] > 0 && (e.rows[id][0] - e.rows[id][1]) / e.rows[id][0] >= 0.12)) : [];
  // 마감 기록이 아직 없으면 안내를 보여 준다
  if (!correction) {
    return (
      <>
        <PageHead eyebrow="발주 관리" title="예측 오차 보정" desc="실제 소진량 = 기초 재고 + 입고 − 기말 재고. 예측과의 차이로 다음 발주의 보정 계수를 계산합니다."
          actions={<><Button variant="secondary" icon="plus" to="/owner/sales/records">판매 기록 입력</Button><Button variant="secondary" onClick={runClose} disabled={closing}>{closing ? '마감 중…' : '지난주 마감 실행'}</Button></>} />
        <div className="stack-lg">
          <Panel id="ce-empty"><EmptyState icon="chart" title="아직 마감된 주가 없습니다">지난주 판매와 입고 기록을 올린 뒤 오른쪽 위 ‘지난주 마감 실행’을 누르면 예측 오차와 폐기, 새 보정 계수가 여기에 표시됩니다.</EmptyState></Panel>
          <AiInsight kind="correction_report" title="AI 오차 리포트 요약" hint="지난 기간의 예측 오차·폐기·보정 계수 변화를 요약하고 오차가 큰 재료를 짚어 줍니다." />
        </div>
      </>
    );
  }
  return (
    <>
      <PageHead eyebrow="발주 관리" title="예측 오차 보정" desc="실제 소진량 = 기초 재고 + 입고 − 기말 재고. 예측과의 차이로 다음 발주의 보정 계수를 계산합니다."
        actions={inventorySource === 'db' ? <><Button variant="secondary" icon="plus" to="/owner/sales/records">판매 기록 입력</Button><Button variant="secondary" onClick={runClose} disabled={closing}>{closing ? '마감 중…' : '지난주 마감 실행'}</Button></> : null} />
      <div className="stack-lg">
        <div className="grid-3">
          <StatCard label="지난주 평균 오차율" value={`${avgErr.toFixed(1)}%`} sub={latest.period} />
          <StatCard label="지난주 폐기 금액" value={won(totalWaste)} sub="재고 변동 기록(폐기) 합계" />
          <StatCard label="다음 발주 반영" value="새 계수" sub="지난주 마감 실행 후 계산" />
        </div>
        {overForecast.length > 0 && <Alert tone="info" title={`${overForecast.map((id) => ing(id).name).join(', ')}은(는) 3주 연속 실제 소진이 예측보다 12% 이상 적었습니다`}>보정 계수를 낮춰 다음 권장량이 줄었습니다. 폐기량도 함께 줄어드는지 확인하세요.</Alert>}
        <Panel id="ce" title="재료별 예측 vs 실제 (최근 3주)" >
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">재료</th>{errors.map((e) => <th key={e.period} scope="col" className="num">{e.period}<br /><span style={{ fontWeight: 400 }}>예측 / 실제 · 폐기</span></th>)}<th scope="col" className="num">새 보정 계수</th></tr></thead>
              <tbody>
                {ids.map((id) => {
                  const c = newCoef(id);
                  return (
                    <tr key={id}>
                      <th scope="row">{ing(id).name}</th>
                      {errors.map((e) => {
                        if (!e.rows[id]) return <td key={e.period} className="num muted">—</td>;
                        const [f, a, w] = e.rows[id];
                        const err = f ? ((a - f) / f) * 100 : 0;
                        return (
                          <td key={e.period} className="num">
                            {f} / {a}{ing(id).unit}<br />
                            <span className={Math.abs(err) >= 10 ? 'delta-down' : 'muted'}>{err > 0 ? '+' : ''}{err.toFixed(1)}%</span>
                            <span className="muted"> · 폐기 {w}</span>
                          </td>
                        );
                      })}
                      <td className="num"><strong>×{c.toFixed(2)}</strong> {c < 0.95 ? <Badge tone="orange">하향</Badge> : c > 1.05 ? <Badge tone="blue">상향</Badge> : <Badge>유지</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="help" style={{ marginTop: 8 }}>보정 계수 = 3주 실제 소진 합 ÷ 예측 소진 합 (0.80 – 1.20 범위). 계산할 때마다 새 계수 행을 만들어 이력을 남깁니다.</p>
        </Panel>
        <AiInsight kind="correction_report" title="AI 오차 리포트 요약" hint="지난 기간의 예측 오차·폐기·보정 계수 변화를 요약하고 오차가 큰 재료를 짚어 줍니다." />
      </div>
    </>
  );
}
