import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon.jsx';

export { Icon };

export function Button({ variant = 'primary', size, icon, block, children, className = '', to, ...rest }) {
  const cls = `btn btn-${variant} ${size ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className}`;
  const inner = <>{icon && <Icon name={icon} />}{children}</>;
  if (to) return <Link className={cls} to={to} {...rest}>{inner}</Link>;
  return <button type="button" className={cls} {...rest}>{inner}</button>;
}

export function IconButton({ icon, label, ...rest }) {
  return (
    <button type="button" className="btn btn-ghost btn-icon" aria-label={label} {...rest}>
      <Icon name={icon} size="md" />
    </button>
  );
}

const TONE = { gray: 'gray', blue: 'blue', green: 'green', orange: 'orange', red: 'red' };
export const Badge = ({ tone = 'gray', children }) => <span className={`badge badge-${TONE[tone]}`}>{children}</span>;

export const SampleTag = () => <span className="tag-sample" title="DB 연동 전 예시 데이터">예시 데이터</span>;

const ALERT_ICON = { info: 'info', success: 'check', warning: 'alert', danger: 'alert' };
export function Alert({ tone = 'info', title, children, action, live }) {
  return (
    <div className={`alert alert-${tone}`} role={live ? 'status' : undefined}>
      <Icon name={ALERT_ICON[tone]} />
      <div className="alert-body">
        {title && <strong className="alert-title">{title}</strong>}
        {children && <span className="alert-text">{children}</span>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

export function PageHead({ eyebrow, title, desc, actions }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
        <h1 className="page-title">{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Panel({ title, meta, actions, children, id }) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <section className="panel" aria-labelledby={hid}>
      {(title || meta || actions) && (
        <div className="panel-head">
          {title && <h2 className="panel-title" id={hid}>{title}</h2>}
          {meta && <span className="panel-meta">{meta}</span>}
          {actions && <span className="push">{actions}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, unit, sub, to }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}{unit && <small>{unit}</small>}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  );
  return to ? <Link className="stat-card" to={to}>{body}</Link> : <div className="stat-card">{body}</div>;
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} /></span>
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
      {action}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  const refs = useRef({});
  const onKey = (e, i) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => (refs.current[t.id] = el)} type="button" role="tab" className="tab"
          aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segment({ options, value, onChange, label }) {
  return (
    <div className="segment" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Field({ id, label, required, help, error, children }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}{required && <span className="req" aria-hidden="true">*</span>}{required && <span className="sr-only">(필수)</span>}</label>
      {children}
      {error ? <span className="err" id={`${id}-err`}><Icon name="alert" size="sm" />{error}</span> : help && <span className="help" id={`${id}-help`}>{help}</span>}
    </div>
  );
}

export function Meter({ value, max, level }) {
  return <span className={`meter ${level === 'low' ? 'is-low' : level === 'warn' ? 'is-warn' : ''}`} aria-hidden="true"><span style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></span>;
}

/* 모달 — 포커스 가두기, Esc 닫기, 열기 전 포커스 복귀 */
export function Modal({ title, desc, onClose, children, footer }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const focusables = () => el.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]');
    (el.querySelector('[data-autofocus]') || focusables()[0])?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const f = Array.from(focusables());
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby={desc ? 'modal-desc' : undefined} ref={ref}>
        <div className="modal-head">
          <div className="modal-head-text">
            <h2 className="modal-title" id="modal-title">{title}</h2>
            {desc && <p className="modal-desc" id="modal-desc">{desc}</p>}
          </div>
          <IconButton icon="close" label="닫기" onClick={onClose} />
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* 토스트 */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg) => {
    const id = Math.random().toString(36).slice(2);
    setItems((p) => [...p, { id, msg }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => <div className="toast" key={t.id}><Icon name="check" />{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
