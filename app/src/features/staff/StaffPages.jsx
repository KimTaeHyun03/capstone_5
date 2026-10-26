import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, Icon, Modal, Segment, useToast } from '../../components/ui/index.jsx';
import { DAYS, NEXT_DATES, NEXT_RANGE, SHIFTS, THIS_DATES, TODAY, ME_STAFF_ID, staffById, staffByDbId, MY_SHIFTS_DONE } from '../../mocks/data.js';
import { cellKey, fmtRange, won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { submitShortageReport } from '../../lib/alerts.js';
import { clockIn, clockOut, fetchMyPay, fetchToday, kst } from '../../lib/attendance.js';
import { useDbUserId } from '../../lib/currentUser.js';

const ME = staffById[ME_STAFF_ID];
// 이번 주 확정 근무 (정윤수)
const THIS_WEEK = [
  { di: 0, shift: 'pm' }, { di: 1, shift: 'pm' }, { di: 2, shift: 'pm' },
  { di: 4, shift: 'pm' }, { di: 5, shift: 'mid' }, { di: 6, shift: 'pm' },
].map((w) => ({ ...w, status: w.di < TODAY.dayIndex ? 'done' : w.di === TODAY.dayIndex ? 'today' : 'next' }));
const COWORKERS = { 0: ['s3'], 1: ['s6'], 2: ['s5'], 4: ['s3'], 5: ['s3', 's5'], 6: ['s4'] };
const shiftOf = (id) => SHIFTS.find((s) => s.id === id);

function DayRow({ di, dates, shift, status, coworkers }) {
  const s = shiftOf(shift);
  return (
    <div className="list-row">
      <span className={`day-pill ${status === 'today' ? 'is-today' : ''}`}><span className="day-pill-d">{DAYS[di]}</span><span className="day-pill-n">{dates[di].split('.')[1]}</span></span>
      <div className="list-main">
        <span className="list-title">{s.label} {fmtRange([s.start, s.end])} <span className="muted" style={{ fontWeight: 400 }}>· {s.end - s.start}시간</span></span>
        <span className="list-sub od-truncate">함께 근무: {coworkers.length ? coworkers.map((id) => staffById[id]?.name).filter(Boolean).join(', ') : '없음'}</span>
      </div>
      {status === 'done' && <Badge>완료</Badge>}
      {status === 'today' && <Badge tone="blue">오늘</Badge>}
    </div>
  );
}

/* 2-6 · 확정 근무표 조회 */
export function StaffSchedule() {
  const { schedState, assign, thisWeek } = useApp();
  const dbUserId = useDbUserId();
  const me = (dbUserId && staffByDbId[dbUserId]) || ME; // 로그인한 직원(화면 직원 목록에 없으면 예시 직원)
  const [week, setWeek] = useState('this');
  const statusOf = (di) => (di < TODAY.dayIndex ? 'done' : di === TODAY.dayIndex ? 'today' : 'next');
  // 이번 주: DB 에서 읽었으면 확정 근무표에서 내 근무를 뽑고, 예시 모드면 예시 근무를 쓴다
  const thisList = thisWeek
    ? DAYS.flatMap((_, di) => SHIFTS.filter((s) => (thisWeek.assign[cellKey(di, s.id)] || []).includes(me.id))
        .map((s) => ({ di, shift: s.id, status: statusOf(di), coworkers: thisWeek.assign[cellKey(di, s.id)].filter((id) => id !== me.id) })))
    : THIS_WEEK.map((w) => ({ ...w, coworkers: COWORKERS[w.di] || [] }));
  const today = thisList.find((w) => w.status === 'today') ?? thisList.find((w) => w.status === 'next') ?? thisList[thisList.length - 1];
  const ts = today && shiftOf(today.shift);
  const todayLabel = today?.status === 'today' ? '오늘' : `${DAYS[today?.di]}요일`;
  const next = schedState === 'published'
    ? DAYS.flatMap((_, di) => SHIFTS.filter((s) => (assign[cellKey(di, s.id)] || []).includes(me.id)).map((s) => ({ di, shift: s.id, coworkers: assign[cellKey(di, s.id)].filter((id) => id !== me.id) })))
    : null;
  const total = thisList.reduce((a, w) => a + (shiftOf(w.shift).end - shiftOf(w.shift).start), 0);
  const noThisWeek = thisWeek && !thisWeek.published;
  return (
    <>
      <div className="hello">
        <span className="hello-name">{today ? `${me.name} 님, ${todayLabel} ${ts.label} 근무예요` : `${me.name} 님`}</span>
        <span className="hello-sub">{!today ? (noThisWeek ? '이번 주 근무표가 아직 공개되지 않았어요' : '이번 주에는 배정된 근무가 없어요')
          : `${today.status === 'today' ? TODAY.label : `${THIS_DATES[today.di]}(${DAYS[today.di]})`} ${fmtRange([ts.start, ts.end])} · 출근 전 출퇴근 탭에서 기록하세요`}</span>
      </div>
      <Segment label="주 선택" value={week} onChange={setWeek} options={[{ value: 'this', label: '이번 주' }, { value: 'next', label: '다음 주' }]} />
      {week === 'this' ? (
        <section className="card" aria-label="이번 주 근무">
          <div className="od-row" style={{ marginBottom: 4 }}>
            <strong>{THIS_DATES[0]} – {THIS_DATES[6]}</strong>
            <span className="push muted od-nowrap" style={{ fontSize: 14 }}>총 {total}시간</span>
          </div>
          {thisList.length ? (
            <div className="list">
              {thisList.map((w) => <DayRow key={`${w.di}${w.shift}`} di={w.di} dates={THIS_DATES} shift={w.shift} status={w.status} coworkers={w.coworkers} />)}
            </div>
          ) : <p className="muted" style={{ padding: '16px 0' }}>{noThisWeek ? '이번 주 근무표가 아직 공개되지 않았습니다.' : '이번 주에는 배정된 근무가 없습니다.'}</p>}
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
  const { clock: sampleClock, setClock, notify, inventorySource, loadAlerts } = useApp();
  const me = useDbUserId();
  const toast = useToast();
  const [now, setNow] = useState(() => new Date());
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000 * 15); return () => clearInterval(t); }, []);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // DB 연결 시: 오늘의 확정 배정(예정)과 출퇴근 기록을 DB에서 읽는다. 아니면 예시 동작.
  const fromDb = inventorySource === 'db';
  const [today, setToday] = useState(null);
  const reloadToday = () => fetchToday(me).then(setToday).catch((e) => console.warn('출퇴근 조회 실패:', e.message));
  useEffect(() => { if (fromDb && me) reloadToday(); }, [fromDb, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const clock = fromDb ? (today?.rec ?? { in: null, out: null }) : sampleClock;
  const samplePlan = shiftOf('pm');
  const planStart = fromDb ? today?.plan?.start : `${String(samplePlan.start).padStart(2, '0')}:00`;
  const planEnd = fromDb ? today?.plan?.end : `${samplePlan.end}:00`;
  const planText = fromDb ? (today?.plan ? `${planStart}–${planEnd}` : '없음') : `${samplePlan.label} ${fmtRange([samplePlan.start, samplePlan.end])}`;
  const dateLabel = fromDb ? kst(now).label : TODAY.label;
  const stage = !clock.in ? 'in' : !clock.out ? 'out' : 'done';
  const record = async () => {
    const kind = confirm;
    if (!fromDb) {
      if (kind === 'in') { setClock({ in: hhmm, out: null }); toast(`${hhmm} 출근을 기록했습니다.`); }
      else { setClock((c) => ({ ...c, out: hhmm })); notify(`${ME.name} 님이 ${hhmm}에 퇴근했습니다`); toast(`${hhmm} 퇴근을 기록했습니다. 수고하셨어요!`); }
      setConfirm(null);
      return;
    }
    setSaving(true);
    try {
      // 판정(지각·조퇴)·근무시간·급여 갱신은 DB 트리거가 처리한다.
      if (kind === 'in') await clockIn(me); else await clockOut(me);
      await Promise.all([reloadToday(), loadAlerts()]);
      toast(kind === 'in' ? `${hhmm} 출근을 기록했습니다.` : `${hhmm} 퇴근을 기록했습니다. 수고하셨어요!`);
      setConfirm(null);
    } catch (e) {
      toast(`기록하지 못했습니다. ${e.message}`);
    } finally { setSaving(false); }
  };
  return (
    <>
      <section className="card">
        <div className="clock-face">
          <span className="clock-date">{dateLabel} · 카페 온기</span>
          <span className="clock-time" aria-live="off">{hhmm}</span>
          <span className="muted">오늘 예정 {planText}</span>
        </div>
        {stage === 'done'
          ? <Alert tone="success" title="오늘 근무 기록 완료">출근 {clock.in} · 퇴근 {clock.out} · 급여에 자동 반영돼요.</Alert>
          : <Button className="big-round" block variant={stage === 'in' ? 'primary' : 'danger'} onClick={() => setConfirm(stage)}>{stage === 'in' ? '출근하기' : '퇴근하기'}</Button>}
      </section>
      <section className="card" aria-label="오늘 기록">
        <dl className="kv">
          <dt>예정 출근</dt><dd>{planStart || '—'}</dd>
          <dt>실제 출근</dt><dd>{clock.in || '—'}</dd>
          <dt>예정 퇴근</dt><dd>{planEnd || '—'}</dd>
          <dt>실제 퇴근</dt><dd>{clock.out || '—'}</dd>
        </dl>
      </section>
      <p className="help">예정보다 늦게 출근하거나 일찍 퇴근하면 지각·조퇴로 자동 표시돼요. 기록이 잘못됐다면 매니저에게 수정을 요청하세요.</p>
      {confirm && (
        <Modal title={confirm === 'in' ? `${hhmm} 출근할까요?` : `${hhmm} 퇴근할까요?`} desc={`오늘 예정 ${planText}`} onClose={() => setConfirm(null)}
          footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>취소</Button><Button variant={confirm === 'in' ? 'primary' : 'danger'} onClick={record} disabled={saving} data-autofocus>{confirm === 'in' ? '출근 기록' : '퇴근 기록'}</Button></>} />
      )}
    </>
  );
}

/* 3-2 · 급여 확인 */
export function StaffPay() {
  const { inventorySource } = useApp();
  const me = useDbUserId();
  // DB 연결 시: 이번 달 출퇴근 기록과 주휴수당을 DB에서 읽는다. 아니면 예시 데이터.
  const [pay, setPay] = useState(null);
  useEffect(() => {
    if (inventorySource === 'db' && me) fetchMyPay(me).then(setPay).catch((e) => console.warn('급여 조회 실패:', e.message));
  }, [inventorySource, me]);
  const shiftsDone = pay ? pay.shifts : MY_SHIFTS_DONE;
  const wage = pay ? pay.wage : ME.wage;
  const month = pay ? pay.month : 10;
  const holidayPay = pay ? pay.holidayPay : 0;
  const hours = shiftsDone.reduce((a, s) => a + s.hours, 0);
  const total = Math.round(hours * wage) + holidayPay;
  return (
    <>
      <section className="card">
        <span className="stat-label">{month}월 예상 급여 ({month}.01 – 오늘)</span>
        <span className="stat-value" style={{ fontSize: 'clamp(32px, 9vw, 40px)', margin: '4px 0' }}>{won(total)}</span>
        <span className="stat-sub">{hours.toFixed(1)}시간 × 시급 {won(wage)}{holidayPay > 0 ? ` + 주휴수당 ${won(holidayPay)}` : ''} · 지급일 {month === 12 ? 1 : month + 1}.10</span>
      </section>
      <Alert tone="info" title="주휴수당은 월말에 따로 계산돼요">주 15시간 이상 근무한 주가 대상이에요. 확정 금액은 정산 후 다시 알려드려요.</Alert>
      <section className="card" aria-label="근무 내역">
        <strong style={{ display: 'block', marginBottom: 4 }}>근무 내역</strong>
        <div className="list">
          {shiftsDone.length === 0 && <p className="muted" style={{ padding: '16px 0' }}>이번 달 근무 기록이 아직 없어요.</p>}
          {shiftsDone.slice().reverse().map((s) => (
            <div className="list-row" key={`${s.date}-${s.start}`}>
              <div className="list-main">
                <span className="list-title od-nowrap">{s.date}</span>
                <span className="list-sub">{s.start} – {s.end} · {s.hours}시간</span>
              </div>
              {s.flag && <Badge tone="orange">{s.flag}</Badge>}
              <span className="num" style={{ fontWeight: 600 }}>{won(Math.round(s.hours * wage))}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/* 4-4 · 부족 직접 신고 */
export function StaffReport() {
  const { inventory, inventorySource, reports, reloadReports } = useApp();
  const { account } = useAuth();
  const me = useDbUserId();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [sel, setSel] = useState(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!sel) { setErr('부족한 재료를 하나 고르세요.'); document.getElementById('rp-first')?.focus(); return; }
    if (inventorySource !== 'db') { toast('DB에 연결되지 않아 신고할 수 없습니다.'); return; }
    const it = inventory.find((i) => i.id === sel);
    setSaving(true);
    try {
      // 신고 저장과 점주·매니저 알림은 DB 함수가 한 번에 처리한다.
      await submitShortageReport({ ingredientId: it.ingredientId, reporterId: me, memo: note.trim() });
      await reloadReports();
      toast(`${it.name} 부족을 점주·매니저에게 알렸습니다.`);
      setSel(null); setNote(''); setErr('');
    } catch (e) {
      toast(`신고하지 못했습니다. ${e.message}`);
    } finally { setSaving(false); }
  };
  const mine = reports.filter((r) => r.by === (account?.name ?? ME.name));
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
      <Button size="lg" block icon="flag" onClick={submit} disabled={saving}>{saving ? '보내는 중…' : '부족 신고하기'}</Button>
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
