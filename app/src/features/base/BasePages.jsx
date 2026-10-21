import { useState } from 'react';
import { Alert, Badge, Button, Field, Modal, PageHead, Panel, SampleTag, useToast } from '../../components/ui/index.jsx';
import { STORE, RECIPES } from '../../mocks/data.js';
import { menuCost, won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';

/* 7-1 · 매장·직원 계정 */
export function StorePage() {
  const { staff, setStaff } = useApp();
  const toast = useToast();
  const [invite, setInvite] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', role: '알바생', wage: '10320' });
  const [errors, setErrors] = useState({});
  const check = (k, v) => {
    if (k === 'name' && !v.trim()) return '이름을 입력하세요.';
    if (k === 'phone' && !/^01\d-?\d{3,4}-?\d{4}$/.test(v)) return '010-1234-5678 형식으로 입력하세요.';
    if (k === 'wage' && (Number.isNaN(Number(v)) || Number(v) < 10320)) return '2026년 최저시급 10,320원 이상으로 입력하세요.';
    return '';
  };
  const send = () => {
    const errs = Object.fromEntries(['name', 'phone', 'wage'].map((k) => [k, check(k, form[k])]));
    setErrors(errs);
    const bad = Object.keys(errs).find((k) => errs[k]);
    if (bad) { document.getElementById(`iv-${bad}`)?.focus(); return; }
    setStaff((s) => [...s, { id: `s${s.length + 1}`, name: form.name, role: form.role, wage: Number(form.wage), maxHours: 20, status: '초대됨', phone: form.phone.replace(/(\d{3})-?(\d)\d{2,3}-?(\d{4})/, '$1-$2***-$3'), avail: {} }]);
    toast(`${form.name} 님에게 초대 문자를 보냈습니다.`);
    setInvite(false); setForm({ name: '', phone: '', role: '알바생', wage: '10320' });
  };
  const input = (k, label, extra = {}) => (
    <Field id={`iv-${k}`} label={label} required error={errors[k]} help={extra.help}>
      <input id={`iv-${k}`} className="input" value={form[k]} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `iv-${k}-err` : extra.help ? `iv-${k}-help` : undefined}
        inputMode={extra.inputMode} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} onBlur={() => setErrors((x) => ({ ...x, [k]: check(k, form[k]) }))} />
    </Field>
  );
  return (
    <>
      <PageHead eyebrow="기초 정보 · 7-1" title="매장·직원" desc="영업시간은 근무 시프트 기준이 되고, 시급은 급여·인건비 계산에 쓰입니다." actions={<Button icon="plus" onClick={() => setInvite(true)}>직원 초대</Button>} />
      <div className="stack-lg">
        <Panel id="store" title="매장 정보">
          <dl className="kv" style={{ maxWidth: 520 }}>
            <dt>매장명</dt><dd>{STORE.name}</dd>
            <dt>주소</dt><dd>{STORE.address}</dd>
            <dt>영업시간</dt><dd>{STORE.open}:00 – {STORE.close}:00</dd>
            <dt>시프트</dt><dd>오전 08–12 · 오후 12–17 · 저녁 17–22</dd>
            <dt>전화</dt><dd>{STORE.phone}</dd>
          </dl>
        </Panel>
        <Panel id="staff" title="직원 계정" meta={`${staff.length}명`} actions={<SampleTag />}>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">이름</th><th scope="col">역할</th><th scope="col">연락처</th><th scope="col" className="num">시급</th><th scope="col" className="num">주 최대</th><th scope="col">상태</th></tr></thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.name}</th><td>{s.role}</td><td className="od-nowrap">{s.phone}</td>
                    <td className="num">{won(s.wage)}</td><td className="num">{s.maxHours}시간</td>
                    <td>{s.status === '활성' ? <Badge tone="green">활성</Badge> : <Badge tone="orange">초대됨</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      {invite && (
        <Modal title="직원 초대" desc="입력한 번호로 앱 설치·가입 링크를 보냅니다. 가입 전까지 ‘초대됨’ 상태입니다." onClose={() => setInvite(false)}
          footer={<><Button variant="secondary" onClick={() => setInvite(false)}>취소</Button><Button onClick={send}>초대 보내기</Button></>}>
          <div className="stack-md">
            {input('name', '이름')}
            {input('phone', '휴대폰 번호', { inputMode: 'tel' })}
            <Field id="iv-role" label="역할" required>
              <select id="iv-role" className="select" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}><option>알바생</option><option>매니저</option></select>
            </Field>
            {input('wage', '시급(원)', { inputMode: 'numeric', help: '2026년 최저시급 10,320원' })}
          </div>
        </Modal>
      )}
    </>
  );
}

/* 7-2 · 7-4 · 메뉴·레시피 */
export function MenuPage() {
  const { menus, setMenus, inventory } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const ing = (id) => inventory.find((i) => i.id === id);
  const noRecipe = menus.filter((m) => !(RECIPES[m.id] || []).length);
  const toggle = (id) => {
    const m = menus.find((x) => x.id === id);
    setMenus((ms) => ms.map((x) => (x.id === id ? { ...x, onSale: !x.onSale } : x)));
    toast(`${m.name}을(를) ${m.onSale ? '판매 중지' : '판매 중'}로 바꿨습니다.`);
  };
  const menu = menus.find((m) => m.id === open);
  return (
    <>
      <PageHead eyebrow="기초 정보 · 7-2 · 7-4" title="메뉴·레시피" desc="메뉴 1개에 들어가는 재료 양(레시피)은 판매 시 재고 자동 차감과 권장 발주량 계산에 쓰입니다." />
      <div className="stack-lg">
        {noRecipe.length > 0 && <Alert tone="warning" title={`레시피가 없는 메뉴 ${noRecipe.length}개`}>{noRecipe.map((m) => m.name).join(', ')} — 판매해도 재고가 자동 차감되지 않습니다.</Alert>}
        <Panel id="menu" title="메뉴 목록" actions={<SampleTag />}>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">메뉴</th><th scope="col">분류</th><th scope="col" className="num">판매가</th><th scope="col" className="num">원가</th><th scope="col" className="num">원가율</th><th scope="col">레시피</th><th scope="col">판매</th></tr></thead>
              <tbody>
                {menus.map((m) => {
                  const cost = menuCost(m.id);
                  const has = (RECIPES[m.id] || []).length > 0;
                  return (
                    <tr key={m.id}>
                      <th scope="row">{m.name}</th><td>{m.category}</td>
                      <td className="num">{won(m.price)}</td>
                      <td className="num">{has ? won(cost) : '—'}</td>
                      <td className="num">{has ? `${((cost / m.price) * 100).toFixed(0)}%` : '—'}</td>
                      <td><Button variant="text" onClick={() => setOpen(m.id)}>{has ? `재료 ${RECIPES[m.id].length}개` : '등록 필요'}</Button></td>
                      <td>
                        <label className="checkline" style={{ minHeight: 36 }}>
                          <input type="checkbox" checked={m.onSale} onChange={() => toggle(m.id)} />
                          <span>{m.onSale ? '판매 중' : '판매 중지'}</span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      {menu && (
        <Modal title={`${menu.name} 레시피`} desc={`판매가 ${won(menu.price)} · 1잔(개) 기준 재료 소요량`} onClose={() => setOpen(null)}
          footer={<Button onClick={() => setOpen(null)}>닫기</Button>}>
          {(RECIPES[menu.id] || []).length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">재료</th><th scope="col" className="num">소요량</th><th scope="col" className="num">원가</th></tr></thead>
                <tbody>{RECIPES[menu.id].map(([iid, q]) => <tr key={iid}><th scope="row">{ing(iid).name}</th><td className="num">{q}{ing(iid).unit}</td><td className="num">{won(ing(iid).price * q)}</td></tr>)}</tbody>
                <tfoot><tr><th scope="row" colSpan={2}>원가 합계</th><td className="num">{won(menuCost(menu.id))}</td></tr></tfoot>
              </table>
            </div>
          ) : <Alert tone="warning" title="아직 레시피가 없습니다">재료와 소요량을 등록하면 판매 시 재고가 자동 차감됩니다.</Alert>}
        </Modal>
      )}
    </>
  );
}

/* 7-3 · 재료 */
export function IngredientPage() {
  const { inventory } = useApp();
  return (
    <>
      <PageHead eyebrow="기초 정보 · 7-3" title="재료" desc="최소 보유량은 부족 알림 기준이고, 발주 단위는 권장 발주량을 올림하는 단위입니다." />
      <Panel id="ing" title="재료 목록" meta={`${inventory.length}개`} actions={<SampleTag />}>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">재료</th><th scope="col">단위</th><th scope="col" className="num">단가</th><th scope="col" className="num">최소 보유량</th><th scope="col" className="num">발주 단위</th><th scope="col">거래처</th></tr></thead>
            <tbody>
              {inventory.map((i) => (
                <tr key={i.id}>
                  <th scope="row">{i.name}</th><td>{i.unit}</td><td className="num">{won(i.price)}</td>
                  <td className="num">{i.min}{i.unit}</td><td className="num">{i.orderUnit}{i.unit}</td><td>{i.supplier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
