import { useState } from 'react';
import { Alert, Badge, Button, EmptyState, Modal, PageHead, Panel, SampleTag, Segment, useToast } from '../../components/ui/index.jsx';
import { DAYS, NEXT_DATES, NEXT_RANGE, OWNER, SHIFTS, STAFF, THIS_DATES, staffById } from '../../mocks/data.js';
import { NEED, canWork, cellKey, fmtAvail, fmtRange, hoursOf, shiftHours, shortCells, supportCount, violations } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useBase, useRolePath } from '../../layouts/Layouts.jsx';

/* 2-2 · 가능시간 현황 (점주·매니저) */
export function AvailabilityPage() {
  return (
    <>
      <PageHead eyebrow="근무 관리 · 2-2" title="가능시간 현황" desc={`${NEXT_RANGE} 직원이 제출한 근무 가능시간과 시프트별 지원 인원입니다.`} />
      <div className="stack-lg">
        <Alert tone="warning" title="한지우 님이 아직 가능시간을 제출하지 않았습니다">초대 수락 전 계정입니다. 지난주 가능시간으로 표시합니다.</Alert>
        <Panel id="av" title="직원별 가능시간" meta="시:시 형식" actions={<SampleTag />}>
          <div className="sched-wrap" tabIndex={0} role="region" aria-label="직원별 가능시간 표">
            <div className="avail-grid" role="table" aria-label="직원별 요일 가능시간">
              <div role="row" style={{ display: 'contents' }}>
                <span role="columnheader" className="hm-colhead">직원</span>
                {DAYS.map((d, i) => <span key={d} role="columnheader" className="hm-colhead">{d} {NEXT_DATES[i]}</span>)}
              </div>
              {STAFF.map((st) => (
                <div role="row" key={st.id} style={{ display: 'contents' }}>
                  <span role="rowheader" className="av-name">{st.name}<small>{st.role} · 주 {st.maxHours}시간</small></span>
                  {DAYS.map((_, di) => {
                    const a = st.avail[di];
                    return <span key={di} role="cell" className={`av-cell ${a ? 'av-on' : 'av-off'}`}>{a ? fmtRange(a) : '불가'}</span>;
                  })}
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel id="av-sum" title="시프트별 지원 인원 vs 필요 인원">
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">시프트</th>{DAYS.map((d) => <th key={d} scope="col" className="num">{d}</th>)}</tr></thead>
              <tbody>
                {SHIFTS.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.label} <span className="muted">{fmtRange([s.start, s.end])}</span></th>
                    {DAYS.map((_, di) => {
                      const sup = supportCount(di, s);
                      const need = NEED[cellKey(di, s.id)];
                      return <td key={di} className="num">{sup < need ? <Badge tone="red">{sup}/{need}</Badge> : <span>{sup}/{need}</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help" style={{ marginTop: 8 }}>지원 인원 / 필요 인원 · 빨간 배지 = 지원자가 필요 인원보다 적은 시프트</p>
        </Panel>
      </div>
    </>
  );
}

/* 공용 스케줄 그리드 */
export function ScheduleGrid({ assign, need: needMap = NEED, edited = [], locked, onEdit, highlight, dates = NEXT_DATES }) {
  return (
    <>
      <div className="sched-wrap" tabIndex={0} role="region" aria-label="주간 스케줄, 가로로 스크롤할 수 있습니다">
        <div className="sched">
          <span />
          {DAYS.map((d, i) => (
            <div key={d} className={`sched-head ${i >= 5 ? 'is-weekend' : ''}`}><span className="d">{d}</span><span className="dt">{dates[i]}</span></div>
          ))}
          {SHIFTS.map((s) => (
            <div key={s.id} style={{ display: 'contents' }}>
              <div className="sched-shift"><span className="n">{s.label}</span><span className="t">{fmtRange([s.start, s.end])}</span></div>
              {DAYS.map((d, di) => {
                const k = cellKey(di, s.id);
                const ids = assign[k] || [];
                const need = needMap[k];
                const short = ids.length < need;
                return (
                  <button key={k} type="button" className={`sched-cell ${short ? 'is-short' : ''} ${edited.includes(k) ? 'is-edited' : ''}`}
                    disabled={locked} onClick={() => onEdit?.(di, s)}
                    aria-label={`${d}요일 ${s.label}, 필요 ${need}명, 배정 ${ids.length}명${ids.length ? `: ${ids.map((id) => staffById[id].name).join(', ')}` : ''}${short ? ', 인원 부족' : ''}${locked ? '' : ', 눌러서 수정'}`}>
                    <span className={`sched-need ${short ? 'short' : ''}`}><span>필요 {need}</span><span>{short ? `${need - ids.length}명 부족` : '충족'}</span></span>
                    {ids.map((id) => <span key={id} className={`chip ${staffById[id].role === '매니저' ? 'mgr' : ''}`} style={highlight === id ? { outline: '2px solid var(--primary)' } : undefined}>{staffById[id].name}</span>)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="sched-legend" aria-hidden="true">
        <span><i className="lg-box lg-short" />인원 부족</span>
        <span><i className="lg-box lg-edit" />직접 수정한 칸</span>
        <span><i className="lg-box" style={{ background: 'var(--info-soft)' }} />매니저</span>
      </div>
    </>
  );
}

function EditCellModal({ di, shift, assign, onClose, onSave }) {
  const { staff, need } = useApp();
  const k = cellKey(di, shift.id);
  const [sel, setSel] = useState(assign[k] || []);
  const hrs = hoursOf(assign, staff);
  const toggle = (id) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Modal title={`${DAYS[di]}요일 ${shift.label} 배정 수정`} desc={`${NEXT_DATES[di]} ${fmtRange([shift.start, shift.end])} · 필요 ${need[k]}명`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={() => onSave(k, sel)}>저장 ({sel.length}명)</Button></>}>
      <div className="list" role="group" aria-label="배정할 직원">
        {staff.map((st) => {
          const ok = canWork(st, di, shift);
          const after = hrs[st.id] + (sel.includes(st.id) && !(assign[k] || []).includes(st.id) ? shiftHours(shift) : 0) - (!sel.includes(st.id) && (assign[k] || []).includes(st.id) ? shiftHours(shift) : 0);
          const over = after > st.maxHours;
          return (
            <label key={st.id} className="list-row checkline" style={{ minHeight: 56 }}>
              <input type="checkbox" checked={sel.includes(st.id)} onChange={() => toggle(st.id)} />
              <span className="list-main">
                <span className="list-title">{st.name} <span className="muted" style={{ fontWeight: 400 }}>{st.role}</span></span>
                <span className="list-sub">이번 주 {after}/{st.maxHours}시간 · 가능시간 {st.avail[di] ? fmtAvail(st.avail[di]) : '없음'}</span>
              </span>
              {!ok && <Badge tone="orange">가능시간 밖</Badge>}
              {ok && over && <Badge tone="red">최대 초과</Badge>}
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

function WeeklyHours({ assign }) {
  const { staff } = useApp();
  const hrs = hoursOf(assign, staff);
  return (
    <div>
      <h3 className="section-title">개인별 주간 근무시간</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">이름</th><th scope="col">역할</th><th scope="col" className="num">배정</th><th scope="col" className="num">주 최대</th><th scope="col">상태</th></tr></thead>
          <tbody>
            {staff.map((st) => (
              <tr key={st.id}>
                <th scope="row">{st.name}</th>
                <td>{st.role}</td>
                <td className="num">{hrs[st.id]}시간</td>
                <td className="num">{st.maxHours}시간</td>
                <td>{hrs[st.id] === 0 ? <Badge>배정 없음</Badge> : hrs[st.id] > st.maxHours ? <Badge tone="red">초과 {hrs[st.id] - st.maxHours}시간</Badge> : hrs[st.id] === st.maxHours ? <Badge tone="orange">최대 도달</Badge> : <Badge tone="green">여유 {st.maxHours - hrs[st.id]}시간</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// DB 저장 실패 시 안내 (화면 상태는 AppState 가 DB 값으로 되돌린다)
const saveFailed = (toast) => (e) => toast(`저장하지 못했습니다: ${e.message ?? e}`);

const STEPS = [['draft', '초안 생성'], ['review', '매니저 검토'], ['published', '확정·공개']];
function Steps({ state }) {
  const idx = state === 'none' ? -1 : STEPS.findIndex(([s]) => s === state);
  return (
    <ol className="steps" aria-label="근무표 진행 단계" style={{ listStyle: 'none', padding: 0 }}>
      {STEPS.map(([s, l], i) => (
        <li key={s} className={`step ${i < idx || state === 'published' ? 'done' : i === idx ? 'current' : ''}`} aria-current={i === idx ? 'step' : undefined}>
          <span className="step-n">{i + 1}</span>{l}
        </li>
      ))}
    </ol>
  );
}

/* 2-3 · 2-5 · 스케줄 초안 자동 생성·확정 (점주) */
export function SchedulePage() {
  const { account } = useAuth();
  const myId = account?.id ?? OWNER.userId; // 로그인한 점주(확정·수정자)
  const { schedState: state, assign, need, staff, edited, setEdited, generateSchedule, notify, editScheduleCell, changeScheduleState } = useApp();
  const toast = useToast();
  const fail = saveFailed(toast);
  const p = useRolePath();
  const [loading, setLoading] = useState(false);
  const [genErr, setGenErr] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const short = shortCells(assign, need);
  const totalShort = short.reduce((a, k) => a + need[k] - (assign[k] || []).length, 0);
  const viol = violations(assign, staff);
  // 그 주 가능시간을 내지 않은 직원(DB 모드에서만 알 수 있음). 초안 자동 생성은 이들을 모든 시간 가능으로 본다.
  const missing = staff.filter((s) => s.role !== '점주' && s.status !== '비활성' && s.submitted === false);

  const generate = async () => {
    setLoading(true); setGenErr('');
    try {
      await generateSchedule();
      setEdited([]);
      toast('예측 매출과 가능시간으로 스케줄 초안을 만들었습니다.');
    } catch (e) {
      setGenErr(e.message);
    } finally {
      setLoading(false);
    }
  };
  const saveCell = (k, ids) => { editScheduleCell(k, ids, myId).catch(fail); setEditing(null); toast('배정을 수정했습니다.'); };
  const requestReview = () => { changeScheduleState('review').catch(fail); notify('근무표 초안 검토 요청을 매니저에게 보냈습니다'); toast('장윤서 매니저에게 검토를 요청했습니다.'); };
  // 2-5 · E4 위반이 있으면 확정하지 않는다(DB 트리거도 한 번 더 막는다)
  const publish = () => {
    setConfirm(false);
    if (viol.length) { toast('규칙 위반이 있어 확정할 수 없습니다.'); return; }
    changeScheduleState('published', myId).catch(fail);
    notify('다음 주 근무표가 확정·공개되었습니다'); toast('근무표를 확정하고 직원에게 공개했습니다.');
  };

  const actions = state === 'published'
    ? <Button variant="secondary" icon="edit" onClick={() => changeScheduleState('draft').catch(fail)}>다시 편집</Button>
    : state === 'draft' || state === 'review'
      ? <>
          <Button variant="secondary" icon="refresh" onClick={generate} disabled={loading}>초안 다시 생성</Button>
          {state === 'draft' && <Button variant="secondary" icon="users" onClick={requestReview}>매니저 검토 요청</Button>}
          <Button icon="check" onClick={() => setConfirm(true)} disabled={viol.length > 0}>확정·공개</Button>
        </>
      : <Button icon="refresh" onClick={generate} disabled={loading}>{loading ? '초안 생성 중…' : '초안 자동 생성'}</Button>;

  return (
    <>
      <PageHead eyebrow="근무 관리 · 2-3 · 2-5" title="스케줄 편성" desc={`다음 주 ${NEXT_RANGE} · 예측 매출로 시프트별 필요 인원을 계산하고, 가능시간과 주 최대 근무시간 안에서 배정합니다.`} actions={actions} />
      <Steps state={state} />
      <div className="stack-lg">
        {genErr && <Alert tone="danger" title="초안을 만들지 못했습니다" live>{genErr}</Alert>}
        {missing.length > 0 && state !== 'published' && (
          <Alert tone="info" title={`가능시간 미제출 ${missing.length}명 — 모든 시간 가능으로 보고 배정합니다`}
            action={<Button variant="text" to={p('work/availability')}>가능시간 현황</Button>}>
            {missing.map((s) => s.name).join(', ')} · 주 최대 근무시간 안에서 배정됩니다. 나중에 가능시간을 제출하면 ‘초안 다시 생성’으로 반영하세요.
          </Alert>
        )}
        {state === 'published' && <Alert tone="success" title="다음 주 근무표가 공개되었습니다">알바생 앱의 근무표 탭에 표시되고, 근무 전날 리마인드 알림이 발송됩니다.</Alert>}
        {state === 'review' && <Alert tone="info" title="매니저가 초안을 검토하고 있습니다">검토가 끝나면 알림이 옵니다. 기다리지 않고 바로 확정할 수도 있습니다.</Alert>}
        {viol.length > 0 && <Alert tone="danger" title={`규칙 위반 ${viol.length}건 — 확정할 수 없습니다`}>{viol.join(' · ')}</Alert>}
        {(state === 'draft' || state === 'review') && totalShort > 0 && (
          <Alert tone="warning" title={`인원 부족 시프트 ${short.length}곳 · 총 ${totalShort}명 부족`}>점선 칸을 눌러 배정을 조정하세요. 가능한 사람이 없으면 알바생을 추가로 모집하거나 점주가 직접 근무해야 합니다. 부족한 채로 확정할 수도 있습니다.</Alert>
        )}
        <Panel id="sc" title={state === 'published' ? '확정 스케줄' : '스케줄 초안'} actions={<Button variant="text" to={p('work/availability')}>가능시간 현황</Button>}>
          <div aria-busy={loading}>
            {loading ? (
              <div className="sched-wrap" aria-label="초안을 만드는 중입니다">
                <div className="sched">
                  <span />
                  {DAYS.map((d) => <div key={d} className="sched-head"><span className="d">{d}</span></div>)}
                  {SHIFTS.map((s) => <div key={s.id} style={{ display: 'contents' }}><div className="sched-shift"><span className="n">{s.label}</span></div>{DAYS.map((d) => <div key={d} className="skeleton sched-skel" />)}</div>)}
                </div>
              </div>
            ) : state === 'none' ? (
              <EmptyState icon="calendar" title="아직 만든 초안이 없습니다" action={<Button icon="refresh" onClick={generate}>초안 자동 생성</Button>}>
                다음 주 예측 매출로 시프트별 필요 인원을 계산하고, 직원 가능시간과 주 최대 근무시간을 지키는 배정안을 만듭니다.
              </EmptyState>
            ) : (
              <div className="stack-lg">
                <ScheduleGrid assign={assign} need={need} edited={edited} locked={state === 'published'} onEdit={(di, s) => setEditing({ di, s })} />
                <WeeklyHours assign={assign} />
              </div>
            )}
          </div>
        </Panel>
      </div>
      {editing && <EditCellModal di={editing.di} shift={editing.s} assign={assign} onClose={() => setEditing(null)} onSave={saveCell} />}
      {confirm && (
        <Modal title="근무표를 확정하고 공개할까요?" desc="공개하면 매니저·알바생 6명에게 알림이 발송됩니다." onClose={() => setConfirm(false)}
          footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>계속 수정</Button><Button onClick={publish}>확정·공개</Button></>}>
          {totalShort > 0
            ? <Alert tone="warning" title={`인원 부족 시프트 ${short.length}곳이 남아 있습니다`}>부족한 시간대는 점주가 직접 근무하거나 추가 모집이 필요합니다.</Alert>
            : <Alert tone="success" title="모든 시프트에 필요 인원이 배정되었습니다" />}
          <p className="panel-meta">공개 후에도 ‘다시 편집’으로 수정할 수 있습니다.</p>
        </Modal>
      )}
    </>
  );
}

/* 2-4 · 초안 검토·수정 (매니저) */
export function ScheduleReviewPage() {
  const { account } = useAuth();
  const myId = account?.id ?? STAFF[0].userId; // 로그인한 매니저(수정자)
  const { schedState: state, assign, need, staff, edited, notify, editScheduleCell, changeScheduleState } = useApp();
  const toast = useToast();
  const fail = saveFailed(toast);
  const [editing, setEditing] = useState(null);
  const viol = violations(assign, staff);
  const short = shortCells(assign, need);
  const saveCell = (k, ids) => { editScheduleCell(k, ids, myId).catch(fail); setEditing(null); toast('배정을 수정했습니다. 규칙을 다시 확인했습니다.'); };
  const done = () => { changeScheduleState('draft').catch(fail); notify(`${account?.name ?? ''} 매니저가 근무표 초안 검토를 마쳤습니다`); toast('검토 완료를 점주에게 알렸습니다.'); };

  return (
    <>
      <PageHead eyebrow="근무 관리 · 2-4" title="초안 검토·수정" desc={`점주가 만든 ${NEXT_RANGE} 초안입니다. 칸을 눌러 배정을 바꾸면 가능시간·주 최대 근무시간을 다시 검사합니다.`}
        actions={state === 'review' && <Button icon="check" onClick={done} disabled={viol.length > 0}>검토 완료</Button>} />
      <div className="stack-lg">
        {state === 'review' ? (
          <>
            {viol.length > 0
              ? <Alert tone="danger" title={`규칙 위반 ${viol.length}건`}>{viol.join(' · ')} — 해결해야 검토를 완료할 수 있습니다.</Alert>
              : <Alert tone="success" title="규칙 위반이 없습니다">{short.length ? `인원 부족 시프트 ${short.length}곳은 점주에게 함께 전달됩니다.` : '모든 시프트가 충족됩니다.'}</Alert>}
            <Panel id="rv" title="검토 중인 초안" meta={`수정한 칸 ${edited.length}곳`}>
              <ScheduleGrid assign={assign} need={need} edited={edited} onEdit={(di, s) => setEditing({ di, s })} />
            </Panel>
            <WeeklyHours assign={assign} />
          </>
        ) : (
          <Panel id="rv-empty">
            <EmptyState icon="clipboard" title={state === 'published' ? '이번 근무표는 이미 확정됐습니다' : '검토 요청이 없습니다'}>
              {state === 'published' ? '확정된 근무표는 점주만 다시 편집할 수 있습니다.' : '점주가 초안을 만들고 ‘매니저 검토 요청’을 누르면 여기에 표시됩니다.'}
            </EmptyState>
            {state === 'published' && <div style={{ marginTop: 24 }}><ScheduleGrid assign={assign} need={need} locked /></div>}
          </Panel>
        )}
      </div>
      {editing && <EditCellModal di={editing.di} shift={editing.s} assign={assign} onClose={() => setEditing(null)} onSave={saveCell} />}
    </>
  );
}

/* 점주·매니저 · 근무표 조회 — 이번 주·다음 주 전체 근무표(읽기 전용). 편성·수정은 각각 스케줄 편성(점주)·초안 검토(매니저)에서 한다 */
const STATE_LABEL = { none: null, draft: '초안', review: '매니저 검토 중', published: '확정·공개' };
const DB_STATUS_LABEL = { 초안: '초안', 검토중: '매니저 검토 중', 확정: '확정·공개' };
export function ScheduleOverviewPage() {
  const { schedState, assign, need, thisWeek } = useApp();
  const base = useBase();
  const isManager = base === '/manager';
  const [week, setWeek] = useState('this');
  const editPath = isManager ? `${base}/schedule` : `${base}/work/schedule`;
  const isThis = week === 'this';
  const hasSchedule = isThis ? !!thisWeek?.status : schedState !== 'none';
  const label = isThis ? DB_STATUS_LABEL[thisWeek?.status] : STATE_LABEL[schedState];
  const published = isThis ? !!thisWeek?.published : schedState === 'published';
  const view = isThis ? { assign: thisWeek?.assign ?? {}, need: thisWeek?.need ?? {} } : { assign, need };
  const range = isThis ? `${THIS_DATES[0]}(월) – ${THIS_DATES[6]}(일)` : NEXT_RANGE;
  return (
    <>
      <PageHead eyebrow="근무 관리" title="근무표 조회" desc="이번 주와 다음 주 전체 근무표를 확인합니다. 배정을 바꾸려면 스케줄 편성(점주)·초안 검토(매니저)에서 수정하세요."
        actions={<Button variant="secondary" icon="calendar" to={editPath}>{isManager ? '초안 검토·수정' : '스케줄 편성'}</Button>} />
      <div className="stack-lg">
        <Segment label="주 선택" value={week} onChange={setWeek} options={[{ value: 'this', label: '이번 주' }, { value: 'next', label: '다음 주' }]} />
        {thisWeek === null && isThis ? (
          <Panel id="ov-demo"><EmptyState icon="calendar" title="예시 모드에서는 이번 주 근무표가 없습니다">로그인하면 DB의 확정 근무표를 볼 수 있습니다.</EmptyState></Panel>
        ) : !hasSchedule ? (
          <Panel id="ov-empty"><EmptyState icon="calendar" title={`${isThis ? '이번 주' : '다음 주'} 근무표가 아직 없습니다`}>{isThis ? '이번 주 근무표가 만들어지지 않았습니다.' : '스케줄 편성에서 초안을 만들면 여기에 표시됩니다.'}</EmptyState></Panel>
        ) : (
          <>
            {!published && <Alert tone="info" title={`${isThis ? '이번 주' : '다음 주'} 근무표는 아직 확정·공개 전입니다`}>현재 상태: {label}. 알바생에게는 확정·공개 후에 보입니다.</Alert>}
            <Panel id="ov" title={range} actions={<Badge tone={published ? 'green' : 'orange'}>{label}</Badge>}>
              <ScheduleGrid assign={view.assign} need={view.need} locked dates={isThis ? THIS_DATES : NEXT_DATES} />
            </Panel>
            <WeeklyHours assign={view.assign} />
          </>
        )}
      </div>
    </>
  );
}
