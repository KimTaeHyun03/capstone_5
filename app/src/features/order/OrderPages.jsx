import { Fragment, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Modal, PageHead, Panel, SampleTag, StatCard, useToast } from '../../components/ui/index.jsx';
import { coefficient, recommendQty, won } from '../../domain/index.js';
import { FORECAST_ERRORS, TODAY } from '../../mocks/data.js';
import { useApp } from '../../state/AppState.jsx';
import { useRolePath } from '../../layouts/Layouts.jsx';
import { useNavigate } from 'react-router-dom';

/* 5-1 · 5-2 · 권장 발주량 확인·발주 등록 (점주) */
export function RecommendPage() {
  const { inventory, setOrders, notify } = useApp();
  const toast = useToast();
  const nav = useNavigate();
  const init = () => Object.fromEntries(inventory.map((it) => [it.id, String(recommendQty(it))]));
  const [qty, setQty] = useState(init);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const validate = (it, raw) => {
    if (raw === '' || Number.isNaN(Number(raw))) return '숫자를 입력하세요.';
    const n = Number(raw);
    if (n < 0) return '0 이상으로 입력하세요.';
    if (n % it.orderUnit !== 0) return `발주 단위 ${it.orderUnit}${it.unit}의 배수로 입력하세요.`;
    return '';
  };
  const lines = inventory.map((it) => ({ it, rec: recommendQty(it), n: Number(qty[it.id]) || 0 }));
  const total = lines.reduce((a, l) => a + l.n * l.it.price, 0);
  const count = lines.filter((l) => l.n > 0).length;
  const badList = inventory.filter((it) => errors[it.id]);

  const submit = () => {
    const errs = Object.fromEntries(inventory.map((it) => [it.id, validate(it, qty[it.id])]));
    setErrors(errs);
    const bad = inventory.filter((it) => errs[it.id]);
    if (bad.length) { document.getElementById(`qty-${bad[0].id}`)?.focus(); return; }
    setSubmitting(true);
    setTimeout(() => {
      const id = `PO-${1021 + Math.floor(Math.random() * 8)}`;
      setOrders((o) => [{ id, date: TODAY.label, status: '대기', lines: lines.filter((l) => l.n > 0).map((l) => ({ id: l.it.id, qty: l.n })) }, ...o]);
      notify(`${id} 발주가 등록됐습니다 (입고 대기)`);
      toast(`${count}개 품목, ${won(total)} 발주를 등록했습니다.`);
      setSubmitting(false);
      nav('/owner/order/orders');
    }, 600);
  };

  return (
    <>
      <PageHead eyebrow="발주 관리 · 5-1 · 5-2" title="권장 발주" desc="다음 주 예상 소진량과 보정 계수로 계산한 권장량입니다. 수량을 고친 뒤 발주를 등록하세요." />
      <div className="stack-lg">
        <Alert tone="info" title="권장 발주량 = 예상 소진량 × 보정 계수 − 현재 재고">발주 단위로 올림한 값입니다. 보정 계수는 최근 3주 예측 오차로 계산했습니다.</Alert>
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
        <Panel id="rc" title="재료별 권장 발주량" actions={<SampleTag />}>
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
  const { orders, inventory } = useApp();
  const p = useRolePath();
  const waiting = orders.filter((o) => o.status === '대기').length;
  return (
    <>
      <PageHead eyebrow="발주 관리 · 5-2 · 5-3" title="발주·입고 내역" desc="등록한 발주와 매니저의 입고 처리 상태입니다." actions={<Button icon="truck" to={p('order/recommend')}>새 발주</Button>} />
      <div className="stack-lg">
        <div className="grid-3">
          <StatCard label="입고 대기" value={waiting} unit="건" sub="매니저가 입고 처리" />
          <StatCard label="이번 달 발주" value={orders.length} unit="건" />
          <StatCard label="이번 달 발주 금액" value={won(orders.reduce((a, o) => a + o.lines.reduce((s, l) => s + l.qty * inventory.find((i) => i.id === l.id).price, 0), 0))} />
        </div>
        <Panel id="od" title="발주 내역" actions={<SampleTag />}><OrderTable orders={orders} inventory={inventory} /></Panel>
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
  const { orders, setOrders, inventory, setInventory, notify } = useApp();
  const toast = useToast();
  const [target, setTarget] = useState(null);
  const waiting = orders.filter((o) => o.status === '대기');
  const done = orders.filter((o) => o.status !== '대기');
  const onConfirm = (order, received) => {
    setInventory((list) => list.map((i) => (received[i.id] ? { ...i, stock: +(i.stock + received[i.id]).toFixed(2) } : i)));
    setOrders((list) => list.map((o) => (o.id === order.id ? { ...o, status: '입고완료' } : o)));
    notify(`${order.id} 입고가 완료되어 재고에 반영됐습니다`);
    toast(`${order.id} 입고를 완료했습니다.`);
    setTarget(null);
  };
  return (
    <>
      <PageHead eyebrow="입고 · 5-3" title="입고 처리" desc="점주가 등록한 발주의 물품이 도착하면 받은 수량을 확인하고 입고 완료하세요." />
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
  const { inventory } = useApp();
  const ids = Object.keys(FORECAST_ERRORS[0].rows);
  const ing = (id) => inventory.find((i) => i.id === id);
  const latest = FORECAST_ERRORS[FORECAST_ERRORS.length - 1];
  const totalWaste = ids.reduce((a, id) => a + latest.rows[id][2] * ing(id).price, 0);
  const avgErr = ids.reduce((a, id) => a + Math.abs(latest.rows[id][1] - latest.rows[id][0]) / latest.rows[id][0], 0) / ids.length * 100;
  return (
    <>
      <PageHead eyebrow="발주 관리 · 6-1 · 6-2" title="예측 오차 보정" desc="실제 소진량 = 기초 재고 + 입고 − 기말 재고. 예측과의 차이로 다음 발주의 보정 계수를 계산합니다." />
      <div className="stack-lg">
        <div className="grid-3">
          <StatCard label="지난주 평균 오차율" value={`${avgErr.toFixed(1)}%`} sub={latest.period} />
          <StatCard label="지난주 폐기 금액" value={won(totalWaste)} sub="재고 변동 기록(폐기) 합계" />
          <StatCard label="다음 발주 반영" value="새 계수" sub="10.25(일) 마감 후 자동 계산" />
        </div>
        <Alert tone="info" title="크루아상 생지는 3주 연속 실제 소진이 예측보다 12% 이상 적었습니다">보정 계수를 낮춰 다음 권장량이 줄었습니다. 폐기량도 함께 줄어드는지 확인하세요.</Alert>
        <Panel id="ce" title="재료별 예측 vs 실제 (최근 3주)" actions={<SampleTag />}>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">재료</th>{FORECAST_ERRORS.map((e) => <th key={e.period} scope="col" className="num">{e.period}<br /><span style={{ fontWeight: 400 }}>예측 / 실제 · 폐기</span></th>)}<th scope="col" className="num">새 보정 계수</th></tr></thead>
              <tbody>
                {ids.map((id) => {
                  const c = coefficient(FORECAST_ERRORS, id);
                  return (
                    <tr key={id}>
                      <th scope="row">{ing(id).name}</th>
                      {FORECAST_ERRORS.map((e) => {
                        const [f, a, w] = e.rows[id];
                        const err = ((a - f) / f) * 100;
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
      </div>
    </>
  );
}
