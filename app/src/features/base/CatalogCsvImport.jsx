import { useRef, useState } from 'react';
import { Alert, Button, Field, Panel } from '../../components/ui/index.jsx';
import { CATALOG_SPEC, parseCatalogCSV, templateCSV } from '../../domain/catalogCsv.js';
import { won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';
import { ErrorText, useAction } from './OperationsUI.jsx';

// 재료·메뉴·레시피를 CSV 로 한 번에 등록한다. 올리기 전에 틀린 곳을 행 번호와 함께 알려 주고, 저장은 전부 성공하거나 전부 취소된다.
const FILE_LIMIT = 2 * 1024 * 1024;

const PREVIEW = {
  ingredient: { head: ['재료', '단위', '단가', '최소 보유', '발주 수량'], row: (r) => [r.name, r.unit, won(r.price), r.min, r.orderUnit] },
  menu: { head: ['메뉴', '분류', '판매가', '판매'], row: (r) => [r.name, r.category, won(r.price), r.onSale ? '판매 중' : '판매 중지'] },
  recipe: { head: ['메뉴', '재료', '소요량'], row: (r) => [r.menu, r.ingredient, r.qty] },
};

export function CatalogCsvImport({ kind, title }) {
  const { ops } = useApp();
  const spec = CATALOG_SPEC[kind];
  const read = useAction();
  const save = useAction();
  const input = useRef(null);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [done, setDone] = useState(null);

  const download = () => {
    const url = URL.createObjectURL(new Blob([templateCSV(kind)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${spec.label}_등록_양식.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    setRows([]); setDone(null); save.clear();
    if (!file) return;
    setFileName(file.name);
    await read.run(async () => {
      if (file.size > FILE_LIMIT) throw new Error('CSV는 2MB 이하여야 합니다.');
      setRows(parseCatalogCSV(await file.text(), kind, { menus: ops.menus, ingredients: ops.ingredients }));
    });
  };

  const reset = () => { setRows([]); setFileName(''); if (input.current) input.current.value = ''; };

  const submit = () => save.run(() => ops.importCatalog(kind, rows), null, (r) => {
    setDone(r);
    reset();
  });

  const preview = PREVIEW[kind];
  return (
    <Panel id={`csv-${kind}`} title={title ?? `${spec.label} CSV로 한 번에 등록`} actions={<Button variant="secondary" onClick={download}>양식 다운로드</Button>}>
      <p className="help">UTF-8 CSV · 최대 500행 / 2MB. 헤더: {spec.required.join(', ')}{spec.optional.length ? ` (선택: ${spec.optional.join(', ')})` : ''}. {spec.help}</p>
      <Field id={`csv-file-${kind}`} label="CSV 파일 선택">
        <input id={`csv-file-${kind}`} ref={input} type="file" accept=".csv,text/csv" disabled={read.busy || save.busy} onChange={onFile} />
      </Field>
      <ErrorText error={read.error} />
      <ErrorText error={save.error} />
      {done && (
        <Alert tone="success" title={kind === 'recipe' ? `메뉴 ${done.updated}개의 레시피를 등록했습니다.` : `${spec.label} ${done.created}개를 새로 등록하고 ${done.updated}개를 수정했습니다.`}>
          {kind === 'ingredient' ? '재료는 재고 0으로 시작합니다. 재고 관리 → 실사·폐기 기록에서 현재 수량을 채우세요.' : kind === 'menu' ? '이어서 레시피를 등록하면 판매할 때 재고가 자동으로 줄어요.' : '메뉴 원가가 레시피 기준으로 다시 계산됐습니다.'}
        </Alert>
      )}
      {!!rows.length && (
        <>
          <Alert title={`${fileName} · ${rows.length}행 검증 완료`}>미리보기는 최대 10행입니다. 아래 버튼을 눌러야 저장됩니다. 저장은 전부 성공하거나 전부 취소됩니다.</Alert>
          <div className="table-wrap">
            <table>
              <thead><tr>{preview.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 10).map((r, i) => <tr key={i}>{preview.row(r).map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="od-cluster">
            <Button disabled={save.busy} onClick={submit}>{save.busy ? '등록 중…' : `검증한 ${rows.length}행 등록`}</Button>
            <Button variant="secondary" disabled={save.busy} onClick={reset}>취소</Button>
          </div>
        </>
      )}
    </Panel>
  );
}
