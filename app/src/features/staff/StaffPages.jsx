import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, Icon, Modal, Segment, useToast } from '../../components/ui/index.jsx';
import { DAYS, NEXT_DATES, NEXT_RANGE, SHIFTS, THIS_DATES, TODAY, ME_STAFF_ID, staffById, MY_SHIFTS_DONE } from '../../mocks/data.js';
import { cellKey, fmtRange, won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';

const ME = staffById[ME_STAFF_ID];
// 이번 주 확정 근무 (정윤수)
const THIS_WEEK = [
  { di: 0, shift: 'pm', status: 'done' }, { di: 1, shift: 'pm', status: 'done' }, { di: 2, shift: 'pm', status: 'today' },
  { di: 4, shift: 'pm', status: 'next' }, { di: 5, shift: 'mid', status: 'next' }, { di: 6, shift: 'pm', status: 'next' },
];
const COWORKERS = { 0: ['s3'], 1: ['s6'], 2: ['s5'], 4: ['s3'], 5: ['s3', 's5'], 6: ['s4'] };
const shiftOf = (id) => SHIFTS.find((s) => s.id === id);

function DayRow({ di, dates, shift, status, coworkers }) {
  const s = shiftOf(shift);
  return (
    <div className="list-row">
      <span className={`day-pill ${status === 'today' ? 'is-today' : ''}`}><span className="day-pill-d">{DAYS[di]}</span><span className="day-pill-n">{dates[di].split('.')[1]}</span></span>
      <div className="list-main">
        <span className="list-title">{s.label} {fmtRange([s.start, s.end])} <span className="muted" style={{ fontWeight: 400 }}>· {s.end - s.start}시간</span></span>
        <span className="list-sub od-truncate">함께 근무: {coworkers.length ? coworkers.map((id) => staffById[id].name).join(', ') : '없음'}</span>
      </div>
      {status === 'done' && <Badge>완료</Badge>}
      {status === 'today' && <Badge tone="blue">오늘</Badge>}
    </div>
  );
}

/* 2-6 · 확정 근무표 조회 */
export function StaffSchedule() {
  const { schedState, assign } = useApp();
  const [week, setWeek] = useState('this');
  const today = THIS_WEEK.find((w) => w.status === 'today');
  const ts = shiftOf(today.shift);
  const next = schedState === 'published'
    ? DAYS.flatMap((_, di) => SHIFTS.filter((s) => (assign[cellKey(di, s.id)] || []).includes(ME.id)).map((s) => ({ di, shift: s.id, coworkers: assign[cellKey(di, s.id)].filter((id) => id !== ME.id) })))
    : null;
  const total = THIS_WEEK.reduce((a, w) => a + (shiftOf(w.shift).end - shiftOf(w.shift).start), 0);
  return (
    <>
      <div className="hello">
        <span className="hello-name">{ME.name} 님, 오늘 {ts.label} 근무예요</span>
        <span className="hello-sub">{TODAY.label} {fmtRange([ts.start, ts.end])} · 출근 전 출퇴근 탭에서 기록하세요</span>
      </div>
      <Segment label="주 선택" value={week} onChange={setWeek} options={[{ value: 'this', label: '이번 주' }, { value: 'next', label: '다음 주' }]} />
      {week === 'this' ? (
        <section className="card" aria-label="이번 주 근무">
          <div className="od-row" style={{ marginBottom: 4 }}>
            <strong>{THIS_DATES[0]} – {THIS_DATES[6]}</strong>
            <span className="push muted od-nowrap" style={{ fontSize: 14 }}>총 {total}시간</span>
          </div>
          <div className="list">
            {THIS_WEEK.map((w) => <DayRow key={w.di} di={w.di} dates={THIS_DATES} shift={w.shift} status={w.status} coworkers={COWORKERS[w.di] || []} />)}
          </div>
        </section>
      ) : next ? (
        <section className="card" aria-label="다음 주 근무">
          <div className="od-row" style={{ marginBottom: 4 }}><strong>{NEXT_RANGE}</strong><Badge tone="green">확정</Badge></div>
          {next.length ? <div className="list">{next.map((w) => <DayRow key={`${w.di}${w.shift}`} di={w.di} dates={NEXT_DATES} shift={w.shift} status="next" coworkers={w.coworkers} />)}</div>
            : <p className="muted" style={{ padding: '16px 0' }}>다음 주에는 배정된 근무가 없습니다.</p>}
        </section>
      ) : (
        <div className="card-soft">
          <strong style={{ display: 'block', marginBottom: 4 }}>다음 주 근무표는 아직 확정 전이에요</strong>
          <span className="muted" style={{ fontSize: 15 }}>점주가 확정·공개하면 알림을 보내드려요. 가능시간을 아직 안 냈다면 지금 제출하세요.</span>
          <div style={{ marginTop: 12 }}><Button variant="secondary" to="/staff/availability">가능시간 등록</Button></div>
        </div>
      )}
    </>
  );
}

/* 2-1 · 가능시간 등록·수정 */
export function StaffAvailability() {
  const { myAvail, setMyAvail, myMaxHours, availSubmitted, submitMyAvail } = useApp();
  const toast = useToast();
  const [maxH, setMaxH] = useState(String(myMaxHours));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  useEffect(() => setMaxH(String(myMaxHours)), [myMaxHours]); // DB에서 불러온 값 반영
  const toggle = (di, si) => setMyAvail((a) => ({ ...a, [di]: a[di].map((v, i) => (i === si ? (v ? 0 : 1) : v)) }));
  const hours = DAYS.reduce((a, _, di) => a + SHIFTS.reduce((s, sh, si) => s + (myAvail[di][si] ? sh.end - sh.start : 0), 0), 0);
  const check = (v) => (Number.isNaN(Number(v)) || v === '' ? '숫자를 입력하세요.' : Number(v) < 4 || Number(v) > 40 ? '4–40시간 사이로 입력하세요.' : '');
  const submit = async () => {
    const e = check(maxH);
    setErr(e);
    if (e) { document.getElementById('maxh')?.focus(); return; }
    setSaving(true); setSaveErr('');
    try {
      await submitMyAvail(Number(maxH));
      toast('다음 주 가능시간을 제출했습니다.');
    } catch (x) {
      setSaveErr(x.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="hello">
        <span className="hello-name">다음 주 언제 일할 수 있나요?</span>
        <span className="hello-sub">{NEXT_RANGE} · 금요일 18시까지 제출</span>
      </div>
      {saveErr && <Alert tone="danger" title="제출하지 못했습니다" live>{saveErr}</Alert>}
      {availSubmitted && !saveErr && <Alert tone="success" title="제출 완료">마감 전까지 언제든 고쳐서 다시 제출할 수 있어요.</Alert>}
      <section className="card" aria-label="요일별 가능 시프트">
        <div className="toggle-grid" role="group" aria-label="가능 시프트 선택">
          <span />
          {SHIFTS.map((s) => <span key={s.id} className="tg-head">{s.label}<br />{fmtRange([s.start, s.end])}</span>)}
          {DAYS.map((d, di) => (
            <div key={d} style={{ display: 'contents' }}>
              <span className="tg-day">{d} <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>{NEXT_DATES[di].split('.')[1]}</span></span>
              {SHIFTS.map((s, si) => (
                <button key={s.id} type="button" className="slot-btn" aria-pressed={!!myAvail[di][si]} onClick={() => toggle(di, si)} aria-label={`${d}요일 ${s.label} ${myAvail[di][si] ? '가능' : '불가'}`}>
                  {myAvail[di][si] ? <Icon name="tick" /> : '불가'}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
      <section className="card stack-md" aria-label="주 최대 근무시간">
        <Field id="maxh" label="주 최대 근무시간" required error={err} help={`선택한 시프트 합계 ${hours}시간 · 이 시간을 넘게 배정되지 않아요`}>
          <div className="od-row">
            <input id="maxh" className="input input-num" inputMode="numeric" value={maxH} aria-invalid={!!err}
              aria-describedby={err ? 'maxh-err' : 'maxh-help'} onChange={(e) => setMaxH(e.target.value)} onBlur={() => setErr(check(maxH))} />
            <span>시간</span>
          </div>
        </Field>
      </section>
      <Button size="lg" block icon="check" onClick={submit} disabled={hours === 0 || saving}>{saving ? '제출 중…' : availSubmitted ? '수정해서 다시 제출' : '가능시간 제출'}</Button>
    </>
  );
}

/* 3-1 · 출근·퇴근 기록 */
export function StaffClock() {
  const { clock, setClock, notify } = useApp();
  const toast = useToast();
  const [now, setNow] = useState(() => new Date());
  const [confirm, setConfirm] = useState(null);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000 * 15); return () => clearInterval(t); }, []);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const plan = shiftOf('pm');
  const stage = !clock.in ? 'in' : !clock.out ? 'out' : 'done';
  const record = () => {
    if (confirm === 'in') { setClock({ in: hhmm, out: null }); toast(`${hhmm} 출근을 기록했습니다.`); }
    else { setClock((c) => ({ ...c, out: hhmm })); notify(`${ME.name} 님이 ${hhmm}에 퇴근했습니다`); toast(`${hhmm} 퇴근을 기록했습니다. 수고하셨어요!`); }
    setConfirm(null);
  };
  return (
    <>
      <section className="card">
        <div className="clock-face">
          <span className="clock-date">{TODAY.label} · 카페 온기</span>
          <span className="clock-time" aria-live="off">{hhmm}</span>
          <span className="muted">오늘 예정 {plan.label} {fmtRange([plan.start, plan.end])}</span>
        </div>
        {stage === 'done'
          ? <Alert tone="success" title="오늘 근무 기록 완료">출근 {clock.in} · 퇴근 {clock.out} · 급여에 자동 반영돼요.</Alert>
          : <Button className="big-round" block variant={stage === 'in' ? 'primary' : 'danger'} onClick={() => setConfirm(stage)}>{stage === 'in' ? '출근하기' : '퇴근하기'}</Button>}
      </section>
      <section className="card" aria-label="오늘 기록">
        <dl className="kv">
          <dt>예정 출근</dt><dd>{String(plan.start).padStart(2, '0')}:00</dd>
          <dt>실제 출근</dt><dd>{clock.in || '—'}</dd>
          <dt>예정 퇴근</dt><dd>{plan.end}:00</dd>
          <dt>실제 퇴근</dt><dd>{clock.out || '—'}</dd>
        </dl>
      </section>
      <p className="help">예정보다 늦게 출근하거나 일찍 퇴근하면 지각·조퇴로 자동 표시돼요. 기록이 잘못됐다면 매니저에게 수정을 요청하세요.</p>
      {confirm && (
        <Modal title={confirm === 'in' ? `${hhmm} 출근할까요?` : `${hhmm} 퇴근할까요?`} desc={`오늘 예정 ${fmtRange([plan.start, plan.end])}`} onClose={() => setConfirm(null)}
          footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>취소</Button><Button variant={confirm === 'in' ? 'primary' : 'danger'} onClick={record} data-autofocus>{confirm === 'in' ? '출근 기록' : '퇴근 기록'}</Button></>} />
      )}
    </>
  );
}

/* 3-2 · 급여 확인 */
export function StaffPay() {
  const hours = MY_SHIFTS_DONE.reduce((a, s) => a + s.hours, 0);
  const pay = hours * ME.wage;
  return (
    <>
      <section className="card">
        <span className="stat-label">10월 예상 급여 (10.01 – 오늘)</span>
        <span className="stat-value" style={{ fontSize: 'clamp(32px, 9vw, 40px)', margin: '4px 0' }}>{won(pay)}</span>
        <span className="stat-sub">{hours.toFixed(1)}시간 × 시급 {won(ME.wage)} · 지급일 11.10</span>
      </section>
      <Alert tone="info" title="주휴수당은 월말에 따로 계산돼요">주 15시간 이상 근무한 주가 대상이에요. 확정 금액은 정산 후 다시 알려드려요.</Alert>
      <section className="card" aria-label="근무 내역">
        <strong style={{ display: 'block', marginBottom: 4 }}>근무 내역</strong>
        <div className="list">
          {MY_SHIFTS_DONE.slice().reverse().map((s) => (
            <div className="list-row" key={s.date}>
              <div className="list-main">
                <span className="list-title od-nowrap">{s.date}</span>
                <span className="list-sub">{s.start} – {s.end} · {s.hours}시간</span>
              </div>
              {s.flag && <Badge tone="orange">{s.flag}</Badge>}
              <span className="num" style={{ fontWeight: 600 }}>{won(s.hours * ME.wage)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/* 4-4 · 부족 직접 신고 */
export function StaffReport() {
  const { inventory, reports, setReports, notify } = useApp();
  const toast = useToast();
  const [sel, setSel] = useState(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    if (!sel) { setErr('부족한 재료를 하나 고르세요.'); document.getElementById('rp-first')?.focus(); return; }
    const it = inventory.find((i) => i.id === sel);
    setReports((r) => [{ id: `r${Date.now()}`, ingredientId: sel, by: ME.name, at: '방금', note: note.trim() }, ...r]);
    notify(`${ME.name} 님이 ${it.name} 부족을 신고했습니다`);
    toast(`${it.name} 부족을 점주·매니저에게 알렸습니다.`);
    setSel(null); setNote(''); setErr('');
  };
  const mine = reports.filter((r) => r.by === ME.name);
  return (
    <>
      <div className="hello">
        <span className="hello-name">무엇이 부족한가요?</span>
        <span className="hello-sub">신고하면 점주·매니저에게 바로 알림이 가요.</span>
      </div>
      <section className="card stack-md" aria-label="부족 신고">
        <div role="group" aria-labelledby="rp-label" aria-describedby={err ? 'rp-err' : undefined}>
          <span id="rp-label" className="field-label" style={{ marginBottom: 8 }}>재료<span className="req" aria-hidden="true">*</span></span>
          <div className="choice-grid">
            {inventory.map((i, idx) => (
              <button key={i.id} id={idx === 0 ? 'rp-first' : undefined} type="button" className="choice" aria-pressed={sel === i.id} onClick={() => { setSel(i.id); setErr(''); }}>
                <span className="choice-name">{i.name}</span>
                <span className="choice-sub">재고 {i.stock}{i.unit}</span>
              </button>
            ))}
          </div>
          {err && <span className="err" id="rp-err" style={{ marginTop: 8 }}><Icon name="alert" size="sm" />{err}</span>}
        </div>
        <Field id="rp-note" label="메모 (선택)" help="예: 오후 라떼 주문이 많아 2팩 남음">
          <textarea id="rp-note" className="textarea" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} aria-describedby="rp-note-help" />
        </Field>
      </section>
      <Button size="lg" block icon="flag" onClick={submit}>부족 신고하기</Button>
      {mine.length > 0 && (
        <section className="card" aria-label="내 신고">
          <strong style={{ display: 'block', marginBottom: 4 }}>내가 보낸 신고</strong>
          <div className="list">
            {mine.map((r) => (
              <div className="list-row" key={r.id}>
                <div className="list-main"><span className="list-title">{inventory.find((i) => i.id === r.ingredientId)?.name}</span><span className="list-sub">{r.at}{r.note ? ` · ${r.note}` : ''}</span></div>
                <Badge tone="orange">확인 대기</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
