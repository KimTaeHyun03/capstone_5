import { useState } from 'react';
import { Alert, Button, Panel } from '../../components/ui/index.jsx';
import { fetchAiInsight } from '../../lib/ai.js';
import { supabase } from '../../lib/supabase.js';

// AI 요약 카드. 숫자는 DB 계산 결과 그대로이고, AI 는 그 숫자를 문장으로 풀어 줄 뿐이다.
export function AiInsight({ kind, title = 'AI 요약', hint }) {
  const [state, setState] = useState({ status: 'idle' });
  const unavailable = !supabase;

  const run = async () => {
    setState({ status: 'loading' });
    try {
      const r = await fetchAiInsight(kind);
      setState({ status: 'done', text: r.text, at: r.generated_at });
    } catch (e) {
      setState({ status: 'error', message: e.message, code: e.code });
    }
  };

  const lines = state.status === 'done' ? state.text.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean) : [];
  const actions = (
    <Button variant="secondary" icon="refresh" onClick={run} disabled={unavailable || state.status === 'loading'}>
      {state.status === 'loading' ? '요약 중…' : state.status === 'done' ? '다시 요약' : 'AI 요약 보기'}
    </Button>
  );

  return (
    <Panel title={title} actions={actions}>
      {unavailable && <p className="help">서버에 연결된 상태에서만 사용할 수 있습니다.</p>}
      {!unavailable && state.status === 'idle' && <p className="help">{hint || '현재 데이터를 바탕으로 핵심만 요약해 드립니다. 숫자는 위 표 그대로이며, AI는 해석만 덧붙입니다.'}</p>}
      {state.status === 'loading' && <p className="help" role="status">요약하는 중입니다…</p>}
      {state.status === 'error' && (
        <Alert tone={state.code === 'no_data' ? 'info' : 'warning'} title={state.code === 'not_configured' ? 'AI 기능이 아직 설정되지 않았습니다' : '요약하지 못했습니다'}>{state.message}</Alert>
      )}
      {state.status === 'done' && (
        <>
          <ul className="stack-md" style={{ paddingLeft: "1.2em" }} aria-live="polite">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="help">AI가 생성한 요약이라 틀릴 수 있습니다. {new Date(state.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 기준</p>
        </>
      )}
    </Panel>
  );
}
